/**
 * Final standalone Survival V1.1.1 scoring config (production-ready).
 * Pressure-cluster rules from the V1.1 hardening audit.
 */
export const SURVIVAL_STANDALONE_V1_1_1_CONFIG = {
  version: "survival-standalone-v1.1.1",
  adapterVersion: "survival-adapter-v1.1.1-parity",
  analysisVersion: "wcl-survival-v1.1.1-parity",
  weights: {
    survivalOutcome: 0.55,
    defensiveResponse: 0.3,
    emergencyRecovery: 0.15,
  },
  outcomeByDeaths: {
    0: 100,
    1: 65,
    2: 30,
    threeOrMore: 0,
  },
  danger: {
    lowHpRatio: 0.35,
    rollingWindowMs: 5_000,
    rollingDamageRatio: 0.4,
    largeHitRatio: 0.3,
    /** Initial overlapping-trigger merge. */
    mergeGapMs: 8_000,
  },
  pressureCluster: {
    /** Do not open a new scored cluster until HP stays above this ratio. */
    recoverAboveHpRatio: 0.5,
    /** Minimum stable recovery duration above recoverAboveHpRatio. */
    stableRecoveryMs: 5_000,
    /** Suppress separate clusters across gaps below this when pressure continues. */
    continuousPressureGapMs: 15_000,
  },
  defensiveResponse: {
    castLookbackMs: 5_000,
    castLookaheadMs: 3_000,
    applicableCategories: ["DEFENSIVE_MAJOR", "DEFENSIVE_MINOR", "IMMUNITY"] as const,
    /** One activation covers all triggers inside one pressure cluster. */
    oneCreditPerCluster: true,
  },
  emergencyRecovery: {
    lowHpRatio: 0.35,
    selfHealMinRatio: 0.1,
    actionLookaheadMs: 8_000,
    healthstoneCanonicalKey: "shared.consumable.healthstone",
    healingPotionCanonicalKey: "shared.consumable.healing-potion",
    healthstoneConfirmedClassSlugs: ["warlock"] as const,
  },
  reaction: {
    minReactionIntervalMs: 1_500,
  },
  maxHp: {
    /** Relative to baseline: temporary values outside this need corroboration + known effect. */
    plausibilityMinRatio: 0.5,
    plausibilityMaxRatio: 2.0,
    /** Adjacent corroboration window for temporary max HP. */
    temporaryCorroborationMs: 8_000,
    /** Minimum corroborating snapshots for temporary acceptance inside plausibility range. */
    minTemporaryCorroborations: 2,
    darkPactSpellId: 108416,
  },
  scoreMode: {
    fullBehavioralMinRunShare: 0.8,
    partialBehavioralMinRunShare: 0.4,
  },
  selection: {
    maxRunsPerDungeon: 3,
  },
  notes: [
    "Standalone Survival V1.1.1 — pressure clusters, hardened max-HP, production-ready.",
    "Not a percentile; no cross-player comparison; raw damage volume does not score.",
    "Never invent max HP; reject implausible million-scale outliers without corroboration.",
    "Healing potions are never assumed available from absence of use.",
  ],
} as const;

export type SurvivalStandaloneV1_1_1Config = typeof SURVIVAL_STANDALONE_V1_1_1_CONFIG;
