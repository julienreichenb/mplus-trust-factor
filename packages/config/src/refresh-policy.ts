/** Adaptive cadence tiers — hypotheses validated against measured cost before activation. */
export type CadenceTier = "A" | "B" | "C" | "D";

/** Env fields required to build refresh policy — kept local to avoid circular imports. */
export type RefreshPolicyEnv = {
  REFRESH_SCHEDULER_ENABLED: boolean;
  REFRESH_DRY_RUN_ONLY: boolean;
  REFRESH_SAFETY_RESERVE_FRACTION: number;
  REFRESH_BATCH_SIZE: number;
  REFRESH_GLOBAL_CONCURRENCY: number;
  REFRESH_PER_CHARACTER_COOLDOWN_SECONDS: number;
  REFRESH_SPREAD_HOURS: number;
  REFRESH_TRACKED_TOP_PERCENT: number;
  REFRESH_RATING_THRESHOLD: number;
};

export interface CadenceTierPolicy {
  tier: CadenceTier;
  /** Human-readable intent. */
  label: string;
  /** Target refresh interval in hours. Null = on demand only. */
  intervalHours: number | null;
  /** Minimum Mythic+ rating to qualify (null = no rating gate). */
  minRating: number | null;
  /** Require activity within this many days (null = no activity gate). */
  activityWithinDays: number | null;
  /** Prefer recently viewed profiles (null = ignore views). */
  viewedWithinDays: number | null;
}

export interface RefreshPolicyConfig {
  version: string;
  /** Hard gate: recurring production enqueue stays off until explicitly enabled. */
  schedulerEnabled: boolean;
  /** When true, planner never enqueues provider-backed refresh jobs. */
  dryRunOnly: boolean;
  safetyReserveFraction: number;
  batchSize: number;
  /**
   * Mapped from REFRESH_GLOBAL_CONCURRENCY (environment admitted-pipeline cap).
   * Not applied to BullMQ Worker concurrency; unused for live admission until
   * REFRESH_CONCURRENCY_ENABLED + enforce mode on a later branch.
   */
  globalConcurrency: number;
  perCharacterCooldownSeconds: number;
  /** Spread planned work across this many hours. */
  spreadHours: number;
  /**
   * Indicative elite share of the configured denominator (not a global WoW percentile).
   * Must be paired with an explicit denominator declaration before use.
   */
  trackedTopPercent: number;
  ratingThreshold: number;
  tiers: Record<CadenceTier, CadenceTierPolicy>;
}

export const REFRESH_POLICY_VERSION = "2026-07-29";

export const DEFAULT_CADENCE_TIERS: Record<CadenceTier, CadenceTierPolicy> = {
  A: {
    tier: "A",
    label: "elite_active_high_demand",
    intervalHours: 24,
    minRating: 3000,
    activityWithinDays: 7,
    // Soft preference until profile-view instrumentation exists; not a hard gate.
    viewedWithinDays: null,
  },
  B: {
    tier: "B",
    label: "strong_and_active",
    intervalHours: 72,
    minRating: 2500,
    activityWithinDays: 14,
    viewedWithinDays: null,
  },
  C: {
    tier: "C",
    label: "other_active_tracked",
    intervalHours: 168,
    minRating: null,
    activityWithinDays: 21,
    viewedWithinDays: null,
  },
  D: {
    tier: "D",
    label: "inactive_or_low_priority",
    intervalHours: null,
    minRating: null,
    activityWithinDays: null,
    viewedWithinDays: null,
  },
};

export function buildRefreshPolicyConfig(env: RefreshPolicyEnv): RefreshPolicyConfig {
  return {
    version: REFRESH_POLICY_VERSION,
    schedulerEnabled: env.REFRESH_SCHEDULER_ENABLED,
    dryRunOnly: env.REFRESH_DRY_RUN_ONLY,
    safetyReserveFraction: env.REFRESH_SAFETY_RESERVE_FRACTION,
    batchSize: env.REFRESH_BATCH_SIZE,
    globalConcurrency: env.REFRESH_GLOBAL_CONCURRENCY,
    perCharacterCooldownSeconds: env.REFRESH_PER_CHARACTER_COOLDOWN_SECONDS,
    spreadHours: env.REFRESH_SPREAD_HOURS,
    trackedTopPercent: env.REFRESH_TRACKED_TOP_PERCENT,
    ratingThreshold: env.REFRESH_RATING_THRESHOLD,
    tiers: structuredClone(DEFAULT_CADENCE_TIERS),
  };
}

/**
 * Assign the highest matching tier for a candidate. Tier D is the fallback
 * (on-demand). Policy thresholds are configuration, not hardcoded call sites.
 */
export function assignCadenceTier(
  input: {
    mythicRating: number | null;
    lastSeenAt: Date | null;
    lastViewedAt: Date | null;
    nowMs?: number;
  },
  policy: RefreshPolicyConfig,
): CadenceTier {
  const nowMs = input.nowMs ?? Date.now();
  const rating = input.mythicRating ?? 0;

  const matches = (tier: CadenceTierPolicy): boolean => {
    if (tier.tier === "D") return true;
    if (tier.intervalHours == null) return false;
    if (tier.minRating != null && rating < tier.minRating) return false;
    if (tier.activityWithinDays != null) {
      if (!input.lastSeenAt) return false;
      const windowMs = tier.activityWithinDays * 86_400_000;
      if (nowMs - input.lastSeenAt.getTime() > windowMs) return false;
    }
    if (tier.viewedWithinDays != null) {
      if (!input.lastViewedAt) return false;
      const windowMs = tier.viewedWithinDays * 86_400_000;
      if (nowMs - input.lastViewedAt.getTime() > windowMs) return false;
    }
    return true;
  };

  for (const tier of ["A", "B", "C", "D"] as const) {
    if (matches(policy.tiers[tier])) return tier;
  }
  return "D";
}

export function freshnessTtlMsForTier(tier: CadenceTier, policy: RefreshPolicyConfig): number | null {
  const hours = policy.tiers[tier].intervalHours;
  if (hours == null) return null;
  return hours * 3_600_000;
}
