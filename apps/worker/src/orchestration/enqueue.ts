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
 * - Claim the DB row to QUEUED before `queue.add` so concurrent losers never publish
 *   a duplicate BullMQ message (avoids locked-job removal races).
 * - Terminal jobs remain requeueable when a legitimate new refresh is required.
 * - If add fails after claim, the row is marked FAILED (stale recovery covers crash gaps).
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

  // Claim before BullMQ publish: only one producer may own the in-flight execution.
  const claimed = await jobRepository.promoteToQueuedAfterEnqueue({
    jobId: resolved.job.id,
    dedupeKey,
    jobType,
    characterId: options.characterId ?? null,
    runId: options.runId ?? null,
    payload,
    priority: options.priority ?? 0,
  });

  if (!claimed.wonClaim) {
    return {
      jobId: claimed.job.id,
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
      priority: options.priority ?? 0,
    });
  } catch (error) {
    logger.error({ jobType, dedupeKey, bullmqJobId, err: error }, "queue.add failed");
    await jobRepository.markEnqueueFailed(claimed.job.id, error);
    return {
      jobId: claimed.job.id,
      dedupeKey,
      reused: resolved.reused,
      enqueued: false,
      bullmqJobId,
    };
  }

  try {
    await jobRepository.setQueueJobId(claimed.job.id, bullmqJobId);
  } catch (error) {
    logger.warn(
      { jobType, dedupeKey, bullmqJobId, jobId: claimed.job.id, err: error },
      "failed to persist queueJobId after enqueue",
    );
  }

  return {
    jobId: claimed.job.id,
    dedupeKey,
    reused: resolved.reused,
    enqueued: true,
    bullmqJobId,
  };
}
