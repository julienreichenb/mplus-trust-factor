import {
  decideScoreRefresh,
  isScoreWithinTtl,
  type ScoreDetailedRefreshStatus,
  type PublicScoreState,
  type ScoreRefreshDecision,
} from "@mplus/config";

export type ProfileRefreshStatus = "FRESH" | "STALE" | "QUEUED" | "REFRESHING";
export type DetailedRefreshStatus = ScoreDetailedRefreshStatus;

/** @deprecated Prefer isScoreWithinTtl(scoreCalculatedAt, scoreTtlSeconds). Kept for cooldown helpers. */
export function isFresh(lastPublicRefreshAt: Date | null | undefined, ttlSeconds: number): boolean {
  return isScoreWithinTtl(lastPublicRefreshAt, ttlSeconds);
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

/** SWR status for the character profile GET route (legacy helper — prefer decideScoreRefresh). */
export function determineProfileRefreshStatus(params: {
  hasScore: boolean;
  fresh: boolean;
}): ProfileRefreshStatus {
  if (!params.hasScore) return "QUEUED";
  return params.fresh ? "FRESH" : "STALE";
}

/** SWR status for the dedicated refresh-status route (legacy helper — prefer decideScoreRefresh). */
export function determineDetailedRefreshStatus(params: {
  hasScore: boolean;
  fresh: boolean;
  activeJobStatus: "QUEUED" | "ACTIVE" | null;
  lastJobFailed: boolean;
}): DetailedRefreshStatus {
  const decision = decideScoreRefresh({
    hasPublishedScore: params.hasScore,
    scoreCalculatedAt: params.fresh ? new Date() : new Date(0),
    scoreTtlSeconds: params.fresh ? 604_800 : 1,
    failureBackoffSeconds: params.lastJobFailed ? 3_600 : 0,
    activeJobStatus: params.activeJobStatus,
    latestJobStatus: params.lastJobFailed ? "FAILED" : params.hasScore ? "COMPLETED" : null,
    latestJobFinishedAt: params.lastJobFailed ? new Date() : null,
    contractReasons: [],
  });
  return decision.detailedRefreshStatus;
}

export type { PublicScoreState, ScoreRefreshDecision };
