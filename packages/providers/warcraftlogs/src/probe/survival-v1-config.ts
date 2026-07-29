/**
 * Versioned standalone Survival V1 scoring config.
 * All thresholds and weights live here — do not scatter magic numbers.
 */
export const SURVIVAL_STANDALONE_V1_CONFIG = {
  version: "survival-standalone-v1",
  weights: {
    survivalOutcome: 0.55,
    defensiveResponse: 0.3,
    emergencyRecovery: 0.15,
  },
  /** Death count → component score (0–100). */
  outcomeByDeaths: {
    0: 100,
    1: 65,
    2: 30,
    /** 3+ deaths */
    threeOrMore: 0,
  },
  danger: {
    /** Current HP / maxHP at or below this opens a danger window. */
    lowHpRatio: 0.35,
    /** Rolling unabsorbed damage window length. */
    rollingWindowMs: 5_000,
    /** Rolling unabsorbed damage / maxHP threshold. */
    rollingDamageRatio: 0.4,
    /** Single unabsorbed hit / maxHP threshold. */
    largeHitRatio: 0.3,
    /** Merge triggers within this gap into one window. */
    mergeGapMs: 8_000,
  },
  defensiveResponse: {
    /** Cast acceptance window relative to first danger trigger. */
    castLookbackMs: 5_000,
    castLookaheadMs: 3_000,
    applicableCategories: ["DEFENSIVE_MAJOR", "DEFENSIVE_MINOR", "IMMUNITY"] as const,
  },
  emergencyRecovery: {
    /** HP ratio that creates a recovery opportunity (same as low-HP danger). */
    lowHpRatio: 0.35,
    /** Self-heal amount / maxHP to count as a valid recovery response. */
    selfHealMinRatio: 0.1,
    /**
     * Recovery actions count from danger window start through last trigger + this lookahead.
     * Point-trigger windows would otherwise have zero duration.
     */
    actionLookaheadMs: 8_000,
    healthstoneCanonicalKey: "shared.consumable.healthstone",
    healingPotionCanonicalKey: "shared.consumable.healing-potion",
    /** Warlocks can create Healthstones — treat as confirmed available for that class. */
    healthstoneConfirmedClassSlugs: ["warlock"] as const,
  },
  notes: [
    "Standalone Survival V1 — not a percentile; no cross-player comparison.",
    "Damage taken totals do not directly affect the score.",
    "Theoretical cooldown max uses are diagnostic only.",
    "If max HP cannot be resolved, HP-percentage danger detection is unavailable (never guessed).",
    "Healing potions are never assumed available.",
  ],
} as const;

export type SurvivalStandaloneV1Config = typeof SURVIVAL_STANDALONE_V1_CONFIG;
