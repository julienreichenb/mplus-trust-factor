import type {
  UtilityV3DomainEligibility,
  UtilityV3DomainKey,
  UtilityV3EvidenceTier,
  UtilityV3SimulationConfig,
} from "./utility-v3-config.js";
import type { UtilityV2EvidenceItem } from "./utility-v2-types.js";

export interface UtilityV3DomainRunScore {
  domain: UtilityV3DomainKey;
  eligibility: UtilityV3DomainEligibility;
  eligibilityReason: string;
  domainScore: number | null;
  effectivePerHour: number | null;
  tierCounts: Record<UtilityV3EvidenceTier, number>;
  observability: "FULL" | "PARTIAL" | "LIMITED" | "NOT_TRACKED";
  confidence: number;
  redistributedWeight: number | null;
  evidenceContribution: Record<UtilityV3EvidenceTier, number>;
}

export interface UtilityV3RunSimulation {
  runId: string;
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  durationMs: number;
  durationHours: number;
  domains: Record<UtilityV3DomainKey, UtilityV3DomainRunScore>;
  behaviorScore: number;
  confidence: number;
  semanticBand: string;
  redistributedWeights: Record<UtilityV3DomainKey, number>;
  scoredDomainCount: number;
  excludedDomainCount: number;
  missedInterruptOpportunities: number;
}

export interface UtilityV3DungeonSimulation {
  dungeonSlug: string;
  runCount: number;
  medianBehaviorScore: number | null;
  medianConfidence: number | null;
  domainMedians: Record<UtilityV3DomainKey, number | null>;
  eligibilitySummary: Record<UtilityV3DomainKey, Record<UtilityV3DomainEligibility, number>>;
}

export interface UtilityV3SensitivityResult {
  scenarioId: string;
  label: string;
  behaviorScore: number | null;
  confidence: number | null;
  deltaBehaviorFromBaseline: number | null;
}

export interface UtilityV3SimulationDataset {
  simulationVersion: string;
  scoredAt: string;
  config: UtilityV3SimulationConfig;
  subject: {
    region: string | null;
    realmSlug: string | null;
    name: string | null;
    classSlug: string | null;
    specSlug: string | null;
  };
  evidenceInventory: UtilityV2EvidenceItem[];
  runSimulations: UtilityV3RunSimulation[];
  perDungeon: UtilityV3DungeonSimulation[];
  global: {
    behaviorScore: number | null;
    confidence: number | null;
    semanticBand: string;
    semanticExplanation: string;
    runCount: number;
    dungeonCount: number;
    scoredVsExcludedDomains: {
      scored: Record<UtilityV3DomainKey, number>;
      excluded: Record<UtilityV3DomainKey, number>;
      notApplicable: Record<UtilityV3DomainKey, number>;
      noConfirmedContribution: Record<UtilityV3DomainKey, number>;
      notObservable: Record<UtilityV3DomainKey, number>;
    };
    domainScores: Record<UtilityV3DomainKey, number | null>;
    redistributedWeights: Record<UtilityV3DomainKey, number>;
    evidenceContributionByType: Record<UtilityV3EvidenceTier, number>;
    aggregateTierCounts: Record<UtilityV3EvidenceTier, number>;
  };
  sensitivityAnalysis: UtilityV3SensitivityResult[];
  diagnostics: {
    rejectedV2Reasons: string[];
    notes: string[];
  };
}

export interface UtilityV3ScenarioOptions {
  id: string;
  label: string;
  curveMultiplier?: number;
  weightOverrides?: Partial<Record<UtilityV3DomainKey, number>>;
  applyMissedOpportunityPenalty?: boolean;
}
