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
  CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION,
  computeCalibrationBundleV2Hash,
  validateCalibrationInputBundleV2,
  buildCalibrationInputBundleV2,
  preflightCalibrationBundleV2,
  buildFrozenRunIdentityKey,
  extractSelectedFrozenRunIdentities,
  collectDuplicateFrozenIdentityIssues,
  type CalibrationArtifactClassV2,
  type CalibrationContentRefV2,
  type FrozenSeasonBindingV2,
  type FrozenPolicyCatalogVersionsV2,
  type CalibrationMemberReplayV2,
  type CalibrationInputBundleV2,
  type CalibrationPreflightSeverityV2,
  type CalibrationPreflightCodeV2,
  type CalibrationPreflightIssueV2,
  type CalibrationBundleV2ValidationResult,
  type CalibrationBundleV2PreflightResult,
  type ArtifactResolverV2,
  type ExtractedFrozenRunIdentity,
} from "./bundle-v2.js";

export {
  dispatchValidateCalibrationBundle,
  type CalibrationBundleDispatchResult,
} from "./bundle-dispatch.js";

export {
  replayCalibrationBundleV2,
  replayCalibrationBundleV2ActiveVersusDraft,
  createMapArtifactResolverV2,
  type CalibrationV2DimensionReplayResult,
  type CalibrationV2MemberReplayResult,
  type CalibrationV2ReplayReport,
} from "./replay-v2.js";

export {
  CALIBRATION_REPORT_V2_SCHEMA_VERSION,
  CALIBRATION_V2_MIN_SLICE_SIZE,
  buildCalibrationReportV2Extension,
  type CalibrationV2SliceLimitation,
  type CalibrationV2SliceSummary,
  type CalibrationV2DimensionDelta,
  type CalibrationV2MemberDelta,
  type CalibrationV2PerformanceDisagreement,
  type CalibrationV2ReportExtension,
  type BuildCalibrationReportV2ExtensionInput,
} from "./report-v2.js";

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
