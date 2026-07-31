/**
 * Representative persisted ScoreModel.config matching packages/database/src/seed.ts
 * defaultModelConfigV6. Row-level key/version are not part of this JSON blob.
 */
export const PERSISTED_V6_SCORE_MODEL_CONFIG = {
  weights: {
    performance: 0.35,
    survival: 0.3,
    utility: 0.25,
    experienceConsistency: 0.1,
    mythicRaid: 0,
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
      { metricKey: "performance.current_season_peak", weight: 0.5525 },
      { metricKey: "performance.current_season_consistency", weight: 0.2975 },
      { metricKey: "performance.historical_best_average", weight: 0.15 },
    ],
    SURVIVAL: [
      { metricKey: "survival.outcome", weight: 0.55 },
      { metricKey: "survival.defensive_response", weight: 0.3 },
      { metricKey: "survival.emergency_recovery", weight: 0.15 },
    ],
    UTILITY: [{ metricKey: "utility.observed_contribution", weight: 1 }],
    EXPERIENCE: [
      { metricKey: "experience.dungeon_breadth", weight: 0.3 },
      { metricKey: "experience.key_band_breadth", weight: 0.22 },
      { metricKey: "experience.participation_depth", weight: 0.2 },
      { metricKey: "experience.historical_seasons", weight: 0.18 },
      { metricKey: "experience.activity_recency", weight: 0.1 },
    ],
    RAID: [
      { metricKey: "raid.mythic_progression", weight: 0.6 },
      { metricKey: "raid.mythic_parses", weight: 0.4 },
    ],
  },
  eligibility: {
    minKnownRuns: 20,
    baselineKeyLevel: 10,
    topPopulationPercent: 25,
  },
  utilityPublicationEligibility: {
    minAnalyzedRuns: 3,
    minConfidence: 0.45,
    minEvidenceCoverage: 0.5,
    minObservedDomains: 2,
  },
  overallFormula: "WEIGHTED_DIMENSIONS",
} as const;

export type PersistedV6ScoreModelConfig = typeof PERSISTED_V6_SCORE_MODEL_CONFIG;
