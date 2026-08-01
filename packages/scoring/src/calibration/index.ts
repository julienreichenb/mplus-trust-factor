export {
  CALIBRATION_REPORT_SCHEMA_VERSION,
  COHORT_MANIFEST_SCHEMA_VERSION,
  CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION,
} from "./types.js";
export type {
  CalibrationBacktestMode,
  UnsupportedCalibrationMode,
  QualitativeLabel,
  CohortMemberSource,
  CalibrationRole,
  PublicBoostFlag,
  UtilityCostSummary,
  CoverageRefreshState,
  CalibrationEvidenceCoverage,
  CalibrationMemberEvidence,
  CalibrationModelRef,
  CalibrationRunOptions,
  PerCharacterCalibrationResult,
  RankConfusionSummary,
  SliceSummary,
  DimensionSaturationSummary,
  ConfidenceCoveragePoint,
  WeightAblationResult,
  BootstrapInterval,
  CalibrationStatistics,
  CalibrationReport,
  CalibrationArtifacts,
  CalibrationInputBundleV1,
  EvidenceValidationCode,
  EvidenceValidationIssue,
  ActiveDraftComparisonResult,
  ActiveDraftCharacterComparison,
  ActiveDraftComparisonAggregate,
  DimensionDelta,
} from "./types.js";

export {
  validateCohortManifest,
  LABEL_RANK,
  GRADE_RANK,
  type CohortManifest,
  type CohortManifestMember,
  type ManifestValidationResult,
} from "./manifest.js";

export { defaultBoostFlagSource, type BoostFlagSource } from "./boost-flags.js";

export {
  runCalibrationHarness,
  gradeRank,
  type CalibrationEvidencePort,
  type CalibrationHarnessDeps,
} from "./evaluate.js";

export {
  buildCalibrationStatistics,
  computeRankConfusion,
  detectOutliers,
  createSeededRng,
} from "./stats.js";

export { spearmanRankCorrelation, averageRanksAscending } from "./ranking.js";

export {
  validateMemberEvidence,
  hasReplayableScoringContext,
} from "./evidence-validation.js";

export {
  createAblatedModel,
  computeEngineWeightAblation,
} from "./ablation.js";

export { buildActiveDraftComparison } from "./comparison.js";

export {
  validateCalibrationInputBundle,
  buildCalibrationInputBundle,
  type BundleValidationResult,
} from "./bundle.js";

export {
  runCalibrationHarnessFromBundle,
  runCalibrationHarnessFromExport,
  type CalibrationBundleExportPort,
  type RunCalibrationFromExportInput,
  type RunCalibrationFromExportResult,
} from "./async-boundary.js";

export {
  buildCalibrationArtifacts,
  reportToCsv,
  reportToJson,
  reportToMarkdown,
} from "./reports.js";

export { anonymizeReport } from "./anonymize.js";

export {
  runAdminCalibrationBacktest,
  toAdminBacktestSummary,
  type AdminBacktestSummaryV1,
  type AdminCalibrationBacktestResult,
  type RunAdminCalibrationBacktestInput,
} from "./admin-adapter.js";

export {
  buildSyntheticFixtureCohort,
  buildSyntheticFixtureBundle,
  createFixtureEvidencePort,
  V6_CANONICAL_METRIC_KEYS,
  RETIRED_PERFORMANCE_METRIC_KEYS,
} from "./fixture-cohort.js";

export {
  CALIBRATION_DIGEST_ALGORITHM_VERSION,
  buildCalibrationDigestV1,
  type CalibrationDigestV1,
  type DigestFinding,
} from "./digest.js";
