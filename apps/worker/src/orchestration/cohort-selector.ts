/**
 * Configurable daily refresh cohort strategies.
 * Production-safe first version uses tracked characters with configurable conditions.
 */

export type CohortStrategy =
  | "ON_DEMAND"
  | "RECENTLY_VIEWED"
  | "RATING_THRESHOLD"
  | "TRACKED_PERCENTILE"
  | "MANUAL_PRIORITY"
  | "DAILY_ELITE_COHORT";

export interface CohortSelectorConfig {
  strategy: CohortStrategy;
  /** Minimum current-season Mythic+ rating for RATING_THRESHOLD / DAILY_ELITE_COHORT. */
  ratingThreshold?: number;
  /** Activity within N days for DAILY_ELITE_COHORT. */
  activityWithinDays?: number;
  /** Profile viewed within N days for RECENTLY_VIEWED. */
  viewedWithinDays?: number;
  /** Percentile for TRACKED_PERCENTILE (0–100). Denominator must be validated before use. */
  trackedPercentile?: number;
  /** Max characters per daily batch. */
  batchSize?: number;
  /** Spread batch across this many hours. */
  spreadHours?: number;
}

export interface CohortCandidate {
  characterId: string;
  region: string;
  realmSlug: string;
  name: string;
  mythicRating: number | null;
  lastPublicRefreshAt: Date | null;
  lastViewedAt: Date | null;
  priority: number;
}

export interface CohortSelectionResult {
  strategy: CohortStrategy;
  candidates: CohortCandidate[];
  skippedFresh: number;
  skippedNoBudget: number;
}

export const DEFAULT_COHORT_CONFIG: CohortSelectorConfig = {
  strategy: "ON_DEMAND",
  ratingThreshold: 2500,
  activityWithinDays: 14,
  viewedWithinDays: 7,
  trackedPercentile: 75,
  batchSize: 500,
  spreadHours: 24,
};

/**
 * Feasibility matrix for daily cohort definitions.
 * See doc/architecture/persistence-refresh-hardening-audit.md for full analysis.
 */
export const COHORT_FEASIBILITY_MATRIX = [
  {
    strategy: "TRACKED_PERCENTILE (top 25%)",
    dataSource: "Internal tracked characters with current-season rating",
    denominator: "Characters with at least one published score",
    apiCost: "Medium — proportional to cohort size",
    freshness: "Daily within budget",
    regionalAvailability: "All regions where characters are tracked",
    bias: "Toward already-discovered characters",
    feasibilityWithoutFullScan: true,
    operationalComplexity: "Low — uses existing DB",
  },
  {
    strategy: "RATING_THRESHOLD",
    dataSource: "Raider.IO rating on tracked characters",
    dataSourceNote: "Requires prior refresh; no population scan",
    denominator: "Tracked characters above threshold",
    apiCost: "Predictable — bounded by threshold selectivity",
    freshness: "Daily for qualifying characters",
    regionalAvailability: "Per-region via tracked set",
    bias: "High-rated players only",
    feasibilityWithoutFullScan: true,
    operationalComplexity: "Low",
  },
  {
    strategy: "RECENTLY_VIEWED",
    dataSource: "Profile view events (requires instrumentation)",
    denominator: "Characters viewed in last N days",
    apiCost: "Low — demand-driven",
    freshness: "On view + daily for hot profiles",
    regionalAvailability: "Global",
    bias: "Popular / searched characters",
    feasibilityWithoutFullScan: true,
    operationalComplexity: "Medium — needs view tracking",
  },
  {
    strategy: "DAILY_ELITE_COHORT",
    dataSource: "Composite: rating + activity + published score + stale TTL",
    denominator: "Configurable intersection of tracked characters",
    apiCost: "Budget-capped batch",
    freshness: "Spread across day",
    regionalAvailability: "All tracked regions",
    bias: "Active high-rated published profiles",
    feasibilityWithoutFullScan: true,
    operationalComplexity: "Medium",
  },
] as const;

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
    return { strategy: config.strategy, candidates: [], skippedFresh: 0, skippedNoBudget: 0 };
  }

  if (options.wclBudgetAvailable === false) {
    return {
      strategy: config.strategy,
      candidates: [],
      skippedFresh: 0,
      skippedNoBudget: candidates.length,
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
      (c) => c.lastViewedAt && nowMs - c.lastViewedAt.getTime() <= viewedMs,
    );
  }

  if (config.strategy === "DAILY_ELITE_COHORT") {
    const activityMs = (config.activityWithinDays ?? 14) * 86_400_000;
    filtered = filtered.filter(
      (c) =>
        c.lastPublicRefreshAt != null &&
        (c.mythicRating ?? 0) >= (config.ratingThreshold ?? 2500),
    );
    // Stale-only: skip characters refreshed within TTL.
    const stale = filtered.filter((c) => {
      if (!c.lastPublicRefreshAt) return true;
      const fresh = nowMs - c.lastPublicRefreshAt.getTime() <= freshnessTtlMs;
      if (fresh) skippedFresh += 1;
      return !fresh;
    });
    filtered = stale;
  } else {
    // Skip already-fresh for all non-ON_DEMAND strategies.
    filtered = filtered.filter((c) => {
      if (!c.lastPublicRefreshAt) return true;
      const fresh = nowMs - c.lastPublicRefreshAt.getTime() <= freshnessTtlMs;
      if (fresh) skippedFresh += 1;
      return !fresh;
    });
  }

  if (config.strategy === "TRACKED_PERCENTILE") {
    const pct = config.trackedPercentile ?? 75;
    filtered.sort((a, b) => (b.mythicRating ?? 0) - (a.mythicRating ?? 0));
    const cutoff = Math.ceil(filtered.length * (pct / 100));
    filtered = filtered.slice(0, cutoff);
  } else {
    filtered.sort((a, b) => b.priority - a.priority || (b.mythicRating ?? 0) - (a.mythicRating ?? 0));
  }

  return {
    strategy: config.strategy,
    candidates: filtered.slice(0, maxResults),
    skippedFresh,
    skippedNoBudget: 0,
  };
}
