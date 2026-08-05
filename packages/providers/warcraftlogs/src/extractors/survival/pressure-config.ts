/**
 * Versioned Survival one-fight pressure / response configuration.
 * Transparent initial model for inspection and calibration — not final score weights.
 */
export const SURVIVAL_ONE_FIGHT_PRESSURE_CONFIG = {
  version: "survival-one-fight-pressure-config-v1",
  /** Rolling aggregation window for sustained-pressure detection. */
  rollingWindowMs: 5_000,
  /**
   * When max HP is known: rolling damage sum ≥ maxHp * ratio → sustained.
   * Exposed for calibration; not a score weight.
   */
  rollingDamageRatioOfMaxHp: 0.35,
  /**
   * When max HP is known: single hit ≥ maxHp * ratio contributes to pressure onset.
   */
  largeHitRatioOfMaxHp: 0.25,
  /**
   * Absolute fallbacks when max HP is unavailable (calibration knobs, not score weights).
   */
  absolute: {
    /** Rolling damage sum in window that marks sustained pressure. */
    sustainedRollingDamage: 500_000,
    /** Peak hit below this (with low hit density) stays isolated / non-window. */
    isolatedPeakHitMax: 200_000,
    /** Minimum hits inside rolling window to call sustained without max HP. */
    sustainedMinHits: 4,
    /** Total window damage below this with a single hit → not a pressure window. */
    isolatedTotalDamageMax: 250_000,
  },
  /** Merge adjacent qualifying segments closer than this gap. */
  mergeGapMs: 3_000,
  /** Extend pressure window end by this after last qualifying hit. */
  trailingQuietMs: 1_000,
  response: {
    beforeLookbackMs: 5_000,
    duringSlackMs: 500,
    afterRecoveryLookaheadMs: 8_000,
  },
  activation: {
    /** Cast + buff lifecycle merge window for one canonical use. */
    mergeWindowMs: 1_500,
  },
  notes: [
    "Initial transparent pressure model for Survival evidence inspection.",
    "Does not claim a universally correct pressure formula.",
    "Does not encode Survival score weights.",
    "Max-HP context is optional; absence is an explicit limitation.",
  ],
} as const;

export type SurvivalOneFightPressureConfig =
  typeof SURVIVAL_ONE_FIGHT_PRESSURE_CONFIG;
