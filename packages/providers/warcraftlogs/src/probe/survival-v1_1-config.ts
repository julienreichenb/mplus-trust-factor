/**
 * Versioned standalone Survival V1.1 scoring config.
 * All thresholds and weights live here — do not scatter magic numbers.
 */
export const SURVIVAL_STANDALONE_V1_1_CONFIG = {
  version: "survival-standalone-v1.1",
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
    mergeGapMs: 8_000,
  },
  defensiveResponse: {
    castLookbackMs: 5_000,
    castLookaheadMs: 3_000,
    applicableCategories: ["DEFENSIVE_MAJOR", "DEFENSIVE_MINOR", "IMMUNITY"] as const,
  },
  emergencyRecovery: {
    lowHpRatio: 0.35,
    selfHealMinRatio: 0.1,
    actionLookaheadMs: 8_000,
    healthstoneCanonicalKey: "shared.consumable.healthstone",
    healingPotionCanonicalKey: "shared.consumable.healing-potion",
    healthstoneConfirmedClassSlugs: ["warlock"] as const,
  },
  /** Minimum ms between first qualifying danger trigger and death/action deadline. */
  reaction: {
    minReactionIntervalMs: 1_500,
  },
  /** Behavioral score completeness gates (share of runs with valid max HP + complete timeline). */
  scoreMode: {
    fullBehavioralMinRunShare: 0.8,
    partialBehavioralMinRunShare: 0.4,
  },
  /**
   * Field-name candidates inspected in raw payloads (discovery documents observed variants).
   * Resolution never invents values — only uses explicitly observed numeric fields.
   */
  healthFieldCandidates: [
    "hitPoints",
    "maxHitPoints",
    "health",
    "maxHealth",
    "resources",
    "resourceType",
    "current",
    "max",
    "amount",
    "absorb",
    "absorbed",
    "sourceResources",
    "targetResources",
  ] as const,
  notes: [
    "Standalone Survival V1.1 — explicit health-state resolution + reaction-window validation.",
    "Never derive max HP from stamina, item level, damage totals, or external databases.",
    "Death alone is not proof the player had time to react.",
    "Healing potions are never assumed available from absence of use.",
  ],
} as const;

export type SurvivalStandaloneV1_1Config = typeof SURVIVAL_STANDALONE_V1_1_CONFIG;
