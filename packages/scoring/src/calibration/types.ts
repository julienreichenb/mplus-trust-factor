import type { Grade, MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import type { ScoreModelConfigV1, ScoringContext } from "../types.js";
import type { CohortManifest } from "./manifest.js";

/** Output artifact schema version — bump when JSON/CSV/MD shapes change. */
export const CALIBRATION_REPORT_SCHEMA_VERSION = "1.1.0" as const;

/** Cohort manifest schema version. */
export const COHORT_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;

/** Portable calibration input bundle schema version. */
export const CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION = "1.0.0" as const;

/** Executable calibration modes (refresh-then-evaluate is unsupported — see docs). */
export type CalibrationBacktestMode =
  | "persisted-snapshot-only"
  | "draft-model-evaluate"
  | "active-versus-draft";

/** Documented future mode — rejected at validation/runtime with UNSUPPORTED_MODE. */
export type UnsupportedCalibrationMode = "refresh-then-evaluate";

export type QualitativeLabel = "excellent" | "good" | "average" | "weak" | "overrated";

export type CohortMemberSource = "user-selected" | "stratified-auto";

export type CalibrationRole = "DPS" | "TANK" | "HEALER";

export type EvidenceValidationCode =
  | "MEMBER_ID_MISMATCH"
  | "CHARACTER_ID_MISMATCH"
  | "SNAPSHOT_ID_MISSING"
  | "SNAPSHOT_ID_NOT_IN_MANIFEST"
  | "SEASON_MISMATCH"
  | "MODEL_KEY_MISMATCH"
  | "MODEL_VERSION_MISMATCH"
  | "MODEL_REF_CONFLICT"
  | "DUPLICATE_SNAPSHOT_ID"
  | "MISSING_REPLAY_CONTEXT"
  | "MISSING_OBSERVATIONS"
  | "INVALID_TIMESTAMP"
  | "INVALID_FINGERPRINT"
  | "MISSING_SNAPSHOT"
  | "UNSUPPORTED_MODE"
  | "MISSING_EVIDENCE"
  | "INVALID_BUNDLE"
  | "CONFLICTING_MODEL_REFS";

export interface EvidenceValidationIssue {
  code: EvidenceValidationCode;
  memberId: string | null;
  message: string;
}

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
 * Explicit evidence / model coverage — distinct from confidence and from
 * dimension-availability counts.
 */
export interface CalibrationEvidenceCoverage {
  /** 0–1 selected detailed-run coverage when known. */
  selectedRunCoverage: number | null;
  /** 0–1 analyzed-run coverage when known. */
  analyzedRunCoverage: number | null;
  /** Snapshot/engine modelCoverageRatio when known. */
  modelCoverageRatio: number | null;
  availableModelWeight: number | null;
  totalModelWeight: number | null;
  /** Utility-specific evidence coverage when known. */
  utilityEvidenceCoverage: number | null;
  /**
   * Share of public dimensions with a numeric score.
   * Named separately — not a substitute for run/evidence coverage.
   */
  dimensionAvailabilityRatio: number | null;
}

/**
 * Evidence package for one cohort member.
 * Persisted mode uses snapshot (+ optional observations for draft eval).
 * Never triggers provider calls from the harness itself.
 */
export interface CalibrationMemberEvidence {
  memberId: string;
  /**
   * Stable character identity used for snapshot provenance checks.
   * Defaults to memberId when omitted (fixtures / local exports).
   */
  characterId?: string | null;
  /** Immutable snapshot id when available (avoids provider calls). */
  snapshotId?: string | null;
  snapshot?: ScoreSnapshotDTO | null;
  observations?: MetricObservationDTO[] | null;
  /**
   * Complete scoring context required for deterministic draft / comparison replay.
   * Must not be fabricated by the harness.
   */
  scoringContext?: ScoringContext | null;
  /** Replay clock when recalculating; snapshot.calculatedAt used for snapshot-only. */
  calculatedAt?: string | null;
  /** Optional fingerprint of observations+context for equivalence proofs. */
  inputFingerprint?: string | null;
  boost?: PublicBoostFlag | null;
  coverageRefresh?: CoverageRefreshState | null;
  evidenceCoverage?: CalibrationEvidenceCoverage | null;
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
  mode: CalibrationBacktestMode | UnsupportedCalibrationMode;
  /**
   * Required for draft-model-evaluate and active-versus-draft.
   * Must not be activated by the harness.
   * When omitted in persisted mode, scores come from provided snapshots.
   */
  evaluationModel?: CalibrationModelRef;
  /** Active/reference model metadata recorded in the report (never mutated). */
  activeModel?: CalibrationModelRef | null;
  /**
   * @deprecated refresh-then-evaluate is unsupported. Retained only so callers
   * receive an explicit UNSUPPORTED_MODE rejection.
   */
  allowRefreshThenEvaluate?: boolean;
  /** @deprecated Unused — refresh mode is unsupported. */
  refreshBudget?: { maxProviderCalls: number; maxCharacters: number };
  /** Fixed clock for deterministic replay. */
  calculatedAt?: string;
  /** Anonymize character identities in public-safe artifacts. */
  anonymize?: boolean;
  /** Seed for exploratory bootstrap CIs (deterministic). */
  bootstrapSeed?: number;
  bootstrapIterations?: number;
  /**
   * Optional sequential progress hook (admin calibration UI).
   * Invoked after each member is evaluated (including failures).
   * Must not call providers or mutate production scores.
   */
  onMemberProgress?: (event: {
    index: number;
    total: number;
    memberId: string;
    characterName: string;
    realm: string;
    region: string;
    status: "completed" | "failed";
    result: PerCharacterCalibrationResult;
  }) => void;
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
  evidenceCoverage: CalibrationEvidenceCoverage | null;
  boost: PublicBoostFlag;
  evaluationModelKey: string | null;
  evaluationModelVersion: number | null;
  evaluationModelStatus: string | null;
  activeModelKey: string | null;
  activeModelVersion: number | null;
  /** Model that actually produced the primary snapshot/score (provenance). */
  scoreModelKey: string | null;
  scoreModelVersion: number | null;
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
  /** Scoring failure (engine/runtime). Distinct from validationFailure. */
  error: string | null;
  /** Provenance / evidence validation failure — excluded from score aggregates. */
  validationFailure: EvidenceValidationIssue | null;
  /** How the primary score was obtained. */
  evaluationKind: "snapshot-only" | "replay" | "failed";
  /** Shared fingerprint of replay inputs when recalculated. */
  evidenceFingerprint: string | null;
}

export interface RankConfusionSummary {
  /**
   * Tie-aware Spearman between qualitative label strength and score values.
   * Perfect agreement → ≈ +1; perfect inverse → ≈ −1; constants → null.
   */
  labelScoreSpearman: number | null;
  /** Mid-rank method note for consumers. */
  tieMethod: "average-ranks";
  pairwiseConcordance: number | null;
  pairwiseDiscordance: number | null;
  pairwiseTies: number | null;
  /** Scored members used as denominator for concordance. */
  sampleSize: number;
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
  /** Members with a numeric overall score (errors/validation failures excluded). */
  scoredCount: number;
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
  /** Prefer selected-run / model coverage; null when unknown. */
  selectedRunCoverage: number | null;
  modelCoverageRatio: number | null;
  /** Dimension availability only — not run coverage. */
  dimensionAvailabilityRatio: number | null;
  /**
   * @deprecated Prefer selectedRunCoverage / modelCoverageRatio.
   * Kept as alias of the best available explicit coverage ratio.
   */
  coverageRatio: number | null;
  grade: Grade | null;
}

export interface WeightAblationResult {
  weightKey: string;
  /** Signed relative weight change applied (−1 = zeroed). */
  delta: number;
  meanScoreDelta: number;
  medianScoreDelta: number | null;
  gradeChangeCount: number;
  sampleSize: number;
  exploratory: true;
  method: "engine-zero-renormalize";
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

export interface DimensionDelta {
  dimension: string;
  activeScore: number | null;
  draftScore: number | null;
  delta: number | null;
}

export interface ActiveDraftCharacterComparison {
  memberId: string;
  role: CalibrationRole;
  classSlug: string;
  specSlug: string;
  expectedLabel: QualitativeLabel;
  meta: boolean;
  activeOverallScore: number | null;
  draftOverallScore: number | null;
  scoreDelta: number | null;
  activeGrade: Grade | null;
  draftGrade: Grade | null;
  gradeTransition: string | null;
  activeConfidence: number | null;
  draftConfidence: number | null;
  confidenceDelta: number | null;
  dimensionDeltas: DimensionDelta[];
  activeModelKey: string | null;
  activeModelVersion: number | null;
  draftModelKey: string | null;
  draftModelVersion: number | null;
  evidenceFingerprint: string | null;
  comparable: boolean;
  activeError: string | null;
  draftError: string | null;
}

export interface ActiveDraftComparisonAggregate {
  sampleSize: number;
  comparableCount: number;
  meanScoreDelta: number | null;
  medianScoreDelta: number | null;
  gradeTransitionCounts: Record<string, number>;
  changedGradeCount: number;
  changedGradePercent: number | null;
  meanDimensionDeltas: Array<{ dimension: string; meanDelta: number | null; sampleSize: number }>;
  largestPositiveMovers: Array<{ memberId: string; scoreDelta: number }>;
  largestNegativeMovers: Array<{ memberId: string; scoreDelta: number }>;
  roleSlices: SliceSummary[];
  classSpecSlices: SliceSummary[];
  expectedLabelSlices: SliceSummary[];
  metaVersusNonMeta: { meta: SliceSummary; nonMeta: SliceSummary };
  lowConfidenceSlices: SliceSummary[];
  missingDataSlices: SliceSummary[];
}

export interface ActiveDraftComparisonResult {
  schemaVersion: "1.0.0";
  comparable: boolean;
  note: string;
  characters: ActiveDraftCharacterComparison[];
  aggregate: ActiveDraftComparisonAggregate | null;
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
  /** Members excluded from score-based denominators (validation + scoring failures). */
  failedMemberCount: number;
  scoredMemberCount: number;
}

export interface CalibrationReport {
  schemaVersion: typeof CALIBRATION_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  mode: CalibrationBacktestMode | UnsupportedCalibrationMode;
  cohortId: string;
  cohortSchemaVersion: string;
  cohortSize: number;
  evaluatedCount: number;
  errorCount: number;
  validationFailureCount: number;
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
  /** Always false in shipped modes. */
  providerCallsMade: boolean;
  disclaimer: string;
  characters: PerCharacterCalibrationResult[];
  statistics: CalibrationStatistics;
  /** Present for active-versus-draft; null otherwise. */
  activeDraftComparison: ActiveDraftComparisonResult | null;
  validationFailures: EvidenceValidationIssue[];
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

/**
 * Versioned portable calibration input.
 * Built by fixtures or by Agent 08 async DB/export adapters — never by the pure core from DB.
 */
export interface CalibrationInputBundleV1 {
  schemaVersion: typeof CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION;
  manifest: CohortManifest;
  evidenceByMemberId: Record<string, CalibrationMemberEvidence>;
  activeModel?: CalibrationModelRef;
  evaluationModel?: CalibrationModelRef;
  generatedAt: string;
  source: "fixture" | "persisted-export";
  /** Optional default mode hint; CLI --mode overrides. */
  mode?: CalibrationBacktestMode;
}
