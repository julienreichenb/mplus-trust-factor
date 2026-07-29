/**
 * Utility V3.1 offline calibration experiment.
 * Parallel to V3 — does not modify V3 curves, weights, or production paths.
 *
 * Key differences from V3:
 * - Neutral-baseline aggregation (N/A/NOT_OBSERVABLE keep weight, contribute 0 deviation)
 * - Per-domain reliability shrinkage toward 50
 * - CastStops: opportunity-aware; without opportunities, cautiously positive (no 95+ saturation)
 * - Support: generic credit classes (reactive / strategic / routine / unverified) — no class branches
 * - Explicit multi-component confidence
 */
export const UTILITY_V3_1_SIMULATION_CONFIG = {
  version: "utility-standalone-v3_1-calibration",
  parentVersion: "utility-standalone-v3-simulation",
  experimental: true,
  productionIntegrated: false,

  /** Same original domain weights as V3 — do not change global Utility dimension weight. */
  domainWeights: {
    castStops: 0.25,
    casterControl: 0.15,
    strategicCc: 0.2,
    mechanicAvoidance: 0.1,
    groupMobility: 0.1,
    support: 0.2,
  },

  evidenceTiers: ["CONFIRMED_IMPACT", "CONFIRMED_APPLICATION", "RAW_CAST"] as const,

  /** Base tier weights (before support credit-class multipliers). */
  tierWeights: {
    CONFIRMED_IMPACT: 1,
    CONFIRMED_APPLICATION: 0.4,
    RAW_CAST: 0.06,
  },

  /**
   * Support evidence credit multipliers by generic class (not class/spec identity).
   * Applied on top of tier weights when summing effective events.
   */
  supportCreditClass: {
    /** Dispel/purge with removed-spell proof. */
    reactive: 1.0,
    /** Battle rez / confirmed-useful group external. */
    strategic: 1.0,
    /** Discretionary timed group support with IMPACT. */
    discretionary: 0.85,
    /** Routine rotational / uptime-like APPLICATION without outcome proof. */
    routine: 0.08,
    /** Cast-only EXTERNAL with value_not_inferable — near-excluded. */
    unverified: 0.02,
    /** Self-targeted or personal-mobility-like EXTERNAL APPLICATION. */
    personalExcluded: 0,
  },

  /**
   * CastStops without opportunity denominator: cautiously positive curve.
   * Caps well below 95 — volume alone cannot saturate.
   */
  castStopsVolumeCurve: {
    points: [
      { effectivePerHour: 0, score: 50 },
      { effectivePerHour: 2, score: 56 },
      { effectivePerHour: 5, score: 62 },
      { effectivePerHour: 10, score: 68 },
      { effectivePerHour: 16, score: 72 },
      { effectivePerHour: 24, score: 75 },
      { effectivePerHour: 36, score: 77 },
    ],
    /** Hard ceiling when no confirmed opportunities observed. */
    maxScoreWithoutOpportunities: 78,
    notes: [
      "Without opportunity denominator, volume yields cautiously positive scores only.",
      "Scores above 95 require opportunity-response evidence + multi-dungeon reliability.",
    ],
  },

  /**
   * CastStops with opportunity denominator: response-rate curve.
   * Above 95 only near-perfect response.
   */
  castStopsOpportunityCurve: {
    points: [
      { responseRate: 0, score: 35 },
      { responseRate: 0.25, score: 45 },
      { responseRate: 0.45, score: 55 },
      { responseRate: 0.6, score: 65 },
      { responseRate: 0.75, score: 75 },
      { responseRate: 0.85, score: 85 },
      { responseRate: 0.92, score: 92 },
      { responseRate: 0.97, score: 96 },
      { responseRate: 1.0, score: 100 },
    ],
    minOpportunitiesForHighBand: 8,
    minDungeonsFor95: 5,
  },

  /**
   * Support volume curve after credit-class reweighting.
   * Steeper early, slower to elite — routine spam cannot alone reach 95+.
   */
  supportCurve: {
    points: [
      { effectivePerHour: 0, score: 50 },
      { effectivePerHour: 0.5, score: 56 },
      { effectivePerHour: 1.5, score: 62 },
      { effectivePerHour: 3, score: 68 },
      { effectivePerHour: 5, score: 74 },
      { effectivePerHour: 8, score: 80 },
      { effectivePerHour: 12, score: 86 },
      { effectivePerHour: 18, score: 90 },
      { effectivePerHour: 28, score: 94 },
    ],
    /** Fraction of effective events that must be reactive/strategic for score > 90. */
    minStrategicShareFor90: 0.55,
    maxScoreWhenMostlyRoutine: 68,
  },

  noConfirmedContributionScore: 50,

  /**
   * Per-domain reliability shrinkage toward neutral 50.
   * reliability ∈ [minReliability, 1]; shrunk = 50 + r × (raw − 50).
   */
  reliability: {
    minReliability: 0.15,
    dungeonSaturation: 8,
    runSaturation: 8,
    diversitySaturation: 12,
    targetSaturation: 10,
    opportunitySaturation: 20,
    weights: {
      dungeonCoverage: 0.28,
      runCount: 0.18,
      evidenceDiversity: 0.18,
      targetDiversity: 0.1,
      opportunityObservability: 0.16,
      datasetCompleteness: 0.1,
    },
  },

  confidence: {
    weights: {
      dungeonCoverage: 0.28,
      runCount: 0.14,
      evidenceCompleteness: 0.14,
      opportunityObservability: 0.14,
      actorResolution: 0.1,
      datasetIntegrity: 0.1,
      domainCoverage: 0.1,
    },
    maxConfidenceWhenPartial: 72,
    maxConfidenceWhenTinySample: 62,
    tinySampleDungeonThreshold: 3,
  },

  missedOpportunity: {
    perMissedAvailableInterrupt: 2.5,
    maxPenaltyPoints: 15,
    floorScore: 35,
  },

  semanticBands: [
    { min: 0, max: 39, label: "confirmed_poor_or_confirmed_misses" },
    { min: 40, max: 59, label: "limited_confirmed_contribution" },
    { min: 60, max: 74, label: "regular_useful_contribution" },
    { min: 75, max: 89, label: "strong_consistent_strategic_contribution" },
    { min: 90, max: 100, label: "exceptional_broad_confirmed_impact" },
  ],

  aggregationMode: "neutral_baseline" as const,

  notes: [
    "V3.1 is an offline calibration experiment — not production-integrated.",
    "finalScore = 50 + Σ(originalWeight × reliability × (domainScore − 50)).",
    "N/A and NOT_OBSERVABLE contribute zero deviation (neutral), without amplifying other domains.",
    "Low sample size shrinks toward 50 — never invents a below-50 penalty.",
    "Below 50 requires confirmed missed opportunities or harmful misuse.",
  ],
} as const;

export type UtilityV3_1SimulationConfig = typeof UTILITY_V3_1_SIMULATION_CONFIG;
export type UtilityV3_1DomainKey = keyof typeof UTILITY_V3_1_SIMULATION_CONFIG.domainWeights;

export type UtilityV3_1AblationMode =
  | "A_v3_baseline"
  | "B_no_redistribution"
  | "C_reliability_shrinkage_only"
  | "D_caststop_recalibration_only"
  | "E_support_recalibration_only"
  | "F_combined_v3_1";

export type SupportCreditClass =
  | "reactive"
  | "strategic"
  | "discretionary"
  | "routine"
  | "unverified"
  | "personalExcluded";
