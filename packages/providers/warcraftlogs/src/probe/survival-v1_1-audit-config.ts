/**
 * Audit / candidate configuration for Survival V1.1 hardening.
 * Production V1.1 thresholds remain in survival-v1_1-config.ts — these are comparison-only.
 */
export const SURVIVAL_V1_1_AUDIT_CONFIG = {
  version: "survival-standalone-v1.1-audit",
  baseConfigVersion: "survival-standalone-v1.1",
  fragmentation: {
    /** Gaps to report between consecutive windows (diagnostic). */
    proximityGapsMs: [8_000, 12_000, 15_000] as const,
    /** Candidate merge: require stable recovery above this HP ratio. */
    recoverAboveHpRatio: 0.5,
    /** Candidate merge: minimum stable recovery period before a new window. */
    stableRecoveryMs: 5_000,
    /** Candidate merge gap options compared against current 8s. */
    candidateMergeGapsMs: [8_000, 12_000, 15_000] as const,
  },
  defensive: {
    /**
     * Candidate: one activation covers all windows in a pressure-cluster until
     * the player recovers above recoverAboveHpRatio for stableRecoveryMs.
     */
    creditOncePerPressureCluster: true,
  },
  recovery: {
    /** Compare self-heal effectiveness thresholds. */
    selfHealMinRatioCandidates: [0.05, 0.075, 0.1] as const,
    /** Known warlock passive / absorb heals observed in Wallidrixe data (diagnostic only). */
    observedNonCatalogHealNotes: [
      { spellId: 108366, name: "Soul Leech" },
      { spellId: 108416, name: "Dark Pact" },
      { spellId: 143924, name: "Leech" },
      { spellId: 386124, name: "Fel Armor" },
    ] as const,
  },
  temporaryMaxHp: {
    /** Relative deviation from modal baseline treated as temporary. */
    temporaryDeviationRatio: 0.05,
    /** Dark Pact spell id (common temporary max-HP source for warlocks). */
    darkPactSpellId: 108416,
  },
  manualSample: {
    nonFatalCount: 10,
    defensiveMissCount: 5,
    proactiveCoverCount: 5,
    recoveryMissCount: 5,
    /** Deterministic seed for reproducible random samples. */
    seed: 42,
  },
  weights: {
    survivalOutcome: 0.55,
    defensiveResponse: 0.3,
    emergencyRecovery: 0.15,
  },
} as const;

export type SurvivalV1_1AuditConfig = typeof SURVIVAL_V1_1_AUDIT_CONFIG;
