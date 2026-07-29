import type { AbilityCategory } from "@mplus/abilities";
import type {
  UtilityStandaloneV1Config,
  UtilityV1ComponentKey,
} from "./utility-v1-config.js";
import type { UtilityCatalogSpellAudit } from "./utility-catalog-audit.js";

export type UtilityV1ComponentState =
  | "SCORED"
  | "ZERO_CONFIRMED_CONTRIBUTION"
  | "NOT_APPLICABLE";

export interface UtilityV1ScoredAction {
  actionId: string;
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  timestamp: number;
  sourceActorId: number;
  sourceOwnership: "PLAYER" | "OWNED_PET";
  targetId: number | null;
  rawSpellId: number;
  canonicalKey: string;
  canonicalName: string;
  category: AbilityCategory;
  component: UtilityV1ComponentKey;
  evidence: string[];
  pointsBeforeCategoryCap: number;
  crossStreamMatch: {
    wclStream: string;
    catalogCategory: string;
    note: string;
  } | null;
}

export interface UtilityV1ComponentResult {
  component: UtilityV1ComponentKey;
  state: UtilityV1ComponentState;
  score: number | null;
  baseWeight: number;
  weightUsed: number;
  confirmedCount: number;
  reason: string | null;
  diminishingReturnsApplied: {
    meaningfulAt: number;
    incrementalPerUse: number;
    capAtCount: number;
    rawCount: number;
    cappedCount: number;
  } | null;
  evidence: Record<string, unknown>;
}

export interface UtilityV1RunScore {
  runId: string;
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  keyLevel: number | null;
  durationMs: number;
  specialization: string | null;
  classSlug: string | null;
  components: Record<UtilityV1ComponentKey, UtilityV1ComponentResult>;
  notApplicableComponents: UtilityV1ComponentKey[];
  zeroContributionComponents: UtilityV1ComponentKey[];
  confirmedEventCounts: Record<UtilityV1ComponentKey, number>;
  score: number;
  weightsApplied: Record<UtilityV1ComponentKey, number>;
  actionIds: string[];
}

export interface UtilityV1DungeonScore {
  dungeonSlug: string;
  runCount: number;
  medianScore: number | null;
  runScores: number[];
  componentMedians: Record<UtilityV1ComponentKey, number | null>;
  confirmedCountMedians: Record<UtilityV1ComponentKey, number | null>;
}

export interface UtilityV1GlobalScore {
  score: number | null;
  availableDungeonCount: number;
  expectedDungeonCount: number;
  dungeonMedians: Array<{ dungeonSlug: string; medianScore: number | null; runCount: number }>;
  equalWeightComponentAverages: Record<UtilityV1ComponentKey, number | null>;
  contributionByCategory: Record<UtilityV1ComponentKey, number | null>;
  note: string;
}

export interface UtilityV1CatalogAuditSummary {
  crossStreamMatches: UtilityCatalogSpellAudit[];
  aliasMatches: UtilityCatalogSpellAudit[];
  unresolvedSpellIds: number[];
  investigations: Array<{
    spellId: number;
    finding: string;
    catalogAction: string;
  }>;
}

export interface UtilityV1ConfidenceDiagnostics {
  configVersion: string;
  runCount: number;
  dungeonCoverage: {
    available: number;
    expected: number;
    missing: string[];
    sampleSizeByDungeon: Record<string, number>;
  };
  notApplicableCounts: Record<UtilityV1ComponentKey, number>;
  zeroContributionCounts: Record<UtilityV1ComponentKey, number>;
  incompleteDatasetRuns: Array<{ runId: string; missing: string[] }>;
  catalogAudit: UtilityV1CatalogAuditSummary;
  diminishingReturnsEffect: Record<
    UtilityV1ComponentKey,
    {
      totalConfirmedActions: number;
      actionsBeyondCap: number;
      averageCappedCount: number | null;
    }
  >;
  auditedExamples: Partial<Record<UtilityV1ComponentKey, UtilityV1ScoredAction[]>>;
  note: string;
}

export interface UtilityV1ScoreDataset {
  probeVersion: "utility-standalone-v1";
  scoredAt: string;
  config: UtilityStandaloneV1Config;
  runs: UtilityV1RunScore[];
  actions: UtilityV1ScoredAction[];
  perDungeon: UtilityV1DungeonScore[];
  global: UtilityV1GlobalScore;
  diagnostics: UtilityV1ConfidenceDiagnostics;
}
