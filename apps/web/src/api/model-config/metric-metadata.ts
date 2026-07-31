import { humanizeMetricKey } from "../../lib/characterViewModel";

/**
 * Curated plain-language descriptions for canonical metric keys, mirrored from
 * the canonical server-side metric registry (`packages/database/src/seed.ts`
 * `metricDefinitions`). Keep this in sync when metric definitions change.
 * Unknown/dynamic keys fall back to a humanized label + dimension-generic
 * explanation so tooltips never render blank text.
 */
const METRIC_DESCRIPTIONS: Record<string, string> = {
  "performance.mythic_rating":
    "Legacy v1 Blizzard Mythic rating Performance contributor (retired in model v2; superseded by experience.mythic_rating).",
  "performance.current_season_peak":
    "Equal-weight mean of current-season Warcraft Logs best parse percentiles per dungeon.",
  "performance.current_season_consistency":
    "Equal-weight mean of current-season Warcraft Logs median parse percentiles per dungeon.",
  "performance.historical_best_average":
    "Recency-weighted mean of prior-season best parse percentile averages (same spec/role).",
  "performance.spec_percentile":
    "Specialization performance percentile when a real ranking source provides one.",
  "experience.mythic_rating":
    "Legacy Experience V1 Blizzard Mythic+ rating (retired from scoring in model v5; not a parse percentile).",
  "experience.dungeon_breadth":
    "Distinct active-season dungeons completed, divided by the expected pool size.",
  "experience.key_band_breadth": "Distinct meaningful key-level bands touched (Experience V2).",
  "experience.participation_depth": "Current-season participation with log diminishing returns (Experience V2).",
  "experience.historical_seasons": "Prior seasons with public character Mythic+ history (no alt inference).",
  "experience.activity_recency": "Gradual recency of last relevant Mythic+ activity (Experience V2).",
  "experience.run_volume": "Current-season run volume and breadth.",
  "survival.death_rate": "Death frequency in analyzed runs (lower is better).",
  "survival.outcome": "Survival V1.1.1 outcome score derived from deaths and run outcome.",
  "survival.defensive_response": "Survival V1.1.1 defensive response score during pressure windows.",
  "survival.emergency_recovery": "Survival V1.1.1 emergency recovery score during critical pressure.",
  "utility.interrupt_success": "Successful relevant interrupts.",
  "utility.observed_contribution":
    "Model v6 published Utility: reliability-adjusted OBSERVED_CONTRIBUTION score (0-100).",
  "raid.mythic_progression": "Mythic raid progression signal.",
  "authenticity.suspicion_index": "Composite suspicion index (probabilistic).",
};

const DIMENSION_FALLBACK: Record<string, string> = {
  PERFORMANCE: "A Performance-dimension signal derived from dungeon run parses.",
  SURVIVAL: "A Survival-dimension signal derived from deaths and defensive/recovery behavior.",
  UTILITY: "A Utility-dimension signal derived from role-specific combat contribution.",
  EXPERIENCE: "An Experience-dimension signal derived from breadth and recency of Mythic+ activity.",
  RAID: "A Mythic raid-dimension signal.",
};

export interface MetricMetadata {
  metricKey: string;
  label: string;
  whatItMeans: string;
  technical: string;
}

/**
 * Human label + explanation for a single metric weight row. Reuses canonical
 * copy where the key is registered; otherwise falls back to a humanized label
 * plus a dimension-generic explanation. Always includes the exact `metricKey`
 * in the technical section so admins can verify against the metric registry.
 */
export function getMetricMetadata(metricKey: string, dimension?: string): MetricMetadata {
  const known = METRIC_DESCRIPTIONS[metricKey];
  const whatItMeans =
    known ?? DIMENSION_FALLBACK[dimension ?? ""] ?? "A scoring input contributing to this dimension.";
  return {
    metricKey,
    label: humanizeMetricKey(metricKey),
    whatItMeans,
    technical: known
      ? `metricKey: "${metricKey}"`
      : `metricKey: "${metricKey}" (not in the canonical metric registry — verify before activating).`,
  };
}
