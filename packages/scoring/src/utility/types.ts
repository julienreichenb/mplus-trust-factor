import type { IsoDateTime } from "@mplus/contracts";
import type {
  GroupSupportEvidenceMode,
  UtilityCapability,
} from "@mplus/mechanics";

/** Per-run raw inputs for Utility v3 (from UtilityRawFacts + duration). */
export interface UtilityRunFactsInput {
  dungeonSlug: string;
  dungeonName?: string;
  canonicalRunId: string;
  keyLevel: number;
  durationMs: number | null;
  detailAvailable: boolean;
  kickCasts: number | null;
  successfulInterrupts: number | null;
  effectiveKickCooldownMs: number | null;
  distinctCcTargets: number | null;
  groupSupportCasts: number | null;
  groupSupportConfirmedUsages?: number | null;
  groupSupportEvidenceMode?: GroupSupportEvidenceMode | null;
  defensiveDispels: number | null;
  offensiveDispels: number | null;
  wclCoverageRatio?: number | null;
}

export interface UtilityContributorScore {
  key: "interrupts" | "crowd_control" | "group_support" | "dispels";
  weight: number;
  /** 0–100 score, null when contributor unavailable for this run. */
  score: number | null;
  available: boolean;
  evidence: Record<string, number | string | boolean | null>;
}

export interface UtilityRunScore {
  dungeonSlug: string;
  dungeonName: string;
  canonicalRunId: string;
  keyLevel: number;
  detailAvailable: boolean;
  /** Capability-weighted run score 0–100, null when no contributors available. */
  runUtilityScore: number | null;
  contributors: UtilityContributorScore[];
  confidence: number;
  missingContributors: string[];
  catalogCoverage: UtilityCapability["catalogCoverage"] | null;
}

export interface UtilitySummaryDTO {
  score: number | null;
  confidence: number;
  /** Runs with usable combat-derived utility scores. */
  availableRunCount: number;
  /** Selected canonical runs in the eight-dungeon set. */
  selectedRunCount: number;
  /** @deprecated Use availableRunCount — kept for snapshot compatibility. */
  dungeonCount: number;
  expectedDungeonCount: number;
  formulaVersion: string;
  weights: {
    interrupts: number;
    crowdControl: number;
    groupSupport: number;
    dispels: number;
  };
  appliedWeights: Array<{ key: string; weight: number }>;
  droppedContributors: string[];
  runs: UtilityRunScore[];
  latestObservedAt: IsoDateTime | null;
}

export interface ComputeUtilityInput {
  runs: UtilityRunFactsInput[];
  expectedDungeonCount: number;
  /** Selected canonical runs (eight-dungeon set). Defaults to runs.length. */
  selectedRunCount?: number;
  capability: UtilityCapability;
  hasResolvedSpecAndRole: boolean;
  selectedRunWclCoverage: number;
  logFreshness?: number;
  abilityCatalogVersion?: string | null;
  observedAt?: IsoDateTime | null;
}

export interface ComputeUtilityResult {
  summary: UtilitySummaryDTO;
  utilityScore: number | null;
  confidence: number;
  observations: {
    interrupts: number | null;
    crowdControl: number | null;
    groupSupport: number | null;
    dispels: number | null;
  };
}
