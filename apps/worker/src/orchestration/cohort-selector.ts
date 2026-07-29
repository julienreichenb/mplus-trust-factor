/**
 * Configurable refresh cohort strategies.
 * "Top N%" always requires an explicit tracked denominator — never a global WoW claim.
 */

import { createHash } from "node:crypto";

export type CohortStrategy =
  | "ON_DEMAND"
  | "RECENTLY_VIEWED"
  | "RECENTLY_ACTIVE"
  | "RATING_THRESHOLD"
  | "TRACKED_PERCENTILE"
  | "TOP_N_REGION"
  | "TOP_N_SPEC_ROLE"
  | "PUBLISHED_AND_STALE"
  | "MANUAL_PRIORITY"
  | "DAILY_ELITE_COHORT";

/** Authoritative denominators for percentile claims. */
export type CohortDenominatorKey =
  | "tracked_published_current_season_rating"
  | "tracked_with_published_score"
  | "tracked_recently_active"
  | "tracked_all"
  | "manual_explicit_set";

export interface CohortDenominator {
  key: CohortDenominatorKey;
  /** Human-readable description — required before any percentile claim. */
  description: string;
  count: number;
}

export interface CohortSelectorConfig {
  strategy: CohortStrategy;
  /** Minimum current-season Mythic+ rating for RATING_THRESHOLD / DAILY_ELITE_COHORT. */
  ratingThreshold?: number;
  /** Activity within N days (lastSeenAt) for DAILY_ELITE / RECENTLY_ACTIVE. */
  activityWithinDays?: number;
  /** Profile viewed within N days for RECENTLY_VIEWED. */
  viewedWithinDays?: number;
  /**
   * Keep the top N% of the ranked denominator for TRACKED_PERCENTILE / TOP_N_*.
   * Indicative default is 25 — never claimed as a global WoW percentile.
   */
  trackedTopPercent?: number;
  /** Max characters per batch. */
  batchSize?: number;
  /** Spread batch across this many hours. */
  spreadHours?: number;
  /** Region filter for TOP_N_REGION (uppercase). */
  region?: string;
  /** Spec/role filter for TOP_N_SPEC_ROLE. */
  specRole?: string;
  /**
   * Required for TRACKED_PERCENTILE / TOP_N_* strategies.
   * Rejected when missing so we never invent a global percentile.
   */
  denominator?: CohortDenominator;
}

export interface CohortCandidate {
  characterId: string;
  region: string;
  realmSlug: string;
  name: string;
  mythicRating: number | null;
  lastPublicRefreshAt: Date | null;
  lastSeenAt: Date | null;
  lastViewedAt: Date | null;
  hasPublishedScore: boolean;
  specRole: string | null;
  priority: number;
  manualPriority?: boolean;
}

export interface CohortSelectionResult {
  strategy: CohortStrategy;
  candidates: CohortCandidate[];
  skippedFresh: number;
  skippedNoBudget: number;
  denominator: CohortDenominator | null;
  /** Stable fingerprint of selection inputs for determinism checks. */
  selectionFingerprint: string;
}

export const DEFAULT_COHORT_CONFIG: CohortSelectorConfig = {
  strategy: "ON_DEMAND",
  ratingThreshold: 2500,
  activityWithinDays: 14,
  viewedWithinDays: 7,
  trackedTopPercent: 25,
  batchSize: 500,
  spreadHours: 24,
};

export const RECOMMENDED_DENOMINATOR: CohortDenominator = {
  key: "tracked_published_current_season_rating",
  description:
    "Tracked characters with a current-season Mythic+ rating and at least one published score",
  count: 0,
};

export const COHORT_FEASIBILITY_MATRIX = [
  {
    strategy: "RATING_THRESHOLD",
    dataSource: "Latest CharacterSnapshot.mythicRating on tracked characters",
    denominator: "Tracked characters above configured threshold",
    apiCost: "Predictable — bounded by threshold selectivity",
    bias: "High-rated players only; misses rising alts below threshold",
    regionalCoverage: "Per-region via tracked set",
    feasibilityWithoutFullScan: true,
    complexity: "Low",
    abuseRisk: "Low — threshold is server-side config",
  },
  {
    strategy: "TRACKED_PERCENTILE",
    dataSource: "Ranked mythicRating within an explicit tracked denominator",
    denominator: "Must declare CohortDenominator (recommended: published + current-season rating)",
    apiCost: "Medium — proportional to selected top-N% of denominator",
    bias: "Toward already-discovered / published characters",
    regionalCoverage: "All regions present in denominator",
    feasibilityWithoutFullScan: true,
    complexity: "Low",
    abuseRisk: "Medium if claimed as global WoW top-N% without denominator",
  },
  {
    strategy: "TOP_N_REGION",
    dataSource: "Same as TRACKED_PERCENTILE filtered by region",
    denominator: "Tracked published characters in one region",
    apiCost: "Medium — per-region batch",
    bias: "Favours populous regions if batch size is global",
    regionalCoverage: "Single region per plan; fairness layer needed across regions",
    feasibilityWithoutFullScan: true,
    complexity: "Medium",
    abuseRisk: "Low",
  },
  {
    strategy: "TOP_N_SPEC_ROLE",
    dataSource: "Ranked rating within spec/role bucket",
    denominator: "Tracked published characters for one spec/role",
    apiCost: "Medium",
    bias: "Popular specs dominate unless fairness caps apply",
    regionalCoverage: "Depends on tracked distribution",
    feasibilityWithoutFullScan: true,
    complexity: "Medium",
    abuseRisk: "Low",
  },
  {
    strategy: "RECENTLY_VIEWED",
    dataSource: "character_profile_views",
    denominator: "Characters viewed in last N days",
    apiCost: "Low — demand-driven",
    bias: "Popular / searched characters; streamer amplification",
    regionalCoverage: "Global demand",
    feasibilityWithoutFullScan: true,
    complexity: "Medium — needs view instrumentation",
    abuseRisk: "High without rate limits / viewer hashing",
  },
  {
    strategy: "RECENTLY_ACTIVE",
    dataSource: "Character.lastSeenAt (refresh / Blizzard login signals)",
    denominator: "Tracked characters active in last N days",
    apiCost: "Medium",
    bias: "Toward frequently refreshed profiles",
    regionalCoverage: "Tracked regions",
    feasibilityWithoutFullScan: true,
    complexity: "Low",
    abuseRisk: "Low",
  },
  {
    strategy: "PUBLISHED_AND_STALE",
    dataSource: "CharacterPublishedScore + lastPublicRefreshAt",
    denominator: "Published tracked characters past freshness TTL",
    apiCost: "Medium — stale set size",
    bias: "Ignores unpublished / never-scored characters",
    regionalCoverage: "Tracked regions",
    feasibilityWithoutFullScan: true,
    complexity: "Low",
    abuseRisk: "Low",
  },
  {
    strategy: "MANUAL_PRIORITY",
    dataSource: "Explicit priority / admin queue",
    denominator: "manual_explicit_set",
    apiCost: "Operator-bounded",
    bias: "Operator choice",
    regionalCoverage: "As selected",
    feasibilityWithoutFullScan: true,
    complexity: "Low",
    abuseRisk: "Medium if admin tools lack audit",
  },
  {
    strategy: "DAILY_ELITE_COHORT",
    dataSource: "Composite: rating + activity + published + stale",
    denominator: "Configurable intersection of tracked characters",
    apiCost: "Budget-capped batch",
    bias: "Active high-rated published profiles",
    regionalCoverage: "All tracked regions (pair with fairness)",
    feasibilityWithoutFullScan: true,
    complexity: "Medium",
    abuseRisk: "Low",
  },
] as const;

function requiresDenominator(strategy: CohortStrategy): boolean {
  return strategy === "TRACKED_PERCENTILE" || strategy === "TOP_N_REGION" || strategy === "TOP_N_SPEC_ROLE";
}

function isFresh(
  lastPublicRefreshAt: Date | null,
  nowMs: number,
  freshnessTtlMs: number,
): boolean {
  if (!lastPublicRefreshAt) return false;
  return nowMs - lastPublicRefreshAt.getTime() <= freshnessTtlMs;
}

function stableSort(candidates: CohortCandidate[]): CohortCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const ratingDiff = (b.mythicRating ?? 0) - (a.mythicRating ?? 0);
    if (ratingDiff !== 0) return ratingDiff;
    return a.characterId.localeCompare(b.characterId);
  });
}

function fingerprint(strategy: CohortStrategy, ids: string[], denominator: CohortDenominator | null): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        strategy,
        ids,
        denominatorKey: denominator?.key ?? null,
        denominatorCount: denominator?.count ?? null,
      }),
      "utf8",
    )
    .digest("hex");
}

export function selectCohort(
  config: CohortSelectorConfig,
  candidates: CohortCandidate[],
  options: {
    nowMs?: number;
    freshnessTtlMs?: number;
    wclBudgetAvailable?: boolean;
    maxResults?: number;
  } = {},
): CohortSelectionResult {
  const nowMs = options.nowMs ?? Date.now();
  const freshnessTtlMs = options.freshnessTtlMs ?? 86_400_000;
  const maxResults = options.maxResults ?? config.batchSize ?? 500;

  if (config.strategy === "ON_DEMAND") {
    return {
      strategy: config.strategy,
      candidates: [],
      skippedFresh: 0,
      skippedNoBudget: 0,
      denominator: null,
      selectionFingerprint: fingerprint("ON_DEMAND", [], null),
    };
  }

  if (requiresDenominator(config.strategy)) {
    if (!config.denominator || config.denominator.count < 0 || !config.denominator.key) {
      throw new Error(
        `Cohort strategy ${config.strategy} requires an explicit CohortDenominator; refusing global percentile claim`,
      );
    }
  }

  if (options.wclBudgetAvailable === false) {
    return {
      strategy: config.strategy,
      candidates: [],
      skippedFresh: 0,
      skippedNoBudget: candidates.length,
      denominator: config.denominator ?? null,
      selectionFingerprint: fingerprint(config.strategy, [], config.denominator ?? null),
    };
  }

  let filtered = [...candidates];
  let skippedFresh = 0;

  if (config.strategy === "RATING_THRESHOLD" || config.strategy === "DAILY_ELITE_COHORT") {
    const threshold = config.ratingThreshold ?? 2500;
    filtered = filtered.filter((c) => (c.mythicRating ?? 0) >= threshold);
  }

  if (config.strategy === "RECENTLY_VIEWED") {
    const viewedMs = (config.viewedWithinDays ?? 7) * 86_400_000;
    filtered = filtered.filter(
      (c) => c.lastViewedAt != null && nowMs - c.lastViewedAt.getTime() <= viewedMs,
    );
  }

  if (config.strategy === "RECENTLY_ACTIVE" || config.strategy === "DAILY_ELITE_COHORT") {
    const activityMs = (config.activityWithinDays ?? 14) * 86_400_000;
    filtered = filtered.filter(
      (c) => c.lastSeenAt != null && nowMs - c.lastSeenAt.getTime() <= activityMs,
    );
  }

  if (config.strategy === "PUBLISHED_AND_STALE" || config.strategy === "DAILY_ELITE_COHORT") {
    filtered = filtered.filter((c) => c.hasPublishedScore);
  }

  if (config.strategy === "MANUAL_PRIORITY") {
    filtered = filtered.filter((c) => c.manualPriority === true || c.priority > 0);
  }

  if (config.strategy === "TOP_N_REGION") {
    const region = (config.region ?? "").toUpperCase();
    filtered = filtered.filter((c) => c.region.toUpperCase() === region);
  }

  if (config.strategy === "TOP_N_SPEC_ROLE") {
    const specRole = config.specRole ?? "";
    filtered = filtered.filter((c) => (c.specRole ?? "") === specRole);
  }

  // Skip already-fresh profiles for scheduled strategies.
  filtered = filtered.filter((c) => {
    const fresh = isFresh(c.lastPublicRefreshAt, nowMs, freshnessTtlMs);
    if (fresh) skippedFresh += 1;
    return !fresh;
  });

  if (
    config.strategy === "TRACKED_PERCENTILE" ||
    config.strategy === "TOP_N_REGION" ||
    config.strategy === "TOP_N_SPEC_ROLE"
  ) {
    const pct = config.trackedTopPercent ?? 25;
    filtered = stableSort(filtered);
    const cutoff = Math.max(1, Math.ceil(filtered.length * (pct / 100)));
    filtered = filtered.slice(0, cutoff);
  } else {
    filtered = stableSort(filtered);
  }

  const selected = filtered.slice(0, maxResults);
  return {
    strategy: config.strategy,
    candidates: selected,
    skippedFresh,
    skippedNoBudget: 0,
    denominator: config.denominator ?? null,
    selectionFingerprint: fingerprint(
      config.strategy,
      selected.map((c) => c.characterId),
      config.denominator ?? null,
    ),
  };
}

/** Deterministic scheduled job key for coalesce across planner restarts. */
export function buildScheduledRefreshJobKey(parts: {
  characterId: string;
  cadenceTier: string;
  strategy: string;
  plannedDatasets: string[];
}): string {
  const datasets = [...parts.plannedDatasets].sort().join(",");
  return createHash("sha256")
    .update(
      `scheduled-refresh|${parts.characterId}|${parts.cadenceTier}|${parts.strategy}|${datasets}`,
      "utf8",
    )
    .digest("hex");
}
