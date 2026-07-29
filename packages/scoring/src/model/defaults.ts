import type { ScoreModelConfigV1 } from "../types.js";
import { resolvePerformanceMetricWeights } from "../performance/aggregate.js";

export function createDefaultModelV1(
  overrides: Partial<ScoreModelConfigV1> = {},
): ScoreModelConfigV1 {
  const base: ScoreModelConfigV1 = {
    key: "default",
    version: 1,
    weights: {
      performance: 0.32,
      survival: 0.27,
      utility: 0.23,
      experienceConsistency: 0.13,
      mythicRaid: 0.05,
    },
    authenticityBlend: {
      skillWeight: 0.6,
      authenticityWeight: 0.4,
    },
    confidenceNeutralScore: 50,
    gradeThresholds: {
      S: 90,
      A: 80,
      B: 65,
      C: 50,
    },
    minConfidenceForGrade: 0.35,
    metricWeights: {
      PERFORMANCE: [
        { metricKey: "performance.mythic_rating", weight: 0.55 },
        { metricKey: "performance.consistency", weight: 0.25 },
        { metricKey: "performance.contextual_contribution", weight: 0.2 },
      ],
      SURVIVAL: [
        { metricKey: "survival.death_rate", weight: 0.35 },
        { metricKey: "survival.avoidable_damage", weight: 0.3 },
        { metricKey: "survival.defensive_usage", weight: 0.25 },
        { metricKey: "survival.consumable_usage", weight: 0.1 },
      ],
      UTILITY: [
        { metricKey: "utility.interrupts", weight: 0.3 },
        { metricKey: "utility.crowd_control", weight: 0.25 },
        { metricKey: "utility.dispels", weight: 0.15 },
        { metricKey: "utility.externals", weight: 0.15 },
        { metricKey: "utility.class_specific", weight: 0.15 },
      ],
      EXPERIENCE: [
        { metricKey: "experience.dungeon_breadth", weight: 0.35 },
        { metricKey: "experience.top_level_repeat", weight: 0.25 },
        { metricKey: "experience.volume_recency", weight: 0.15 },
        { metricKey: "experience.historical_seasons", weight: 0.15 },
        { metricKey: "experience.role_continuity", weight: 0.1 },
      ],
      RAID: [
        { metricKey: "raid.mythic_progression", weight: 0.6 },
        { metricKey: "raid.mythic_parses", weight: 0.4 },
      ],
    },
    normalization: {
      "survival.death_rate": { type: "identity", invert: true },
      "survival.avoidable_damage": { type: "identity", invert: true },
      default: { type: "identity" },
    },
    historicalDecay: {
      currentSeason: 0.7,
      previousSeason: 0.2,
      olderSeasons: 0.1,
    },
    minCoverageForExtreme: 0.35,
    extremeCapLow: 25,
    extremeCapHigh: 75,
    sampleSizeHalfLife: 10,
    confidenceBlend: {
      dimensionConfidence: 0.45,
      sourceCoverage: 0.25,
      freshness: 0.15,
      selectedRunCoverage: 0.15,
    },
    authenticityFeatures: {
      progressionKeyJump: 18,
      compressedBestRunWindow: 12,
      lowVolumeForScore: 14,
      repeatedStrongerTeammates: 16,
      topRunRosterConcentration: 12,
      weakTargetPerformance: 20,
      highDeathsLowContribution: 14,
      ratingPerformanceDivergence: 12,
      lackIntermediateProgression: 10,
    },
    authenticityMitigations: {
      confirmedEliteMain: 22,
      probableReroll: 12,
      strongPriorSeasonSameRole: 14,
      strongPersonalTopRunPerformance: 18,
      independentGroupDiversity: 12,
    },
    authenticityTags: {
      boostSuspectedBelow: 40,
      atypicalBelow: 60,
      minEvidenceStrength: 18,
    },
    roleMetricExclusions: {
      TANK: ["performance.raw_hps", "utility.raw_hps"],
      HEALER: [],
      DPS: [],
    },
  };

  return deepMerge(base, overrides);
}

/**
 * Default Trust Factor v2 — PERFORMANCE from current-season WCL parse percentiles
 * (peak + consistency) with optional historical best-average. Mythic+ rating is
 * an EXPERIENCE/progression signal only, never a PERFORMANCE percentile.
 */
export function createDefaultModelV2(
  overrides: Partial<ScoreModelConfigV1> = {},
): ScoreModelConfigV1 {
  const performanceWeights = resolvePerformanceMetricWeights(true);
  return createDefaultModelV1({
    version: 2,
    metricWeights: {
      PERFORMANCE: performanceWeights,
      SURVIVAL: [
        { metricKey: "survival.death_rate", weight: 0.35 },
        { metricKey: "survival.avoidable_damage", weight: 0.3 },
        { metricKey: "survival.defensive_usage", weight: 0.25 },
        { metricKey: "survival.consumable_usage", weight: 0.1 },
      ],
      UTILITY: [
        { metricKey: "utility.interrupts", weight: 0.3 },
        { metricKey: "utility.crowd_control", weight: 0.25 },
        { metricKey: "utility.dispels", weight: 0.15 },
        { metricKey: "utility.externals", weight: 0.15 },
        { metricKey: "utility.class_specific", weight: 0.15 },
      ],
      EXPERIENCE: [
        { metricKey: "experience.dungeon_breadth", weight: 0.28 },
        { metricKey: "experience.top_level_repeat", weight: 0.22 },
        { metricKey: "experience.volume_recency", weight: 0.15 },
        { metricKey: "experience.mythic_rating", weight: 0.15 },
        { metricKey: "experience.historical_seasons", weight: 0.12 },
        { metricKey: "experience.role_continuity", weight: 0.08 },
      ],
      RAID: [
        { metricKey: "raid.mythic_progression", weight: 0.6 },
        { metricKey: "raid.mythic_parses", weight: 0.4 },
      ],
    },
    normalization: {
      "survival.death_rate": { type: "identity", invert: true },
      "survival.avoidable_damage": { type: "identity", invert: true },
      "performance.current_season_peak": { type: "percentile" },
      "performance.current_season_consistency": { type: "percentile" },
      "performance.historical_best_average": { type: "percentile" },
      default: { type: "identity" },
    },
    ...overrides,
  });
}

/**
 * Default Trust Factor v3 — Wave 4 weights (do not retune without calibration):
 * PERFORMANCE 35%, SURVIVAL 30%, UTILITY 25%, EXPERIENCE 10%, RAID 0%.
 */
export function createDefaultModelV3(
  overrides: Partial<ScoreModelConfigV1> = {},
): ScoreModelConfigV1 {
  return createDefaultModelV2({
    version: 3,
    weights: {
      performance: 0.35,
      survival: 0.3,
      utility: 0.25,
      experienceConsistency: 0.1,
      mythicRaid: 0,
    },
    ...overrides,
  });
}

/**
 * Default Trust Factor v4 — Survival V1.1.1 outcome and response metrics.
 */
export function createDefaultModelV4(
  overrides: Partial<ScoreModelConfigV1> = {},
): ScoreModelConfigV1 {
  const v3 = createDefaultModelV3();
  return createDefaultModelV3({
    version: 4,
    metricWeights: {
      ...v3.metricWeights,
      SURVIVAL: [
        { metricKey: "survival.outcome", weight: 0.55 },
        { metricKey: "survival.defensive_response", weight: 0.3 },
        { metricKey: "survival.emergency_recovery", weight: 0.15 },
      ],
    },
    normalization: {
      "survival.outcome": { type: "identity" },
      "survival.defensive_response": { type: "identity" },
      "survival.emergency_recovery": { type: "identity" },
      "survival.death_rate": { type: "identity" },
    },
    ...overrides,
  });
}

/**
 * Default Trust Factor v5 — Experience V2 (exposure, not skill).
 * Trust weights unchanged: PERFORMANCE 35 / SURVIVAL 30 / UTILITY 25 / EXPERIENCE 10 / RAID 0.
 * Removes mythic_rating, top_level_repeat, volume_recency, role_continuity from Experience.
 */
export function createDefaultModelV5(
  overrides: Partial<ScoreModelConfigV1> = {},
): ScoreModelConfigV1 {
  const v4 = createDefaultModelV4();
  return createDefaultModelV4({
    version: 5,
    metricWeights: {
      ...v4.metricWeights,
      EXPERIENCE: [
        { metricKey: "experience.dungeon_breadth", weight: 0.3 },
        { metricKey: "experience.key_band_breadth", weight: 0.22 },
        { metricKey: "experience.participation_depth", weight: 0.2 },
        { metricKey: "experience.historical_seasons", weight: 0.18 },
        { metricKey: "experience.activity_recency", weight: 0.1 },
      ],
    },
    ...overrides,
  });
}

function deepMerge<T extends object>(base: T, overrides: Partial<T>): T {
  const out = { ...base };
  for (const key of Object.keys(overrides) as Array<keyof T>) {
    const value = overrides[key];
    if (value === undefined) continue;
    const current = out[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      out[key] = deepMerge(current as object, value as object) as T[keyof T];
    } else {
      out[key] = value as T[keyof T];
    }
  }
  return out;
}

export function createSurvivalFocusedModel(): ScoreModelConfigV1 {
  return createDefaultModelV1({
    key: "survival-focused",
    version: 1,
    weights: {
      performance: 0.22,
      survival: 0.4,
      utility: 0.2,
      experienceConsistency: 0.13,
      mythicRaid: 0.05,
    },
  });
}

export function createUtilityFocusedModel(): ScoreModelConfigV1 {
  return createDefaultModelV1({
    key: "utility-focused",
    version: 1,
    weights: {
      performance: 0.22,
      survival: 0.2,
      utility: 0.4,
      experienceConsistency: 0.13,
      mythicRaid: 0.05,
    },
  });
}
