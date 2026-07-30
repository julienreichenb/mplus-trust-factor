/** Default published Trust Score TTL: 7 days. */
export const DEFAULT_SCORE_TTL_SECONDS = 604_800;

/** Default backoff after a failed refresh before ordinary reads may enqueue again. */
export const DEFAULT_REFRESH_FAILURE_BACKOFF_SECONDS = 3_600;

/** Contract stale reason strings (aligned with `@mplus/contracts` RefreshContractStaleReason). */
export type ScoreContractStaleReason = string;

/**
 * Actions produced by the centralized score-refresh policy.
 * Callers must execute at most one side effect from a single decision.
 */
export type ScoreRefreshAction =
  | "NONE"
  | "ENQUEUE"
  | "RECALCULATE"
  | "REUSE_ACTIVE_JOB"
  | "BACKOFF";

/**
 * Public score lifecycle (provider states remain separate).
 * Prefer these names in docs and diagnostics; map to coarse API enums at the edge.
 */
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
  | "MODEL_CONTRACT_CHANGED"
  | "PROVIDER_EVIDENCE_INCOMPATIBLE"
  | "ACTIVE_JOB_EXISTS"
  | "RECENT_FAILURE"
  | "PROVIDER_NEWER_DIAGNOSTIC_ONLY"
  | "FORCE_REFRESH"
  | "GRADE_U_ELIGIBILITY";

/**
 * Coarse profile/search refreshStatus.
 * REFRESHING = usable published score + in-flight job (not STALE).
 * STALE = usable published score that requires updating.
 */
export type CoarseRefreshStatus = "FRESH" | "QUEUED" | "STALE" | "REFRESHING";

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
  /** Published snapshot calculation/publication time — not provider fetch time. */
  scoreCalculatedAt: Date | string | null | undefined;
  /** When published grade is U (eligibility), still usable but flagged. */
  gradeIsU?: boolean;
  scoreTtlSeconds: number;
  failureBackoffSeconds: number;
  activeJobStatus: "QUEUED" | "ACTIVE" | null;
  latestJobStatus: "QUEUED" | "ACTIVE" | "COMPLETED" | "FAILED" | string | null;
  latestJobFinishedAt: Date | string | null | undefined;
  /** Contract mismatch reasons vs active model/adapters (empty = compatible). */
  contractReasons: readonly ScoreContractStaleReason[];
  /** Diagnostic only — must not force enqueue. */
  providerNewerThanScore?: boolean;
  nowMs?: number;
};

/** Reasons that invalidate persisted provider evidence → full refresh required. */
const PROVIDER_INVALIDATING_REASONS: ReadonlySet<string> = new Set([
  "OBSERVATION_SCHEMA_CHANGED",
  "WCL_ADAPTER_CHANGED",
  "BLIZZARD_ADAPTER_CHANGED",
  "RAIDERIO_ADAPTER_CHANGED",
  "RUN_SELECTION_CHANGED",
  "ABILITY_CATALOG_CHANGED",
  "MECHANIC_CATALOG_CHANGED",
  "ACTIVE_SEASON_CHANGED",
  "ZONE_OR_PARTITION_CHANGED",
  "CONTRACT_MISSING",
]);

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
  return nowMs - at <= ttlSeconds * 1000;
}

export function isWithinFailureBackoff(
  latestJobStatus: string | null | undefined,
  latestJobFinishedAt: Date | string | null | undefined,
  backoffSeconds: number,
  nowMs = Date.now(),
): boolean {
  if (latestJobStatus !== "FAILED") return false;
  if (!latestJobFinishedAt) return true;
  const at =
    typeof latestJobFinishedAt === "string"
      ? Date.parse(latestJobFinishedAt)
      : latestJobFinishedAt.getTime();
  if (!Number.isFinite(at)) return true;
  return nowMs - at < backoffSeconds * 1000;
}

/**
 * Prefer RECALCULATE when only the scoring model changed and persisted evidence
 * remains compatible. Any adapter/schema/season mismatch requires a full refresh.
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

/**
 * Pure, centralized Trust Score refresh decision.
 * Reading fresh profile/search/account data must produce action NONE (zero enqueue).
 */
export function decideScoreRefresh(input: ScoreRefreshDecisionInput): ScoreRefreshDecision {
  const nowMs = input.nowMs ?? Date.now();
  const providerNewer = Boolean(input.providerNewerThanScore);
  const ttlFresh = isScoreWithinTtl(input.scoreCalculatedAt, input.scoreTtlSeconds, nowMs);
  const inBackoff = isWithinFailureBackoff(
    input.latestJobStatus,
    input.latestJobFinishedAt,
    input.failureBackoffSeconds,
    nowMs,
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

  if (!input.hasPublishedScore) {
    if (inBackoff) {
      return {
        action: "BACKOFF",
        publicState: "UNAVAILABLE",
        reason: "RECENT_FAILURE",
        profileRefreshStatus: "QUEUED",
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

  // Published score exists from here.
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

  if (input.contractReasons.length > 0) {
    const recalculate = preferRecalculateOnly(input.contractReasons);
    const needsProvider = input.contractReasons.some((r) => PROVIDER_INVALIDATING_REASONS.has(r));
    return withProviderDiagnostic(
      {
        action: recalculate && !needsProvider ? "RECALCULATE" : "ENQUEUE",
        publicState: "STALE_USABLE",
        reason: recalculate ? "MODEL_CONTRACT_CHANGED" : "PROVIDER_EVIDENCE_INCOMPATIBLE",
        profileRefreshStatus: "STALE",
        detailedRefreshStatus: "STALE",
        warningCodes: [...input.contractReasons],
      },
      providerNewer,
    );
  }

  if (!ttlFresh) {
    return withProviderDiagnostic(
      {
        action: "ENQUEUE",
        publicState: "STALE_USABLE",
        reason: "SCORE_TTL_EXPIRED",
        profileRefreshStatus: "STALE",
        detailedRefreshStatus: "STALE",
        warningCodes: [],
      },
      providerNewer,
    );
  }

  if (input.gradeIsU) {
    return withProviderDiagnostic(
      {
        action: "NONE",
        publicState: "GRADE_U",
        reason: "GRADE_U_ELIGIBILITY",
        profileRefreshStatus: "FRESH",
        detailedRefreshStatus: "FRESH",
        warningCodes: [],
      },
      providerNewer,
    );
  }

  return withProviderDiagnostic(
    {
      action: "NONE",
      publicState: "FRESH",
      reason: "WITHIN_SCORE_TTL",
      profileRefreshStatus: "FRESH",
      detailedRefreshStatus: "FRESH",
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
    case "FAILED_FALLBACK":
      return "FAILED";
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

/** Exported for tests — finishedAt age helper. */
export function scoreAgeMs(
  scoreCalculatedAt: Date | string | null | undefined,
  nowMs = Date.now(),
): number | null {
  const at = toMs(scoreCalculatedAt);
  if (at == null) return null;
  return nowMs - at;
}
