import type { EvidenceRole } from "@mplus/contracts";
import type {
  PerformanceV2CalibrationStatus,
  PERFORMANCE_V2_MODEL_CONFIG,
  PERFORMANCE_V2_SCHEMA_VERSION,
} from "./constants.js";

/** Versioned Season Difficulty Policy — never a hardcoded universal high-key threshold. */
export interface SeasonDifficultyPolicyV2 {
  id: string;
  seasonId: string;
  region: string;
  role: string;
  specSlug: string | null;
  effectiveFrom: string;
  k50: number;
  k90: number;
  k99: number;
  source: "PLATFORM" | "BLIZZARD" | "RAIDER_IO" | "MANUAL";
  sampleSize: number | null;
  confidence: number;
  version: string;
}

/** How a run-level parse percentile was obtained. */
export type PerformanceParseSemanticV2 =
  | "BRACKET_PERCENT"
  | "RANK_PERCENT"
  | "UNAVAILABLE";

/** Per selected-slot run parse fact (provider-free input). */
export interface PerformanceRunParseFactV2 {
  /** Matches EvidenceManifestV2 slotId when bound. */
  slotId: string;
  dungeonSlug: string;
  keyLevel: number;
  /** Same-key / same-bracket parse percentile in [0, 100], or null. */
  parsePercentile: number | null;
  semantic: PerformanceParseSemanticV2;
  /** Optional WCL partition for season compatibility checks. */
  partition: number | null;
  /** Explanatory only — never used as score input. */
  rawDps: number | null;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
}

/** Per-dungeon WCL profile aggregate percentiles. */
export interface PerformanceProfileDungeonAggregateV2 {
  dungeonSlug: string;
  bestParsePercentile: number | null;
  medianParsePercentile: number | null;
  loggedRunCount: number;
}

/** Character-level WCL profile aggregates for the stabilizer. */
export interface PerformanceProfileAggregateFactV2 {
  bestDpsPercentileAverage: number | null;
  medianDpsPercentileAverage: number | null;
  /** Optional equal-dungeon recompute inputs for diagnostic disagreement. */
  perDungeon: PerformanceProfileDungeonAggregateV2[];
  partition: number | null;
  zoneId: number | null;
  totalLoggedRuns: number | null;
  latestObservedAt: string | null;
}

export type PerformanceRoleAdapterStateV2 =
  | "SUPPORTED"
  | "UNSUPPORTED_ROLE"
  | "ADAPTER_UNVERIFIED"
  | "SPEC_UNRESOLVED";

export interface PerformanceRoleAdapterResultV2 {
  role: EvidenceRole;
  state: PerformanceRoleAdapterStateV2;
  /** When false, detailed run parses must not produce a fabricated score. */
  runParseAllowed: boolean;
  reason: string | null;
}

export interface PerformanceAdjustedParseV2 {
  slotId: string;
  dungeonSlug: string;
  keyLevel: number;
  rawParsePercentile: number;
  semantic: PerformanceParseSemanticV2;
  difficultyMultiplier: number;
  adjustedParse: number;
}

export interface PerformanceDungeonScoreV2 {
  dungeonSlug: string;
  runCount: 1 | 2;
  peak: number | null;
  floor: number | null;
  /** Within-dungeon consistency from raw parses (two-run only). */
  consistency: number | null;
  dungeonPerformance: number;
  runs: PerformanceAdjustedParseV2[];
  /** One-run dungeons are confidence-capped at the aggregate stage. */
  oneRunConfidenceCapped: boolean;
}

export interface PerformanceContributorDiagnosticV2 {
  key: string;
  value: number | null;
  weight: number | null;
  note: string | null;
}

export interface PerformanceExplanationV2 {
  algorithmVersion: string;
  modelLabel: string;
  calibrationStatus: PerformanceV2CalibrationStatus;
  /** Canonical hash of the frozen model config used for this computation. */
  modelConfigFingerprint?: string;
  difficultyPolicy: {
    id: string;
    version: string;
    k50: number;
    k90: number;
    k99: number;
    source: SeasonDifficultyPolicyV2["source"];
    confidence: number;
  };
  roleAdapter: PerformanceRoleAdapterResultV2;
  selectedRuns: Array<{
    slotId: string;
    dungeonSlug: string;
    keyLevel: number;
    rawParsePercentile: number | null;
    adjustedParse: number | null;
    semantic: PerformanceParseSemanticV2;
  }>;
  dungeons: PerformanceDungeonScoreV2[];
  detailedSeasonPerformance: number | null;
  profilePerformance: number | null;
  profileEqualDungeonPerformance: number | null;
  profileDisagreement: number | null;
  slotCoverage: number;
  detailedWeight: number;
  missingSlots: number;
  missingDungeons: string[];
  partitionCompatible: boolean;
  confidenceLimits: string[];
  phase2State: "INACTIVE";
  phase3State: "INACTIVE";
  contributors: PerformanceContributorDiagnosticV2[];
}

export type PerformanceV2AvailabilityState =
  | "AVAILABLE"
  | "PARTIAL"
  | "UNAVAILABLE";

export interface PerformanceV2ComputeInput {
  /** Frozen EvidenceManifestV2 identity stamps (no reselection). */
  manifest: {
    contentHash: string;
    schemaVersion: string;
    selectorVersion: string;
    characterId: string;
    seasonId: string;
    seasonSlug: string;
    specSlug: string | null;
    role: EvidenceRole;
    highKeyPolicyId: string;
    activeDungeonSlugs: string[];
    expectedSlotCount: number;
    selectedSlotCount: number;
    evidenceCutoffAt: string;
  };
  /** Run parse facts for selected slots only (caller binds by slotId). */
  runParseFacts: PerformanceRunParseFactV2[];
  /** WCL profile aggregates; null when unavailable. */
  profileAggregate: PerformanceProfileAggregateFactV2 | null;
  difficultyPolicy: SeasonDifficultyPolicyV2;
  /** Expected WCL partition for the active season; null skips hard mismatch. */
  expectedPartition: number | null;
  /** 0–1 freshness of WCL evidence. */
  logFreshness: number;
  /** Wall-clock for deterministic explanation stamps only. */
  computedAt: string;
}

export interface PerformanceV2ComputeResult {
  score: number | null;
  confidence: number;
  state: PerformanceV2AvailabilityState;
  algorithmVersion: string;
  modelLabel: string;
  calibrationStatus: PerformanceV2CalibrationStatus;
  modelConfigFingerprint: string;
  inputFingerprint: string;
  detailedSeasonPerformance: number | null;
  profilePerformance: number | null;
  detailedWeight: number;
  slotCoverage: number;
  dungeons: PerformanceDungeonScoreV2[];
  roleAdapter: PerformanceRoleAdapterResultV2;
  explanation: PerformanceExplanationV2;
  /** Shadow DimensionComputation metrics document. */
  metrics: Record<string, unknown>;
}

/** Replayable calibration export (provider-free). */
export interface PerformanceV2CalibrationExport {
  schemaVersion: typeof PERFORMANCE_V2_SCHEMA_VERSION;
  algorithmVersion: string;
  modelConfig: typeof PERFORMANCE_V2_MODEL_CONFIG;
  input: PerformanceV2ComputeInput;
  result: Pick<
    PerformanceV2ComputeResult,
    | "score"
    | "confidence"
    | "state"
    | "inputFingerprint"
    | "detailedSeasonPerformance"
    | "profilePerformance"
    | "detailedWeight"
    | "slotCoverage"
  >;
  contributors: PerformanceContributorDiagnosticV2[];
}
