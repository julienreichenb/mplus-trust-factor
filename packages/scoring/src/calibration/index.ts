export {
  CALIBRATION_REPORT_SCHEMA_VERSION,
  COHORT_MANIFEST_SCHEMA_VERSION,
} from "./types.js";
export type {
  CalibrationBacktestMode,
  QualitativeLabel,
  CohortMemberSource,
  CalibrationRole,
  PublicBoostFlag,
  UtilityCostSummary,
  CoverageRefreshState,
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
  createFixtureEvidencePort,
} from "./fixture-cohort.js";
