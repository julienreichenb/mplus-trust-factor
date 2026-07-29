/**
 * Offline Utility V2 strategic-utility audit rubric.
 * Absolute design constants — NOT calibrated from any single player's distribution.
 */
export const UTILITY_V2_AUDIT_CONFIG = {
  version: "utility-standalone-v2-audit",
  rejectedBaselineVersion: "utility-standalone-v1",
  neutralBaseline: 50,
  /** Equal weight per applicable strategic domain; redistributed when N/A. */
  domainWeights: {
    castStops: 0.25,
    casterControl: 0.15,
    strategicCc: 0.2,
    mechanicAvoidance: 0.1,
    groupMobility: 0.1,
    support: 0.2,
  },
  evidenceTiers: ["CONFIRMED_IMPACT", "CONFIRMED_APPLICATION", "RAW_CAST"] as const,
  tierOrderingNote:
    "CONFIRMED_IMPACT > CONFIRMED_APPLICATION > RAW_CAST — higher tier wins when multiple match.",
  /**
   * Absolute points added to the neutral baseline per evidence item, before duration normalization.
   * Duration normalization: effectiveRate = count / (durationMs / 3_600_000).
   * Domain delta = min(maxDeltaAboveBaseline, effectiveRate * tierPoints).
   */
  absoluteRubric: {
    castStops: {
      tierPoints: {
        CONFIRMED_IMPACT: 1.4,
        CONFIRMED_APPLICATION: 0.45,
        RAW_CAST: 0,
      },
      maxDeltaAboveBaseline: 18,
      prolongedCcRoutingMs: 8_000,
      notes: [
        "Regular interrupts with interruptedSpellId are CONFIRMED_IMPACT.",
        "Cross-stream CC (Banish/Shadowfury/Fear/Mortal Coil) on Interrupts stream stops are CONFIRMED_IMPACT when hostile cast window ends incomplete within correlation window.",
      ],
    },
    casterControl: {
      spellIds: [1714, 1271802],
      tierPoints: {
        CONFIRMED_IMPACT: 1.8,
        CONFIRMED_APPLICATION: 0.9,
        RAW_CAST: 0.25,
      },
      maxDeltaAboveBaseline: 12,
      minCoverageDurationMs: 2_000,
      notes: [
        "Target must be hostile with observed spell casts during application window for CONFIRMED_IMPACT.",
      ],
    },
    strategicCc: {
      tierPoints: {
        CONFIRMED_IMPACT: 1.6,
        CONFIRMED_APPLICATION: 0.75,
        RAW_CAST: 0.2,
      },
      maxDeltaAboveBaseline: 16,
      prolongedControlMs: 8_000,
      routingControlMs: 12_000,
      notes: [
        "Non-boss hostile targets; dangerous-cast proof NOT required.",
        "Prolonged control may indicate routing/skips.",
      ],
    },
    mechanicAvoidance: {
      spellIds: [58984],
      tierPoints: {
        CONFIRMED_IMPACT: 2.5,
        CONFIRMED_APPLICATION: 0.8,
        RAW_CAST: 0.35,
      },
      maxDeltaAboveBaseline: 10,
      correlationWindowMs: 2_500,
      notes: [
        "Shadowmeld activation without impact correlation receives partial (CONFIRMED_APPLICATION/RAW_CAST), not zero.",
      ],
    },
    groupMobility: {
      gatewayCastSpellId: 111771,
      gatewayAuraSpellId: 113942,
      traversalWindowMs: 30_000,
      minTraversalDurationMs: 500,
      maxTraversalDurationMs: 15_000,
      tierPoints: {
        CONFIRMED_IMPACT: 2.2,
        CONFIRMED_APPLICATION: 0.9,
        RAW_CAST: 0.35,
      },
      maxDeltaAboveBaseline: 10,
      notes: [
        "Aura 113942 apply/remove on party members indicates traversal when paired with gateway cast.",
        "Cast-only gateway evidence is partial credit (RAW_CAST), not zero.",
      ],
    },
    support: {
      tierPoints: {
        CONFIRMED_IMPACT: 1.5,
        CONFIRMED_APPLICATION: 0.5,
        RAW_CAST: 0,
      },
      maxDeltaAboveBaseline: 14,
      categories: ["DISPEL", "PURGE", "EXTERNAL_DEFENSIVE", "BATTLE_REZ"] as const,
      notes: ["WCL dispel/purge rows with removed spell are CONFIRMED_IMPACT."],
    },
  },
  missedOpportunityPenalty: {
    enabledByDefault: false,
    maxPenaltyBelowBaseline: 8,
    perMissedAvailableInterrupt: 0.35,
    note: "Sensitivity-only — baseline simulation does not penalize without explicit scenario.",
  },
  sensitivityScenarios: [
    {
      id: "baseline",
      label: "Neutral baseline, no missed-opportunity penalty",
      weightMultiplier: 1,
      tierMultiplier: 1,
      applyMissedOpportunityPenalty: false,
    },
    {
      id: "conservative-tiers",
      label: "50% tier point multiplier — stresses evidence quality",
      weightMultiplier: 1,
      tierMultiplier: 0.5,
      applyMissedOpportunityPenalty: false,
    },
    {
      id: "generous-tiers",
      label: "125% tier point multiplier — upper-bound sensitivity",
      weightMultiplier: 1,
      tierMultiplier: 1.25,
      applyMissedOpportunityPenalty: false,
    },
    {
      id: "cast-stop-emphasis",
      label: "Cast stops + support weighted 2×, others unchanged proportionally",
      weightOverrides: { castStops: 0.5, support: 0.4 },
      tierMultiplier: 1,
      applyMissedOpportunityPenalty: false,
    },
    {
      id: "with-missed-interrupt-penalty",
      label: "Baseline tiers + confirmed missed interrupt opportunities penalized",
      weightMultiplier: 1,
      tierMultiplier: 1,
      applyMissedOpportunityPenalty: true,
    },
  ],
  crossStreamCcSpellIds: [710, 30283, 5782, 6789] as const,
  correlationWindowsMs: {
    castStop: 500,
    mechanicAvoidance: 2_500,
    gatewayTraversal: 30_000,
  },
  notes: [
    "Offline audit only — Utility V1 scoring model rejected for production.",
    "Confidence and observability are reported separately from simulated score.",
    "Per-run scores normalize evidence rates by duration; global score uses equal dungeon weighting.",
    "No caps or thresholds derived from Wallidrixe medians/maxima.",
  ],
} as const;

export type UtilityV2AuditConfig = typeof UTILITY_V2_AUDIT_CONFIG;
export type UtilityV2DomainKey = keyof typeof UTILITY_V2_AUDIT_CONFIG.domainWeights;
export type UtilityV2EvidenceTier = (typeof UTILITY_V2_AUDIT_CONFIG.evidenceTiers)[number];
