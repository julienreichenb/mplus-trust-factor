/** Default published Trust Score TTL: 7 days. */
export const DEFAULT_SCORE_TTL_SECONDS = 604_800;

/** A +50 Blizzard Mythic+ rating gain invalidates an otherwise fresh score. */
export const DEFAULT_MYTHIC_RATING_STALE_DELTA = 50;

/** Default backoff after a failed refresh before ordinary reads may enqueue again. */
export const DEFAULT_REFRESH_FAILURE_BACKOFF_SECONDS = 3_600;

/** Contract stale reason strings (aligned with `@mplus/contracts` RefreshContractStaleReason). */
export type ScoreContractStaleReason = string;

/**
 * Actions produced by the centralized score-refresh policy.
 * `RECALCULATE` is kept in the public type for compatibility with explicit admin/bulk
 * workflows, but profile-read freshness decisions never emit it.
 */
export type ScoreRefreshAction =
  | "NONE"
  | "ENQUEUE"
  | "RECALCULATE"
  | "REUSE_ACTIVE_JOB"
  | "BACKOFF";

/** Public score lifecycle (provider states remain separate). */
export type PublicScoreState =
  | "NO_SCORE_QUEUED"
  | "CALCULATING"
  | "FRESH"
  | "STALE_USABLE"
  | "REFRESHING"
  | "FAILED_FALLBACK"
  | "UNAVAILABLE"
  | "GRADE_U";

export type ScoreRefreshReason =
  | "WITHIN_SCORE_TTL"
  | "NO_PUBLISHED_SCORE"
  | "SCORE_TTL_EXPIRED"
  | "MYTHIC_RATING_INCREASED"
  | "MODEL_CONTRACT_CHANGED"
  | "PROVIDER_EVIDENCE_INCOMPATIBLE"
  | "ACTIVE_JOB_EXISTS"
  | "RECENT_FAILURE"
  | "STALE_CONTRACT"
  | "NOT_REFRESH_ELIGIBLE"
  | "PROVIDER_NEWER_DIAGNOSTIC_ONLY"
  | "FORCE_REFRESH"
  | "GRADE_U_ELIGIBILITY";

/**
 * Coarse profile status. `QUEUED` / in-flight states must only appear when an
 * active durable job exists (or was just enqueued). Terminal no-score failures
 * use `FAILED` so profile and `/refresh-status` agree.
 */
export type CoarseRefreshStatus = "FRESH" | "QUEUED" | "STALE" | "REFRESHING" | "FAILED";

/** Dedicated refresh-status route enum. */
export type DetailedRefreshStatus =
  | "FRESH"
  | "QUEUED"
  | "STALE"
  | "IN_PROGRESS"
  | "FAILED";

export type ScoreRefreshDecision = {
  action: ScoreRefreshAction;
  publicState: PublicScoreState;
  reason: ScoreRefreshReason;
  /** Coarse API status for profile / search responses. */
  profileRefreshStatus: CoarseRefreshStatus;
  /** Status for GET refresh-status. */
  detailedRefreshStatus: DetailedRefreshStatus;
  /** Warning codes to surface (never alone cause enqueue when action is NONE). */
  warningCodes: string[];
};

export type ScoreRefreshDecisionInput = {
  hasPublishedScore: boolean;
  /** Product score calculation/publication time — not provider fetch time. */
  scoreCalculatedAt: Date | string | null | undefined;
  /** When published grade is U (eligibility), still usable but flagged. */
  gradeIsU?: boolean;
  scoreTtlSeconds: number;
  failureBackoffSeconds: number;
  activeJobStatus: "QUEUED" | "ACTIVE" | null;
  latestJobStatus: "QUEUED" | "ACTIVE" | "COMPLETED" | "FAILED" | string | null;
  latestJobFinishedAt: Date | string | null | undefined;
  /** Durable job.error.code from the latest terminal job, when present. */
  latestJobErrorCode?: string | null;
  /**
   * Contract diagnostics versus the current runtime. These are intentionally NOT
   * freshness triggers for an existing product score. New configuration applies on
   * the next legitimate refresh instead of mass-invalidating already published scores.
   */
  contractReasons: readonly ScoreContractStaleReason[];
  /**
   * Current Blizzard Mythic+ rating minus the rating captured for the product score.
   * Null/undefined means no trustworthy comparison is available.
   */
  mythicRatingDelta?: number | null;
  /** Diagnostic only — must not force enqueue. */
  providerNewerThanScore?: boolean;
  nowMs?: number;
};

/** Preflight contract failures — not provider failures and not generic backoff. */
export const STALE_CONTRACT_FAILURE_CODES: ReadonlySet<string> = new Set([
  "REFRESH_CONTRACT_PREFLIGHT_MISMATCH",
  "REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH",
]);

/** Eligibility gate failures — not provider failures and not generic backoff. */
export const ELIGIBILITY_FAILURE_CODES: ReadonlySet<string> = new Set([
  "CHARACTER_BELOW_MAX_LEVEL",
  "CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE",
  "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
]);

export function isStaleContractFailureCode(code: string | null | undefined): boolean {
  return typeof code === "string" && STALE_CONTRACT_FAILURE_CODES.has(code);
}

export function isEligibilityFailureCode(code: string | null | undefined): boolean {
  return typeof code === "string" && ELIGIBILITY_FAILURE_CODES.has(code);
}

/** Read durable IngestionJob.error.code when present. */
export function extractJobErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

export function isScoreWithinTtl(
  scoreCalculatedAt: Date | string | null | undefined,
  ttlSeconds: number,
  nowMs = Date.now(),
): boolean {
  if (!scoreCalculatedAt) return false;
  const at =
    typeof scoreCalculatedAt === "string"
      ? Date.parse(scoreCalculatedAt)
      : scoreCalculatedAt.getTime();
  if (!Number.isFinite(at)) return false;
  // Exactly TTL seconds old is stale by product contract (age >= TTL).
  return nowMs - at < ttlSeconds * 1000;
}

export function isWithinFailureBackoff(
  latestJobStatus: string | null | undefined,
  latestJobFinishedAt: Date | string | null | undefined,
  backoffSeconds: number,
  nowMs = Date.now(),
  latestJobErrorCode?: string | null,
): boolean {
  if (latestJobStatus !== "FAILED") return false;
  // Stale-contract preflight failures must not drive provider/ops failure cooldown.
  if (isStaleContractFailureCode(latestJobErrorCode)) return false;
  // Eligibility gate failures are non-retryable and must not enter BACKOFF.
  if (isEligibilityFailureCode(latestJobErrorCode)) return false;
  if (!latestJobFinishedAt) return true;
  const at =
    typeof latestJobFinishedAt === "string"
      ? Date.parse(latestJobFinishedAt)
      : latestJobFinishedAt.getTime();
  if (!Number.isFinite(at)) return true;
  return nowMs - at < backoffSeconds * 1000;
}

/**
 * Compatibility helper retained for explicit admin/bulk workflows. Product profile
 * reads deliberately do not use this to decide freshness anymore.
 */
export function preferRecalculateOnly(contractReasons: readonly ScoreContractStaleReason[]): boolean {
  if (contractReasons.length === 0) return false;
  return contractReasons.every((r) => r === "SCORING_MODEL_CHANGED");
}

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const at = typeof value === "string" ? Date.parse(value) : value.getTime();
  return Number.isFinite(at) ? at : null;
}

function withProviderDiagnostic(
  decision: ScoreRefreshDecision,
  providerNewer: boolean,
): ScoreRefreshDecision {
  if (!providerNewer) return decision;
  if (decision.warningCodes.includes("SCORE_STALE_VS_PROVIDERS")) return decision;
  return {
    ...decision,
    reason:
      decision.action === "NONE" && decision.publicState === "FRESH"
        ? "PROVIDER_NEWER_DIAGNOSTIC_ONLY"
        : decision.reason,
    warningCodes: [...decision.warningCodes, "SCORE_STALE_VS_PROVIDERS"],
  };
}

function existingScoreDiagnostics(input: ScoreRefreshDecisionInput): string[] {
  const warnings: string[] = [];
  if (
    input.latestJobStatus === "FAILED" &&
    isEligibilityFailureCode(input.latestJobErrorCode) &&
    input.latestJobErrorCode
  ) {
    warnings.push(input.latestJobErrorCode);
  }
  // Contract mismatches intentionally do not surface as STALE_CONTRACT here: a
  // configuration change is not a freshness failure of an already published score.
  return warnings;
}

/**
 * Pure, centralized Trust Score refresh decision.
 *
 * Existing scores have exactly two automatic freshness triggers:
 *   1. age >= SCORE_TTL_SECONDS;
 *   2. Blizzard Mythic+ rating increased by >= 50 since the score baseline.
 *
 * Model/catalog/context/adapter changes are diagnostics only for existing scores and
 * are adopted on the next legitimate refresh. They never cause profile-read
 * RECALCULATE/ENQUEUE on their own.
 */
export function decideScoreRefresh(input: ScoreRefreshDecisionInput): ScoreRefreshDecision {
  const nowMs = input.nowMs ?? Date.now();
  const providerNewer = Boolean(input.providerNewerThanScore);
  const ttlFresh = isScoreWithinTtl(input.scoreCalculatedAt, input.scoreTtlSeconds, nowMs);
  const ratingDelta =
    typeof input.mythicRatingDelta === "number" && Number.isFinite(input.mythicRatingDelta)
      ? input.mythicRatingDelta
      : null;
  const ratingStale =
    ratingDelta != null && ratingDelta >= DEFAULT_MYTHIC_RATING_STALE_DELTA;
  const eligibilityFailure =
    input.latestJobStatus === "FAILED" && isEligibilityFailureCode(input.latestJobErrorCode);
  const inBackoff = isWithinFailureBackoff(
    input.latestJobStatus,
    input.latestJobFinishedAt,
    input.failureBackoffSeconds,
    nowMs,
    input.latestJobErrorCode,
  );

  if (input.activeJobStatus) {
    if (input.hasPublishedScore) {
      return withProviderDiagnostic(
        {
          action: "REUSE_ACTIVE_JOB",
          publicState: "REFRESHING",
          reason: "ACTIVE_JOB_EXISTS",
          profileRefreshStatus: "REFRESHING",
          detailedRefreshStatus: input.activeJobStatus === "ACTIVE" ? "IN_PROGRESS" : "QUEUED",
          warningCodes: [],
        },
        providerNewer,
      );
    }
    return {
      action: "REUSE_ACTIVE_JOB",
      publicState: input.activeJobStatus === "ACTIVE" ? "CALCULATING" : "NO_SCORE_QUEUED",
      reason: "ACTIVE_JOB_EXISTS",
      profileRefreshStatus: "QUEUED",
      detailedRefreshStatus: input.activeJobStatus === "ACTIVE" ? "IN_PROGRESS" : "QUEUED",
      warningCodes: [],
    };
  }

  // No product score yet: preserve the existing bootstrap/eligibility/failure semantics.
  if (!input.hasPublishedScore) {
    if (eligibilityFailure) {
      const warning = input.latestJobErrorCode ?? "NOT_REFRESH_ELIGIBLE";
      return {
        action: "NONE",
        publicState: "UNAVAILABLE",
        reason: "NOT_REFRESH_ELIGIBLE",
        profileRefreshStatus: "FAILED",
        detailedRefreshStatus: "FAILED",
        warningCodes: [warning],
      };
    }
    if (inBackoff) {
      return {
        action: "BACKOFF",
        publicState: "UNAVAILABLE",
        reason: "RECENT_FAILURE",
        profileRefreshStatus: "FAILED",
        detailedRefreshStatus: "FAILED",
        warningCodes: ["REFRESH_FAILED"],
      };
    }
    return {
      action: "ENQUEUE",
      publicState: "NO_SCORE_QUEUED",
      reason: "NO_PUBLISHED_SCORE",
      profileRefreshStatus: "QUEUED",
      detailedRefreshStatus: "QUEUED",
      warningCodes: [],
    };
  }

  const staleByProductRule = !ttlFresh || ratingStale;

  // A failed previous job, stale contract, model switch, adapter switch, etc. does
  // not make an otherwise fresh published score stale.
  if (!staleByProductRule) {
    const diagnostics = existingScoreDiagnostics(input);
    const decision: ScoreRefreshDecision = input.gradeIsU
      ? {
          action: "NONE",
          publicState: "GRADE_U",
          reason: "GRADE_U_ELIGIBILITY",
          profileRefreshStatus: "FRESH",
          detailedRefreshStatus: "FRESH",
          warningCodes: diagnostics,
        }
      : {
          action: "NONE",
          publicState: "FRESH",
          reason: "WITHIN_SCORE_TTL",
          profileRefreshStatus: "FRESH",
          detailedRefreshStatus: "FRESH",
          warningCodes: diagnostics,
        };
    return withProviderDiagnostic(decision, providerNewer);
  }

  // The score is legitimately stale. A recent provider/ops failure suppresses a
  // retry storm while preserving the last usable score.
  if (inBackoff) {
    return withProviderDiagnostic(
      {
        action: "BACKOFF",
        publicState: "FAILED_FALLBACK",
        reason: "RECENT_FAILURE",
        profileRefreshStatus: "STALE",
        detailedRefreshStatus: "FAILED",
        warningCodes: ["REFRESH_FAILED"],
      },
      providerNewer,
    );
  }

  return withProviderDiagnostic(
    {
      action: "ENQUEUE",
      publicState: "STALE_USABLE",
      reason: ratingStale ? "MYTHIC_RATING_INCREASED" : "SCORE_TTL_EXPIRED",
      profileRefreshStatus: "STALE",
      detailedRefreshStatus: "STALE",
      warningCodes: [],
    },
    providerNewer,
  );
}

/** Map public lifecycle → account list status (score remains visible when REFRESHING). */
export type AccountTrustLifecycleStatus =
  | "NOT_REQUESTED"
  | "DISCOVERING"
  | "QUEUED"
  | "RUNNING"
  | "AVAILABLE"
  | "PARTIAL"
  | "STALE"
  | "REFRESHING"
  | "FAILED"
  | "UNAVAILABLE";

export function toAccountTrustStatus(
  decision: ScoreRefreshDecision,
  opts: { partial?: boolean; discovering?: boolean } = {},
): AccountTrustLifecycleStatus {
  if (opts.discovering && decision.publicState === "NO_SCORE_QUEUED") return "DISCOVERING";
  switch (decision.publicState) {
    case "FRESH":
    case "GRADE_U":
      return opts.partial ? "PARTIAL" : "AVAILABLE";
    case "STALE_USABLE":
      return "STALE";
    case "REFRESHING":
      return "REFRESHING";
    // Published score + failed refresh must not collapse to public FAILED.
    case "FAILED_FALLBACK":
      return "STALE";
    case "UNAVAILABLE":
      return "UNAVAILABLE";
    case "CALCULATING":
      return "RUNNING";
    case "NO_SCORE_QUEUED":
      return "QUEUED";
    default:
      return "NOT_REQUESTED";
  }
}

/** Exported for tests — calculatedAt age helper. */
export function scoreAgeMs(
  scoreCalculatedAt: Date | string | null | undefined,
  nowMs = Date.now(),
): number | null {
  const at = toMs(scoreCalculatedAt);
  if (at == null) return null;
  return nowMs - at;
}
