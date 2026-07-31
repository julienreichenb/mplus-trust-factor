import type { Grade, MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import type { ScoreModelConfigV1 } from "../types.js";

/** Output artifact schema version — bump when JSON/CSV/MD shapes change. */
export const CALIBRATION_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Cohort manifest schema version. */
export const COHORT_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;

export type CalibrationBacktestMode =
  | "persisted-snapshot-only"
  | "draft-model-evaluate"
  | "refresh-then-evaluate";

export type QualitativeLabel = "excellent" | "good" | "average" | "weak" | "overrated";

export type CohortMemberSource = "user-selected" | "stratified-auto";

export type CalibrationRole = "DPS" | "TANK" | "HEALER";

/** Public-safe boost suspicion surface — generic, not tied to unmerged boost-shadow. */
export interface PublicBoostFlag {
  suspected: boolean;
  confidence: number | null;
  /** Evidence keys only; never raw private telemetry. */
  evidenceKeys: string[];
  source: "manifest" | "persisted-public" | "none";
}

export interface UtilityCostSummary {
  baselineRequestCost: number;
  fallbackRequestCost: number;
  fallbackTriggered: boolean;
  fallbackStopReason: string | null;
}

export interface CoverageRefreshState {
  coverageState: string | null;
  publicationStatus: string | null;
  refreshState: string | null;
  providerDataAsOf: string | null;
  scoreFreshness: "fresh" | "stale" | "unknown" | null;
}

/**
 * Evidence package for one cohort member.
 * Persisted mode uses snapshot (+ optional observations for draft eval).
 * Never triggers provider calls from the harness itself.
 */
export interface CalibrationMemberEvidence {
  memberId: string;
  /** Immutable snapshot id when available (avoids provider calls). */
  snapshotId?: string | null;
  snapshot?: ScoreSnapshotDTO | null;
  observations?: MetricObservationDTO[] | null;
  boost?: PublicBoostFlag | null;
  coverageRefresh?: CoverageRefreshState | null;
  utilityCost?: UtilityCostSummary | null;
  seasonSlug?: string | null;
}

export interface CalibrationModelRef {
  id?: string;
  key: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED" | "FIXTURE";
  config: ScoreModelConfigV1;
  /** True when this is the DB active model; draft eval must leave this unchanged. */
  isActive: boolean;
}

export interface CalibrationRunOptions {
  mode: CalibrationBacktestMode;
  /**
   * Required for draft-model-evaluate. Must not be activated by the harness.
   * When omitted in persisted mode, scores come from provided snapshots.
   */
  evaluationModel?: CalibrationModelRef;
  /** Active/reference model metadata recorded in the report (never mutated). */
  activeModel?: CalibrationModelRef | null;
  /**
   * Explicit opt-in for refresh-then-evaluate. Default false.
   * Even when true, a provider port must be supplied — this harness ships none.
   */
  allowRefreshThenEvaluate?: boolean;
  /** Hard budget for refresh mode (unused unless refresh is enabled). */
  refreshBudget?: { maxProviderCalls: number; maxCharacters: number };
  /** Fixed clock for deterministic replay. */
  calculatedAt?: string;
  /** Anonymize character identities in public-safe artifacts. */
  anonymize?: boolean;
  /** Seed for exploratory bootstrap CIs (deterministic). */
  bootstrapSeed?: number;
  bootstrapIterations?: number;
}

export interface PerCharacterCalibrationResult {
  memberId: string;
  region: string;
  realm: string;
  character: string;
  /** Present only when anonymize=false. */
  displayName?: string;
  role: CalibrationRole;
  classSlug: string;
  specSlug: string;
  expectedLabel: QualitativeLabel;
  meta: boolean;
  source: CohortMemberSource;
  suspectedBoostManifest: boolean;
  rationale: string;
  snapshotId: string | null;
  overallScore: number | null;
  grade: Grade | null;
  confidence: number | null;
  dimensions: Array<{
    dimension: string;
    score: number | null;
    confidence: number;
    weight: number;
    state: string;
  }>;
  coverageRefresh: CoverageRefreshState | null;
  boost: PublicBoostFlag;
  evaluationModelKey: string | null;
  evaluationModelVersion: number | null;
  evaluationModelStatus: string | null;
  activeModelKey: string | null;
  activeModelVersion: number | null;
  expectedVersusActual: {
    expectedLabel: QualitativeLabel;
    actualGrade: Grade | null;
    actualScore: number | null;
    labelRank: number;
    scoreRank: number | null;
  };
  utilityCost: UtilityCostSummary | null;
  lowConfidence: boolean;
  isUnrated: boolean;
  error: string | null;
}

export interface RankConfusionSummary {
  /** Spearman-like rank correlation between expert label order and score order. */
  labelScoreSpearman: number | null;
  pairwiseConcordance: number | null;
  pairwiseDiscordance: number | null;
  pairwiseTies: number | null;
  inversions: Array<{
    higherExpectedId: string;
    lowerExpectedId: string;
    higherExpectedLabel: QualitativeLabel;
    lowerExpectedLabel: QualitativeLabel;
    higherScore: number | null;
    lowerScore: number | null;
  }>;
}

export interface SliceSummary {
  key: string;
  count: number;
  meanScore: number | null;
  meanConfidence: number | null;
  gradeDistribution: Partial<Record<Grade, number>>;
  labelDistribution: Partial<Record<QualitativeLabel, number>>;
}

export interface DimensionSaturationSummary {
  dimension: string;
  scoredCount: number;
  floorRate: number;
  saturationRate: number;
  missingRate: number;
  meanScore: number | null;
}

export interface ConfidenceCoveragePoint {
  memberId: string;
  confidence: number;
  coverageRatio: number | null;
  grade: Grade | null;
}

export interface WeightAblationResult {
  weightKey: string;
  delta: number;
  meanScoreDelta: number;
  gradeChangeCount: number;
  exploratory: true;
}

export interface BootstrapInterval {
  metric: string;
  sampleSize: number;
  estimate: number;
  lower: number;
  upper: number;
  iterations: number;
  exploratory: true;
  note: string;
}

export interface CalibrationStatistics {
  monotonicOrdering: RankConfusionSummary;
  outliers: Array<{
    memberId: string;
    reason: string;
    expectedLabel: QualitativeLabel;
    actualGrade: Grade | null;
    actualScore: number | null;
  }>;
  dimensionSaturation: DimensionSaturationSummary[];
  confidenceVersusCoverage: ConfidenceCoveragePoint[];
  metaVersusNonMeta: { meta: SliceSummary; nonMeta: SliceSummary };
  roleSlices: SliceSummary[];
  classSpecSlices: SliceSummary[];
  missingDataSlices: SliceSummary[];
  gradeDistribution: Partial<Record<Grade, number>>;
  gradeDistributionNote: string;
  weightAblation: WeightAblationResult[];
  bootstrapIntervals: BootstrapInterval[];
}

export interface CalibrationReport {
  schemaVersion: typeof CALIBRATION_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  mode: CalibrationBacktestMode;
  cohortId: string;
  cohortSchemaVersion: string;
  cohortSize: number;
  evaluatedCount: number;
  errorCount: number;
  activeModel: {
    key: string | null;
    version: number | null;
    status: string | null;
    isActive: boolean;
  };
  evaluationModel: {
    key: string | null;
    version: number | null;
    status: string | null;
    isActive: boolean;
  };
  /** Always false — harness never activates models. */
  modelActivated: false;
  /** Always false in persisted / draft modes shipped here. */
  providerCallsMade: boolean;
  disclaimer: string;
  characters: PerCharacterCalibrationResult[];
  statistics: CalibrationStatistics;
  utilityCostAggregate: {
    totalBaseline: number;
    totalFallback: number;
    fallbackTriggeredCount: number;
  };
}

export interface CalibrationArtifacts {
  report: CalibrationReport;
  json: string;
  csv: string;
  markdown: string;
  /** Same report with identities stripped (always public-safe). */
  publicSafeReport: CalibrationReport;
  publicSafeJson: string;
  publicSafeMarkdown: string;
}
