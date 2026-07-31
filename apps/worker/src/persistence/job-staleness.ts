import type { IngestionJob } from "@mplus/database";

/** QUEUED rows with no startedAt older than this are treated as abandoned. */
export const DEFAULT_STALE_QUEUED_MS = 15 * 60 * 1000;

/**
 * ACTIVE rows whose startedAt (else scheduledAt) is older than this are treated as
 * abandoned worker zombies — safe to force-cancel / fail for re-enqueue.
 */
export const DEFAULT_STALE_ACTIVE_MS = 30 * 60 * 1000;

export function isStaleQueued(
  job: Pick<IngestionJob, "status" | "startedAt" | "scheduledAt">,
  nowMs = Date.now(),
  thresholdMs = DEFAULT_STALE_QUEUED_MS,
): boolean {
  if (job.status !== "QUEUED") return false;
  if (job.startedAt != null) return false;
  return nowMs - job.scheduledAt.getTime() > thresholdMs;
}

export function isStaleActive(
  job: Pick<IngestionJob, "status" | "startedAt" | "scheduledAt">,
  nowMs = Date.now(),
  thresholdMs = DEFAULT_STALE_ACTIVE_MS,
): boolean {
  if (job.status !== "ACTIVE") return false;
  const anchor = job.startedAt?.getTime() ?? job.scheduledAt.getTime();
  return nowMs - anchor > thresholdMs;
}
