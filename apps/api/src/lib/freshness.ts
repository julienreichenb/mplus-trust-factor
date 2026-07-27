export type ProfileRefreshStatus = "FRESH" | "STALE" | "QUEUED";
export type DetailedRefreshStatus = "FRESH" | "QUEUED" | "STALE" | "IN_PROGRESS" | "FAILED";

/** True when `lastPublicRefreshAt` is within `ttlSeconds` of now. */
export function isFresh(lastPublicRefreshAt: Date | null | undefined, ttlSeconds: number): boolean {
  if (!lastPublicRefreshAt) return false;
  const ageMs = Date.now() - lastPublicRefreshAt.getTime();
  return ageMs <= ttlSeconds * 1000;
}

/** Seconds remaining in the manual-refresh cooldown window (0 when elapsed or never refreshed). */
export function cooldownSecondsRemaining(
  lastPublicRefreshAt: Date | null | undefined,
  cooldownSeconds: number,
): number {
  if (!lastPublicRefreshAt) return 0;
  const elapsedSeconds = (Date.now() - lastPublicRefreshAt.getTime()) / 1000;
  return Math.max(0, Math.ceil(cooldownSeconds - elapsedSeconds));
}

/** SWR status for the character profile GET route (no in-flight job distinction needed). */
export function determineProfileRefreshStatus(params: {
  hasScore: boolean;
  fresh: boolean;
}): ProfileRefreshStatus {
  if (!params.hasScore) return "QUEUED";
  return params.fresh ? "FRESH" : "STALE";
}

/** SWR status for the dedicated refresh-status route, aware of active/failed jobs. */
export function determineDetailedRefreshStatus(params: {
  hasScore: boolean;
  fresh: boolean;
  activeJobStatus: "QUEUED" | "ACTIVE" | null;
  lastJobFailed: boolean;
}): DetailedRefreshStatus {
  if (params.activeJobStatus) {
    return params.activeJobStatus === "ACTIVE" ? "IN_PROGRESS" : "QUEUED";
  }
  if (!params.hasScore) {
    return params.lastJobFailed ? "FAILED" : "QUEUED";
  }
  return params.fresh ? "FRESH" : "STALE";
}
