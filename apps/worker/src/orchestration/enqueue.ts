import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import type { Logger } from "@mplus/observability";
import type { JobRepository } from "../persistence/job-repository.js";
import { DEFAULT_STALE_QUEUED_MS } from "../persistence/job-staleness.js";

export { DEFAULT_STALE_QUEUED_MS, isStaleQueued } from "../persistence/job-staleness.js";

export function buildBullmqExecutionJobId(dedupeKey: string, executionId = randomUUID()): string {
  // Unique per execution so terminal BullMQ jobs never block a requeue.
  // Logical dedupe remains on the IngestionJob.dedupeKey column.
  // BullMQ rejects ":" in custom job IDs — use a hyphen separator.
  return `${dedupeKey}-${executionId}`;
}

export interface PersistAndEnqueueDeps {
  queue: Queue;
  jobType: string;
  dedupeKey: string;
  payload: unknown;
  jobRepository: JobRepository;
  logger: Logger;
  options?: { characterId?: string | null; runId?: string | null; priority?: number };
  staleQueuedMs?: number;
}

export interface PersistAndEnqueueResult {
  jobId: string;
  dedupeKey: string;
  reused: boolean;
  enqueued: boolean;
  bullmqJobId: string | null;
}

/**
 * Reconcile IngestionJob rows with BullMQ:
 * - In-flight (QUEUED/ACTIVE) jobs collapse concurrent callers without a new queue message.
 * - Stale QUEUED (no startedAt) is marked FAILED, then a new execution may proceed.
 * - Terminal jobs are requeued with a unique BullMQ jobId; DB is reset to QUEUED only after add succeeds.
 * - If add fails, terminal rows stay terminal (or newly created rows become FAILED).
 */
export async function persistAndEnqueue(deps: PersistAndEnqueueDeps): Promise<PersistAndEnqueueResult> {
  const {
    queue,
    jobType,
    dedupeKey,
    payload,
    jobRepository,
    logger,
    options = {},
    staleQueuedMs = DEFAULT_STALE_QUEUED_MS,
  } = deps;

  const resolved = await jobRepository.resolveForEnqueue({
    jobType,
    dedupeKey,
    characterId: options.characterId ?? null,
    runId: options.runId ?? null,
    payload,
    priority: options.priority ?? 0,
    staleQueuedMs,
  });

  if (resolved.skipEnqueue) {
    return {
      jobId: resolved.job.id,
      dedupeKey,
      reused: true,
      enqueued: false,
      bullmqJobId: null,
    };
  }

  const bullmqJobId = buildBullmqExecutionJobId(dedupeKey);

  try {
    await queue.add(jobType, payload, {
      jobId: bullmqJobId,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  } catch (error) {
    logger.error({ jobType, dedupeKey, bullmqJobId, err: error }, "queue.add failed");
    await jobRepository.markEnqueueFailed(resolved.job.id, error);
    return {
      jobId: resolved.job.id,
      dedupeKey,
      reused: resolved.reused,
      enqueued: false,
      bullmqJobId,
    };
  }

  const promoted = await jobRepository.promoteToQueuedAfterEnqueue({
    jobId: resolved.job.id,
    dedupeKey,
    jobType,
    characterId: options.characterId ?? null,
    runId: options.runId ?? null,
    payload,
    priority: options.priority ?? 0,
  });

  if (!promoted.wonClaim) {
    // Another concurrent producer already owns an in-flight execution — drop our duplicate message.
    try {
      const bullJob = await queue.getJob(bullmqJobId);
      if (bullJob) await bullJob.remove();
    } catch (error) {
      logger.warn({ dedupeKey, bullmqJobId, err: error }, "failed to remove duplicate BullMQ job");
    }
  }

  return {
    jobId: promoted.job.id,
    dedupeKey,
    reused: resolved.reused || !promoted.wonClaim,
    enqueued: promoted.wonClaim,
    bullmqJobId: promoted.wonClaim ? bullmqJobId : null,
  };
}
