import type {
  UtilityV2AuditConfig,
  UtilityV2DomainKey,
  UtilityV2EvidenceTier,
} from "./utility-v2-config.js";

export type UtilityV2EvidenceKind =
  | "REGULAR_INTERRUPT"
  | "CROSS_STREAM_CAST_STOP"
  | "CASTER_CONTROL"
  | "STRATEGIC_CC"
  | "MECHANIC_AVOIDANCE"
  | "GROUP_MOBILITY_CAST"
  | "GROUP_MOBILITY_TRAVERSAL"
  | "DISPEL"
  | "PURGE"
  | "EXTERNAL"
  | "BATTLE_REZ";

export interface UtilityV2EvidenceItem {
  id: string;
  domain: UtilityV2DomainKey;
  kind: UtilityV2EvidenceKind;
  tier: UtilityV2EvidenceTier;
  timestamp: number;
  abilityGameID: number | null;
  abilityName: string | null;
  targetActorId: number | null;
  interruptedSpellId: number | null;
  removedSpellId: number | null;
  durationMs: number | null;
  correlationNotes: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  observability: "FULL" | "PARTIAL" | "LIMITED";
}

export interface UtilityV2DomainEvidenceSummary {
  domain: UtilityV2DomainKey;
  applicable: boolean;
  applicabilityReason: string | null;
  tierCounts: Record<UtilityV2EvidenceTier, number>;
  items: UtilityV2EvidenceItem[];
  normalizedRatesPerHour: Record<UtilityV2EvidenceTier, number>;
  observability: "FULL" | "PARTIAL" | "LIMITED" | "NOT_APPLICABLE";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NOT_APPLICABLE";
  missedOpportunityCount: number;
}

export interface UtilityV2RunAudit {
  runId: string;
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  durationMs: number;
  durationHours: number;
  domains: Record<UtilityV2DomainKey, UtilityV2DomainEvidenceSummary>;
  simulatedScore: number;
  simulatedScoreByDomain: Record<UtilityV2DomainKey, number | null>;
  deltaFromNeutral: number;
  missedInterruptOpportunities: number;
}

export interface UtilityV2DungeonSimulatedScore {
  dungeonSlug: string;
  runCount: number;
  medianSimulatedScore: number | null;
  meanSimulatedScore: number | null;
  tierTotals: Record<UtilityV2EvidenceTier, number>;
  domainTierTotals: Record<UtilityV2DomainKey, Record<UtilityV2EvidenceTier, number>>;
}

export interface UtilityV2SensitivityScenarioResult {
  scenarioId: string;
  label: string;
  globalSimulatedScore: number | null;
  perDungeon: Array<{ dungeonSlug: string; medianScore: number | null }>;
  deltaFromBaselineScenario: number | null;
}

export interface UtilityV2AuditDataset {
  auditVersion: string;
  scoredAt: string;
  config: UtilityV2AuditConfig;
  subject: {
    region: string | null;
    realmSlug: string | null;
    name: string | null;
    classSlug: string | null;
    specSlug: string | null;
  };
  evidenceInventory: UtilityV2EvidenceItem[];
  runAudits: UtilityV2RunAudit[];
  perDungeon: UtilityV2DungeonSimulatedScore[];
  global: {
    neutralBaseline: number;
    simulatedScore: number | null;
    deltaFromNeutral: number | null;
    runCount: number;
    dungeonCount: number;
    aggregateTierCounts: Record<UtilityV2EvidenceTier, number>;
    aggregateDomainTierCounts: Record<UtilityV2DomainKey, Record<UtilityV2EvidenceTier, number>>;
    observabilitySummary: Record<
      UtilityV2DomainKey,
      { full: number; partial: number; limited: number; na: number }
    >;
    confidenceSummary: Record<
      UtilityV2DomainKey,
      { high: number; medium: number; low: number; na: number }
    >;
  };
  sensitivityAnalysis: UtilityV2SensitivityScenarioResult[];
  diagnostics: {
    rejectedV1Reasons: string[];
    rawDatasetCoverage: Record<string, number>;
    notes: string[];
  };
}

export interface UtilityV2RawRunBundle {
  runId: string;
  reportCode: string;
  fightId: number;
  casts: Array<Record<string, unknown>>;
  buffs: Array<Record<string, unknown>>;
  debuffs: Array<Record<string, unknown>>;
  interrupts: Array<Record<string, unknown>>;
}

export interface UtilityV2HostileCastWindow {
  start: number;
  end: number | null;
  sourceId: number;
  abilityGameId: number | null;
  interruptible: boolean | null;
  completed: boolean | null;
}

export interface UtilityV2ScenarioOptions {
  id: string;
  label: string;
  weightOverrides?: Partial<Record<UtilityV2DomainKey, number>>;
  weightMultiplier?: number;
  tierMultiplier?: number;
  applyMissedOpportunityPenalty?: boolean;
}
