/**
 * Admin refresh-character job control: cancel, prioritize, kill-all.
 *
 * Cancellation state machine (race-safe):
 *
 * Queued / delayed:
 *  1. Atomically record cancelRequestedAt + reason (CAS).
 *  2. Attempt BullMQ remove for the exact queueJobId (bounded legacy fallback).
 *  3. If removal confirmed and DB row still QUEUED → CAS to CANCELLED.
 *  4. If the job became ACTIVE during the race → leave ACTIVE + cancel requested
 *     (cooperative checkpoints finish it). Never falsely mark as queued_cancelled.
 *
 * Active:
 *  - Idempotently set cancelRequestedAt; never BullMQ remove() as if queued.
 *  - Healthy first cancel: cooperative (worker terminalizes at checkpoints).
 *  - Kill-all, re-cancel after request, or stale ACTIVE (zombie): force CANCELLED.
 *
 * Terminal:
 *  - Repeated cancel is idempotent; timestamps/status are not rewritten incorrectly.
 *
 * Identifiers:
 *  - IngestionJob.id = durable logical DB UUID
 *  - IngestionJob.queueJobId = BullMQ job id (never pass DB UUID to BullMQ remove)
 */
import type { Queue, Job as BullJob } from "bullmq";
import type { IngestionJob } from "@mplus/database";
import type { Logger } from "@mplus/observability";
import { QUEUE_NAMES } from "@mplus/contracts";
import type { JobRepository } from "../persistence/job-repository.js";
import { isStaleActive } from "../persistence/job-staleness.js";

const HIGH_PRIORITY_WEIGHT = 10;
/** Strict bound for legacy null-queueJobId reconciliation — no unbounded scan. */
const LEGACY_QUEUE_SCAN_LIMIT = 200;

export type CancelOutcome =
  | "queued_cancelled"
  | "delayed_cancelled"
  | "active_cancel_requested"
  | "active_force_cancelled"
  | "already_cancellation_requested"
  | "already_terminal"
  | "failed_to_cancel";

export interface CancelRefreshJobResult {
  /** Durable IngestionJob UUID (not the BullMQ id). */
  ingestionJobId: string;
  /** @deprecated Prefer ingestionJobId — kept for API compatibility. */
  jobId: string;
  queueJobId: string | null;
  outcome: CancelOutcome;
  previousStatus: string;
  databaseStatus: string;
  queueRemoved: boolean;
  message: string;
}

export interface KillAllRefreshJobsResult {
  queuedCancelled: number;
  delayedCancelled: number;
  activeCancellationRequested: number;
  /** ACTIVE rows force-terminalized (kill-all, re-cancel zombie, or stale ACTIVE). */
  activeForceCancelled: number;
  alreadyCancellationRequested: number;
  alreadyTerminal: number;
  cancellationFailed: number;
  results: CancelRefreshJobResult[];
}

export interface PrioritizeRefreshJobResult {
  ingestionJobId: string;
  jobId: string;
  queueJobId: string | null;
  prioritized: boolean;
  alreadyHighPriority: boolean;
  databasePriority: number;
  message: string;
}

export interface RefreshJobControlDeps {
  jobRepository: JobRepository;
  /** Null in inline/test mode — DB-only control. */
  refreshQueue: Queue | null;
  logger: Logger;
  /**
   * Optional hook to release Redis admission reservation/slot after durable cancel.
   * Must be idempotent. Cancel remains durable even when this fails.
   */
  releaseAdmission?: (ingestionJobId: string) => Promise<void>;
}

async function findBullJob(
  queue: Queue,
  job: IngestionJob,
): Promise<BullJob | null> {
  if (job.queueJobId) {
    const byId = await queue.getJob(job.queueJobId);
    if (byId) return byId;
  }
  // Legacy rows without queueJobId: bounded scan only — never pass IngestionJob.id to BullMQ.
  const states = ["waiting", "delayed", "prioritized"] as const;
  const candidates = await queue.getJobs([...states], 0, LEGACY_QUEUE_SCAN_LIMIT);
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  for (const bull of candidates) {
    if (!bull) continue;
    const data = (bull.data ?? {}) as Record<string, unknown>;
    if (job.dedupeKey && typeof bull.id === "string" && bull.id.startsWith(`${job.dedupeKey}-`)) {
      return bull;
    }
    if (
      job.characterId &&
      data.characterId === job.characterId &&
      data.region === payload.region &&
      data.realmSlug === payload.realmSlug &&
      data.name === payload.name
    ) {
      return bull;
    }
  }
  return null;
}

function shouldForceCancelActive(
  job: Pick<IngestionJob, "status" | "startedAt" | "scheduledAt" | "cancelRequestedAt">,
  reason: string,
  alreadyRequested: boolean,
): boolean {
  if (reason === "admin_kill_all") return true;
  if (alreadyRequested) return true;
  return isStaleActive(job);
}

async function releaseAdmissionBestEffort(
  deps: RefreshJobControlDeps,
  ingestionJobId: string,
): Promise<void> {
  if (!deps.releaseAdmission) return;
  try {
    await deps.releaseAdmission(ingestionJobId);
  } catch (error) {
    deps.logger.warn(
      { err: error, ingestionJobId },
      "admission release after cancel failed — cancel remains durable",
    );
  }
}

async function forceCancelActiveJob(
  deps: RefreshJobControlDeps,
  job: IngestionJob,
  reason: string,
  previousStatus: string,
  queueRemoved: boolean,
  message: string,
): Promise<CancelRefreshJobResult> {
  const cancelled = await deps.jobRepository.markCancelled(job.id, { reason });
  await releaseAdmissionBestEffort(deps, cancelled.id);
  return {
    ingestionJobId: cancelled.id,
    jobId: cancelled.id,
    queueJobId: cancelled.queueJobId,
    outcome: "active_force_cancelled",
    previousStatus,
    databaseStatus: cancelled.status,
    queueRemoved,
    message,
  };
}

async function inspectAndRemoveQueuedBullJob(
  queue: Queue | null,
  job: IngestionJob,
  logger: Logger,
): Promise<{ removed: boolean; wasDelayed: boolean; becameActive: boolean }> {
  if (!queue) {
    return { removed: false, wasDelayed: false, becameActive: false };
  }
  try {
    const bull = await findBullJob(queue, job);
    if (!bull) {
      return { removed: false, wasDelayed: false, becameActive: false };
    }
    const state = await bull.getState();
    if (state === "active") {
      return { removed: false, wasDelayed: false, becameActive: true };
    }
    const wasDelayed = state === "delayed";
    if (state !== "waiting" && state !== "delayed" && state !== "prioritized") {
      return { removed: false, wasDelayed, becameActive: false };
    }
    await bull.remove();
    return { removed: true, wasDelayed, becameActive: false };
  } catch (error) {
    logger.warn(
      { err: error, ingestionJobId: job.id, queueJobId: job.queueJobId },
      "failed to remove BullMQ job",
    );
    return { removed: false, wasDelayed: false, becameActive: false };
  }
}

export async function cancelRefreshJob(
  deps: RefreshJobControlDeps,
  jobId: string,
  reason = "admin_cancel",
): Promise<CancelRefreshJobResult> {
  const job = await deps.jobRepository.findById(jobId);
  if (!job) {
    return {
      ingestionJobId: jobId,
      jobId,
      queueJobId: null,
      outcome: "failed_to_cancel",
      previousStatus: "MISSING",
      databaseStatus: "MISSING",
      queueRemoved: false,
      message: "Job not found",
    };
  }
  if (job.jobType !== QUEUE_NAMES.refreshCharacter) {
    return {
      ingestionJobId: job.id,
      jobId: job.id,
      queueJobId: job.queueJobId,
      outcome: "failed_to_cancel",
      previousStatus: job.status,
      databaseStatus: job.status,
      queueRemoved: false,
      message: `Unsupported job type ${job.jobType}`,
    };
  }

  const previousStatus = job.status;

  if (job.status === "CANCELLED" || job.status === "COMPLETED" || job.status === "FAILED") {
    return {
      ingestionJobId: job.id,
      jobId: job.id,
      queueJobId: job.queueJobId,
      outcome: "already_terminal",
      previousStatus,
      databaseStatus: job.status,
      queueRemoved: false,
      message: `Job already terminal (${job.status})`,
    };
  }

  // 1) Atomically record cancel request (idempotent).
  const alreadyRequested = Boolean(job.cancelRequestedAt);
  const afterRequest = await deps.jobRepository.requestCancel(job.id, reason);

  if (afterRequest.status === "ACTIVE" || afterRequest.status === "CANCELLED") {
    if (afterRequest.status === "CANCELLED") {
      return {
        ingestionJobId: afterRequest.id,
        jobId: afterRequest.id,
        queueJobId: afterRequest.queueJobId,
        outcome: "already_terminal",
        previousStatus,
        databaseStatus: afterRequest.status,
        queueRemoved: false,
        message: "Job already cancelled",
      };
    }
    if (shouldForceCancelActive(afterRequest, reason, alreadyRequested)) {
      return forceCancelActiveJob(
        deps,
        afterRequest,
        reason,
        previousStatus,
        false,
        reason === "admin_kill_all"
          ? "Active job force-cancelled by kill-all"
          : alreadyRequested
            ? "Stale active job force-cancelled (cancellation was already requested)"
            : "Stale active job force-cancelled",
      );
    }
    return {
      ingestionJobId: afterRequest.id,
      jobId: afterRequest.id,
      queueJobId: afterRequest.queueJobId,
      outcome: "active_cancel_requested",
      previousStatus,
      databaseStatus: afterRequest.status,
      queueRemoved: false,
      message: "Cancellation requested — worker will stop at the next safe checkpoint",
    };
  }

  // Still QUEUED (or delayed-equivalent): attempt BullMQ remove then CAS to CANCELLED.
  const { removed, wasDelayed, becameActive } = await inspectAndRemoveQueuedBullJob(
    deps.refreshQueue,
    afterRequest,
    deps.logger,
  );

  if (becameActive) {
    const latest =
      (await deps.jobRepository.findById(afterRequest.id)) ??
      ({ ...afterRequest, status: "ACTIVE" as const } satisfies IngestionJob);
    if (shouldForceCancelActive(latest, reason, alreadyRequested)) {
      return forceCancelActiveJob(
        deps,
        latest,
        reason,
        previousStatus,
        false,
        reason === "admin_kill_all"
          ? "Active job force-cancelled by kill-all"
          : "Job became active during cancel — force-cancelled",
      );
    }
    return {
      ingestionJobId: afterRequest.id,
      jobId: afterRequest.id,
      queueJobId: afterRequest.queueJobId,
      outcome: "active_cancel_requested",
      previousStatus,
      databaseStatus: "ACTIVE",
      queueRemoved: false,
      message: "Job became active during cancel — cooperative cancellation requested",
    };
  }

  const cancelled = await deps.jobRepository.markCancelledIfQueued(afterRequest.id, { reason });
  if (!cancelled) {
    // Raced to ACTIVE (or other non-QUEUED) between remove and CAS.
    const latest = await deps.jobRepository.findById(afterRequest.id);
    if (latest?.status === "ACTIVE") {
      if (shouldForceCancelActive(latest, reason, alreadyRequested)) {
        return forceCancelActiveJob(
          deps,
          latest,
          reason,
          previousStatus,
          removed,
          reason === "admin_kill_all"
            ? "Active job force-cancelled by kill-all"
            : "Job became active before CANCELLED transition — force-cancelled",
        );
      }
      return {
        ingestionJobId: afterRequest.id,
        jobId: afterRequest.id,
        queueJobId: afterRequest.queueJobId,
        outcome: "active_cancel_requested",
        previousStatus,
        databaseStatus: "ACTIVE",
        queueRemoved: removed,
        message: "Job became active before CANCELLED transition — cooperative cancellation requested",
      };
    }
    if (latest?.status === "CANCELLED") {
      await releaseAdmissionBestEffort(deps, latest.id);
      return {
        ingestionJobId: afterRequest.id,
        jobId: afterRequest.id,
        queueJobId: afterRequest.queueJobId,
        outcome: "already_terminal",
        previousStatus,
        databaseStatus: "CANCELLED",
        queueRemoved: removed,
        message: "Job already cancelled",
      };
    }
    return {
      ingestionJobId: afterRequest.id,
      jobId: afterRequest.id,
      queueJobId: afterRequest.queueJobId,
      outcome: "failed_to_cancel",
      previousStatus,
      databaseStatus: latest?.status ?? "UNKNOWN",
      queueRemoved: removed,
      message: "Failed to transition queued job to CANCELLED",
    };
  }

  await releaseAdmissionBestEffort(deps, cancelled.id);
  return {
    ingestionJobId: cancelled.id,
    jobId: cancelled.id,
    queueJobId: cancelled.queueJobId,
    outcome: wasDelayed ? "delayed_cancelled" : "queued_cancelled",
    previousStatus,
    databaseStatus: cancelled.status,
    queueRemoved: removed,
    message: "Queued refresh job cancelled",
  };
}

export async function prioritizeRefreshJob(
  deps: RefreshJobControlDeps,
  jobId: string,
): Promise<PrioritizeRefreshJobResult> {
  const job = await deps.jobRepository.findById(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }
  if (job.jobType !== QUEUE_NAMES.refreshCharacter) {
    throw new Error(`Unsupported job type ${job.jobType}`);
  }
  if (job.status !== "QUEUED") {
    throw new Error(`Only queued/delayed jobs can be prioritized (status=${job.status})`);
  }
  if (job.cancelRequestedAt) {
    throw new Error("Only queued jobs without a cancellation request can be prioritized");
  }

  if (job.priority >= HIGH_PRIORITY_WEIGHT) {
    return {
      ingestionJobId: job.id,
      jobId: job.id,
      queueJobId: job.queueJobId,
      prioritized: false,
      alreadyHighPriority: true,
      databasePriority: job.priority,
      message: "Job already at high priority",
    };
  }

  const updated = await deps.jobRepository.updatePriority(job.id, HIGH_PRIORITY_WEIGHT);

  if (deps.refreshQueue) {
    try {
      const bull = await findBullJob(deps.refreshQueue, job);
      if (bull) {
        const state = await bull.getState();
        if (state === "waiting" || state === "delayed" || state === "prioritized") {
          await bull.changePriority({ priority: HIGH_PRIORITY_WEIGHT });
        }
      }
    } catch (error) {
      deps.logger.warn({ err: error, ingestionJobId: jobId }, "failed to change BullMQ priority");
    }
  }

  return {
    ingestionJobId: updated.id,
    jobId: updated.id,
    queueJobId: updated.queueJobId,
    prioritized: true,
    alreadyHighPriority: false,
    databasePriority: updated.priority,
    message: "Job priority raised",
  };
}

export async function killAllRefreshJobs(
  deps: RefreshJobControlDeps,
  reason = "admin_kill_all",
): Promise<KillAllRefreshJobsResult> {
  // Point-in-time snapshot of in-flight refresh-character jobs only.
  // Independently active Bulk Processing may enqueue new refreshes afterward.
  const inFlight = await deps.jobRepository.listInFlightRefreshJobs();
  const results: CancelRefreshJobResult[] = [];
  let queuedCancelled = 0;
  let delayedCancelled = 0;
  let activeCancellationRequested = 0;
  let activeForceCancelled = 0;
  let alreadyCancellationRequested = 0;
  let alreadyTerminal = 0;
  let cancellationFailed = 0;

  for (const job of inFlight) {
    const result = await cancelRefreshJob(deps, job.id, reason);
    results.push(result);
    switch (result.outcome) {
      case "queued_cancelled":
        queuedCancelled += 1;
        break;
      case "delayed_cancelled":
        delayedCancelled += 1;
        break;
      case "active_cancel_requested":
        activeCancellationRequested += 1;
        break;
      case "active_force_cancelled":
        activeForceCancelled += 1;
        break;
      case "already_cancellation_requested":
        alreadyCancellationRequested += 1;
        break;
      case "already_terminal":
        alreadyTerminal += 1;
        break;
      case "failed_to_cancel":
        cancellationFailed += 1;
        break;
    }
  }

  return {
    queuedCancelled,
    delayedCancelled,
    activeCancellationRequested,
    activeForceCancelled,
    alreadyCancellationRequested,
    alreadyTerminal,
    cancellationFailed,
    results,
  };
}

/** True when the ACTIVE job should stop at a safe checkpoint. */
export async function isRefreshCancellationRequested(
  jobRepository: JobRepository,
  jobId: string,
): Promise<boolean> {
  const job = await jobRepository.findById(jobId);
  if (!job) return false;
  if (job.status === "CANCELLED") return true;
  return Boolean(job.cancelRequestedAt);
}
