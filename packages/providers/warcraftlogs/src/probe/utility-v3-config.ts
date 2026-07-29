/**
 * Utility V3 offline scoring simulation — absolute domain curves (0–100).
 * NOT calibrated from any single player's distribution.
 * V2 additive baseline model rejected — see rejectedVersions.
 */
export const UTILITY_V3_SIMULATION_CONFIG = {
  version: "utility-standalone-v3-simulation",
  rejectedVersions: ["utility-standalone-v1", "utility-standalone-v2-audit"],
  domainWeights: {
    castStops: 0.25,
    casterControl: 0.15,
    strategicCc: 0.2,
    mechanicAvoidance: 0.1,
    groupMobility: 0.1,
    support: 0.2,
  },
  evidenceTiers: ["CONFIRMED_IMPACT", "CONFIRMED_APPLICATION", "RAW_CAST"] as const,
  tierWeights: {
    CONFIRMED_IMPACT: 1,
    CONFIRMED_APPLICATION: 0.4,
    RAW_CAST: 0.06,
  },
  semanticBands: [
    { min: 0, max: 39, label: "confirmed_poor_or_confirmed_misses" },
    { min: 40, max: 59, label: "limited_confirmed_contribution" },
    { min: 60, max: 74, label: "regular_useful_contribution" },
    { min: 75, max: 89, label: "strong_consistent_strategic_contribution" },
    { min: 90, max: 100, label: "exceptional_broad_confirmed_impact" },
  ],
  /** Neutral score for observable toolkit with no confirmed-tier evidence. */
  noConfirmedContributionScore: 50,
  /**
   * Maps tier-weighted effective events per hour to a 0–100 domain score.
   * Absolute anchors — derived from M+ dungeon pacing design, not player samples.
   */
  domainCurves: {
    castStops: {
      points: [
        { effectivePerHour: 0, score: 50 },
        { effectivePerHour: 1, score: 58 },
        { effectivePerHour: 2.5, score: 65 },
        { effectivePerHour: 5, score: 74 },
        { effectivePerHour: 8, score: 82 },
        { effectivePerHour: 12, score: 90 },
        { effectivePerHour: 18, score: 96 },
        { effectivePerHour: 24, score: 100 },
      ],
      notes: [
        "Primary driver: confirmed cast stops per hour (interrupts + cross-stream CC stops).",
        "Sustained 12+ effective/hour reaches exceptional band (90+).",
      ],
    },
    casterControl: {
      points: [
        { effectivePerHour: 0, score: 50 },
        { effectivePerHour: 0.5, score: 58 },
        { effectivePerHour: 1.5, score: 66 },
        { effectivePerHour: 3, score: 74 },
        { effectivePerHour: 5, score: 82 },
        { effectivePerHour: 8, score: 90 },
        { effectivePerHour: 12, score: 97 },
        { effectivePerHour: 16, score: 100 },
      ],
      notes: [
        "Curse/Blight of Tongues on hostile casters — application on known casters counts.",
      ],
    },
    strategicCc: {
      points: [
        { effectivePerHour: 0, score: 50 },
        { effectivePerHour: 0.3, score: 58 },
        { effectivePerHour: 0.8, score: 66 },
        { effectivePerHour: 1.5, score: 74 },
        { effectivePerHour: 2.5, score: 82 },
        { effectivePerHour: 4, score: 90 },
        { effectivePerHour: 6, score: 97 },
        { effectivePerHour: 8, score: 100 },
      ],
      notes: ["Non-boss CC — prolonged control boosts tier, not required for application credit."],
    },
    mechanicAvoidance: {
      points: [
        { effectivePerHour: 0, score: 50 },
        { effectivePerHour: 0.2, score: 58 },
        { effectivePerHour: 0.5, score: 66 },
        { effectivePerHour: 1, score: 74 },
        { effectivePerHour: 2, score: 82 },
        { effectivePerHour: 3.5, score: 90 },
        { effectivePerHour: 5, score: 97 },
        { effectivePerHour: 7, score: 100 },
      ],
      notes: ["Shadowmeld — application credit; correlated cancellation is CONFIRMED_IMPACT."],
    },
    groupMobility: {
      points: [
        { effectivePerHour: 0, score: 50 },
        { effectivePerHour: 0.3, score: 58 },
        { effectivePerHour: 0.8, score: 66 },
        { effectivePerHour: 1.5, score: 74 },
        { effectivePerHour: 2.5, score: 82 },
        { effectivePerHour: 4, score: 90 },
        { effectivePerHour: 6, score: 97 },
        { effectivePerHour: 8, score: 100 },
      ],
      notes: [
        "Gateway — unique party aura applications per cast count as confirmed group usage.",
      ],
    },
    support: {
      points: [
        { effectivePerHour: 0, score: 50 },
        { effectivePerHour: 0.5, score: 58 },
        { effectivePerHour: 1.5, score: 66 },
        { effectivePerHour: 3, score: 74 },
        { effectivePerHour: 5, score: 82 },
        { effectivePerHour: 8, score: 90 },
        { effectivePerHour: 12, score: 97 },
        { effectivePerHour: 16, score: 100 },
      ],
      notes: ["Dispels/purges/externals/battle rez with removed-spell or application proof."],
    },
  },
  requiredDatasets: {
    castStops: ["Interrupts", "Casts"] as const,
    casterControl: ["Casts", "Debuffs"] as const,
    strategicCc: ["Casts", "Buffs", "Debuffs"] as const,
    mechanicAvoidance: ["Casts", "Buffs"] as const,
    groupMobility: ["Casts", "Buffs", "Debuffs"] as const,
    support: ["Dispels"] as const,
  },
  observabilityWeights: {
    FULL: 1,
    PARTIAL: 0.72,
    LIMITED: 0.45,
  },
  confidenceWeights: {
    observability: 0.35,
    datasetCompleteness: 0.25,
    evidenceTierQuality: 0.25,
    runDungeonCoverage: 0.15,
  },
  missedOpportunity: {
    perMissedAvailableInterrupt: 2.5,
    maxPenaltyPoints: 15,
    floorScore: 35,
  },
  gatewayGroupUsage: {
    castSpellId: 111771,
    auraSpellId: 113942,
    pairingWindowMs: 30_000,
    minUniquePartyUsers: 1,
  },
  sensitivityScenarios: [
    {
      id: "baseline",
      label: "Documented curves, no missed-opportunity penalty",
      curveMultiplier: 1,
      applyMissedOpportunityPenalty: false,
    },
    {
      id: "conservative-curves",
      label: "85% effective-rate multiplier before curve lookup",
      curveMultiplier: 0.85,
      applyMissedOpportunityPenalty: false,
    },
    {
      id: "generous-curves",
      label: "115% effective-rate multiplier before curve lookup",
      curveMultiplier: 1.15,
      applyMissedOpportunityPenalty: false,
    },
    {
      id: "cast-stop-emphasis",
      label: "Cast stops + support weight doubled (renormalized)",
      weightOverrides: { castStops: 0.5, support: 0.4 },
      curveMultiplier: 1,
      applyMissedOpportunityPenalty: false,
    },
    {
      id: "with-missed-interrupt-penalty",
      label: "Baseline curves + confirmed missed interrupt opportunities penalized",
      curveMultiplier: 1,
      applyMissedOpportunityPenalty: true,
    },
  ],
  notes: [
    "V3 separates Utility behavior score from Utility confidence.",
    "NOT_OBSERVABLE and NOT_APPLICABLE domains are excluded from behavior — not scored as 50.",
    "NO_CONFIRMED_CONTRIBUTION uses neutral score (50); above 50 requires observed contribution.",
    "Without confirmed missed opportunities, empty observable domains stay at 50 — not below.",
  ],
} as const;

export type UtilityV3SimulationConfig = typeof UTILITY_V3_SIMULATION_CONFIG;
export type UtilityV3DomainKey = keyof typeof UTILITY_V3_SIMULATION_CONFIG.domainWeights;
export type UtilityV3EvidenceTier = (typeof UTILITY_V3_SIMULATION_CONFIG.evidenceTiers)[number];
export type UtilityV3DomainEligibility =
  | "SCORED"
  | "NOT_OBSERVABLE"
  | "NOT_APPLICABLE"
  | "NO_CONFIRMED_CONTRIBUTION";
