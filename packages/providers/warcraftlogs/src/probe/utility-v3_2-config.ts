/**
 * Utility V3.2 offline evidence/opportunity calibration config.
 * Does not modify global Utility dimension weight. Not production-integrated.
 */
export const UTILITY_V3_2_SIMULATION_CONFIG = {
  version: "utility-standalone-v3_2-opportunity-calibration",
  parentVersions: [
    "utility-standalone-v3-simulation",
    "utility-standalone-v3_1-calibration",
  ],
  experimental: true,
  productionIntegrated: false,

  domainWeights: {
    castStops: 0.25,
    casterControl: 0.15,
    strategicCc: 0.2,
    mechanicAvoidance: 0.1,
    groupMobility: 0.1,
    support: 0.2,
  },

  /**
   * CastStops from opportunities (primary).
   * Severity-weighted response rate → score.
   */
  castStopsOpportunityCurve: {
    points: [
      { responseRate: 0, score: 32 },
      { responseRate: 0.2, score: 42 },
      { responseRate: 0.4, score: 52 },
      { responseRate: 0.55, score: 62 },
      { responseRate: 0.7, score: 72 },
      { responseRate: 0.82, score: 82 },
      { responseRate: 0.9, score: 90 },
      { responseRate: 0.96, score: 96 },
      { responseRate: 1.0, score: 100 },
    ],
    minHighConfidenceOpportunitiesFor90: 10,
    minDungeonsFor90: 5,
    minDistinctHostileSpellsFor90: 6,
    maxConfirmedMissShareFor90: 0.08,
  },

  /** Fallback when miss-observable opportunities absent. */
  castStopsVolumeFallback: {
    points: [
      { effectivePerHour: 0, score: 50 },
      { effectivePerHour: 3, score: 55 },
      { effectivePerHour: 8, score: 62 },
      { effectivePerHour: 14, score: 68 },
      { effectivePerHour: 22, score: 72 },
      { effectivePerHour: 32, score: 75 },
    ],
    maxScore: 76,
  },

  supportCredit: {
    REACTIVE_SUPPORT: 1.0,
    STRATEGIC_SUPPORT: 0.9,
    EMERGENCY_SUPPORT: 1.0,
    ROUTINE_ROTATIONAL_SUPPORT: 0.08,
    PASSIVE_SUPPORT: 0,
    PERSONAL_MOBILITY: 0,
    UNVERIFIED_EXTERNAL: 0.02,
  },

  supportCurve: {
    points: [
      { effectivePerHour: 0, score: 50 },
      { effectivePerHour: 0.5, score: 56 },
      { effectivePerHour: 2, score: 64 },
      { effectivePerHour: 4, score: 72 },
      { effectivePerHour: 8, score: 80 },
      { effectivePerHour: 14, score: 86 },
      { effectivePerHour: 22, score: 90 },
    ],
    maxScoreWhenMostlyRoutine: 65,
    minReactiveShareFor88: 0.6,
  },

  reliability: {
    minReliability: 0.2,
    dungeonSaturation: 8,
    runSaturation: 8,
  },

  confidence: {
    weights: {
      dungeonCoverage: 0.22,
      runCoverage: 0.12,
      eventCompleteness: 0.12,
      opportunityObservability: 0.2,
      actorResolution: 0.08,
      mechanicCatalogCoverage: 0.1,
      abilityCatalogCoverage: 0.08,
      datasetIntegrity: 0.08,
    },
    maxWhenPartial: 74,
    maxWhenTinySample: 60,
    tinyDungeonThreshold: 3,
  },

  noConfirmedContributionScore: 50,
  aggregationMode: "neutral_baseline" as const,

  notes: [
    "rawBehaviorEstimate uses observed behavior/opportunities only.",
    "reliabilityAdjustedScore shrinks toward 50 for publication.",
    "confidence is coverage/evidence quality — not mixed into raw behavior.",
    "Confirmed misses (HIGH/MEDIUM confidence) alone may pull scores below 50.",
    "Success-only implied interrupts do not create a miss denominator.",
  ],
} as const;

export type UtilityV3_2SimulationConfig = typeof UTILITY_V3_2_SIMULATION_CONFIG;
export type UtilityV3_2DomainKey = keyof typeof UTILITY_V3_2_SIMULATION_CONFIG.domainWeights;
