/**
 * Versioned standalone Utility V1 scoring config.
 * Calibrated against 21 Wallidrixe Demonology runs (EU/archimonde).
 */
export const UTILITY_STANDALONE_V1_CONFIG = {
  version: "utility-standalone-v1",
  weights: {
    interrupts: 0.45,
    dispelsPurges: 0.25,
    crowdControl: 0.2,
    groupUtility: 0.1,
  },
  /**
   * Diminishing-returns curves per component (0–100 component score).
   * meaningfulAt: score after the first confirmed use.
   * incrementalPerUse: each additional confirmed use before cap.
   * capAtCount: confirmed actions beyond this count add no further credit.
   */
  diminishingReturns: {
    interrupts: {
      meaningfulAt: 50,
      incrementalPerUse: 3.5,
      capAtCount: 18,
      calibrationNote:
        "Wallidrixe med=14, max=21 successful interrupts/run — cap at 18 keeps high performers below 100",
    },
    dispelsPurges: {
      meaningfulAt: 55,
      incrementalPerUse: 6,
      capAtCount: 8,
      calibrationNote: "Wallidrixe med=3 friendly dispels/run, max=8",
    },
    crowdControl: {
      meaningfulAt: 60,
      incrementalPerUse: 10,
      capAtCount: 4,
      calibrationNote: "Wallidrixe med=0, max=4 confirmed CC applications/run",
    },
    groupUtility: {
      meaningfulAt: 70,
      incrementalPerUse: 15,
      capAtCount: 3,
      calibrationNote: "Wallidrixe max=2 gateway uses/run — low cap for cast-only utility",
    },
  },
  requiredDatasets: {
    interrupts: ["Interrupts"] as const,
    dispelsPurges: ["Dispels"] as const,
    crowdControl: ["Casts", "Buffs", "Debuffs"] as const,
    groupUtility: ["Casts"] as const,
  },
  scoreableGroupClassifications: ["CONFIRMED_USEFUL", "POSSIBLY_USEFUL"] as const,
  notes: [
    "Standalone Utility V1 — confirmed contribution only; no missed-opportunity scoring.",
    "Does not compare the player with other players.",
    "ZERO_CONFIRMED_CONTRIBUTION keeps weight but scores 0 — distinct from NOT_APPLICABLE.",
    "NOT_APPLICABLE categories have weights redistributed to remaining applicable components.",
    "Cross-stream CC on WCL Interrupts stream (Banish/Shadowfury) is never scored as interrupts.",
  ],
} as const;

export type UtilityStandaloneV1Config = typeof UTILITY_STANDALONE_V1_CONFIG;
export type UtilityV1ComponentKey = keyof typeof UTILITY_STANDALONE_V1_CONFIG.weights;
export type UtilityV1DiminishingCurve =
  (typeof UTILITY_STANDALONE_V1_CONFIG.diminishingReturns)[UtilityV1ComponentKey];
