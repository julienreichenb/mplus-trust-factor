/**
 * OBSERVED_CONTRIBUTION production-candidate config.
 *
 * One-sided observed-positive-contribution score (not full utility efficiency):
 * - observed useful actions may raise score above 50
 * - absence must not push below 50
 * - zero attributable evidence ⇒ 50 + low confidence
 * - does not measure missed opportunities
 *
 * Scoring curves are rate→score maps for observed events only —
 * they do not reintroduce interrupt-miss penalties.
 */
export const UTILITY_V3_2_OBSERVED_CONFIG = {
  version: "utility-observed-contribution-v1.1",
  mode: "OBSERVED_CONTRIBUTION" as const,
  productionCandidate: true,
  productionIntegrated: false,
  parentResearchMode: "OPPORTUNITY_RESEARCH" as const,
  scoreSemanticsVersion: "utility-observed-semantics-v1",

  /**
   * Domain weights among applicable toolkit domains only.
   * Support weight lowered vs v1 after panel showed support dominating when
   * weight renormalization amplified a single high-rate support domain.
   * Contributions are share×(raw−50) then capped (cap applies after share).
   */
  domainWeights: {
    castStops: 0.45,
    support: 0.28,
    strategicCc: 0.27,
  },

  /** Absolute cap on |share×(raw−50)| per domain after weight share. */
  domainContributionCap: 8,

  /** Neutral floor — absence never scores below this. */
  zeroContributionScore: 50,

  /** Minimum aggregate raw / reliability-adjusted score. */
  scoreFloor: 50,

  castStops: {
    /** Player interrupt successes per active-combat hour → raw domain score. */
    perCombatHourCurve: [
      { perHour: 0, score: 50 },
      { perHour: 2, score: 54 },
      { perHour: 5, score: 62 },
      { perHour: 10, score: 70 },
      { perHour: 18, score: 78 },
      { perHour: 28, score: 84 },
      { perHour: 40, score: 88 },
    ],
    /** Hostile begincasts/hour below this soft-reduces interrupt score toward 50. */
    minHostileCastsPerHourForFullCredit: 40,
  },

  support: {
    /**
     * Milder curve + soft diminishing via sqrt credit (applied in scorer) —
     * justified by panel where uncapped support share dominated other domains.
     */
    perCombatHourCurve: [
      { perHour: 0, score: 50 },
      { perHour: 1.5, score: 54 },
      { perHour: 4, score: 60 },
      { perHour: 8, score: 66 },
      { perHour: 14, score: 72 },
      { perHour: 22, score: 78 },
      { perHour: 32, score: 82 },
    ],
    /** Effective credit = rawCredit^diminishingExponent (1 = linear). */
    diminishingExponent: 0.75,
  },

  strategicCc: {
    perCombatHourCurve: [
      { perHour: 0, score: 50 },
      { perHour: 0.5, score: 54 },
      { perHour: 1.5, score: 62 },
      { perHour: 3, score: 70 },
      { perHour: 6, score: 78 },
      { perHour: 10, score: 84 },
      { perHour: 16, score: 88 },
    ],
  },

  /** Credit multipliers for audited support semantics (player-only). */
  supportSemanticCredit: {
    REACTIVE_SUPPORT: 1,
    STRATEGIC_SUPPORT: 0.9,
    EMERGENCY_SUPPORT: 1,
    ROUTINE_ROTATIONAL_SUPPORT: 0.05,
    PASSIVE_SUPPORT: 0,
    PERSONAL_MOBILITY: 0,
    UNVERIFIED_EXTERNAL: 0,
  } as Record<string, number>,

  /** Each player dispel/purge success adds this much support credit (pre-diminishing). */
  dispelPurgeEventCredit: 1,

  reliability: {
    minReliability: 0.2,
  },

  confidence: {
    expectedDungeons: 8,
    runSaturation: 8,
    combatHourSaturation: 4,
    attributableEventSaturation: 40,
    tinyRunThreshold: 3,
    maxWhenTinySample: 58,
    maxWhenPartialDungeons: 72,
    maxWhenZeroAttributable: 35,
    /** Sparse mechanic catalog must not inflate production confidence. */
    maxWhenMechanicCatalogBelow: [
      { below: 0.25, maxConfidence: 70 },
      { below: 0.5, maxConfidence: 78 },
      { below: 0.75, maxConfidence: 85 },
    ],
    weights: {
      dungeonCoverage: 0.2,
      runCoverage: 0.15,
      combatDuration: 0.2,
      attributableEvents: 0.25,
      mechanicCatalogCoverageObserved: 0.1,
      sourceCompleteness: 0.1,
    },
    /** Toolkit-N/A domains must not count as missing evidence in confidence. */
    ignoreToolkitInapplicableAsMissing: true,
  },

  notes: [
    "One-sided observed-positive-contribution: floor 50; no miss penalties.",
    "No SUCCESS_OTHER_PLAYER credit.",
    "Domains without toolkit stay neutral (null → excluded from weight share).",
    "Per-domain contribution capped AFTER weight share to prevent single-domain dominance.",
    "Confidence ignores NOT_OBSERVABLE volume and toolkit-inapplicable domains.",
    "Denominator prefers hostile-activity active-combat windows over whole-fight duration.",
  ],
} as const;

export type UtilityV3_2ObservedConfig = typeof UTILITY_V3_2_OBSERVED_CONFIG;
export type ObservedDomainKey = keyof typeof UTILITY_V3_2_OBSERVED_CONFIG.domainWeights;
