export {
  BOOST_SHADOW_BACKTEST_REPORT_SCHEMA,
  BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA,
  PHASE2_FEATURE_KEYS,
} from "./types.js";
export type {
  Phase2FeatureKey,
  ResearchLabelClass,
  ResearchLabelV1,
  ProductionAuthenticityCompareV1,
  BoostShadowSplitName,
  BoostShadowSplitAssignmentV1,
  BoostShadowFeatureRowV1,
  BoostShadowBacktestAnalysisV1,
  BoostShadowBacktestReportV1,
  BoostShadowBacktestArtifacts,
  BoostShadowBacktestRunOptions,
  FeatureAvailabilitySummary,
  FeatureDistributionSummary,
  ConfusionMatrixV1,
  PrecisionRecallSummary,
  FixedTeamVersusStrongerSummary,
} from "./types.js";

export {
  BOOST_SHADOW_EXPERIMENT_PARAMS_VERSION,
  DEFAULT_BOOST_SHADOW_EXPERIMENT_PARAMS,
  mergeExperimentParams,
} from "./experiment-params.js";
export type { BoostShadowExperimentParamsV1 } from "./experiment-params.js";

export {
  BOOST_SHADOW_COHORT_MANIFEST_SCHEMA,
  validateBoostShadowCohortManifest,
  unlabeledResearchLabel,
} from "./manifest.js";
export type {
  BoostShadowCohortManifestV1,
  BoostShadowCohortMemberV1,
  BoostShadowOperatorInputV1,
  BoostShadowOperatorMemberRefV1,
  ManifestValidationResult,
} from "./manifest.js";

export {
  createMapEvidencePort,
  filterEvidenceAtCutoff,
  filterMemberEvidenceAsOf,
  filterProductionAuthenticityAsOf,
  mapPersistedCharacterSnapshotsToSeasonBound,
  emptyProductionAuthenticity,
  toExtractorInput,
  validateBoostShadowEvidenceBundle,
} from "./evidence.js";
export type {
  BoostShadowMemberEvidenceV1,
  BoostShadowEvidenceBundleV1,
  BoostShadowEvidencePort,
  EvidenceBundleValidationResult,
  SeasonTimeBounds,
} from "./evidence.js";

export {
  assignLeakageSafeSplits,
  assertNoCharacterLeakage,
  assertNoCohortLeakage,
  computeTeammateCohortFingerprint,
} from "./splits.js";

export {
  buildBacktestAnalysis,
  classifyPattern,
  experimentalUnusualPattern,
  isLabeledForSupervised,
  isPositiveLabel,
  spearman,
} from "./analyze.js";

export {
  runBoostShadowBacktest,
  runBoostShadowBacktestFromBundle,
} from "./evaluate.js";
export type { RunBoostShadowBacktestResult } from "./evaluate.js";

export {
  createMutationGuard,
  createReadOnlyPrismaProxy,
} from "./mutation-guard.js";
export type { MutationGuard, MutationGuardCounters } from "./mutation-guard.js";

export { anonymizeBacktestReport, assertNoIdentityLeakage } from "./anonymize.js";

export {
  buildBacktestArtifacts,
  reportToCsv,
  reportToJson,
  reportToMarkdown,
} from "./reports.js";

export {
  buildPhase2FixtureBundle,
  PHASE2_FIXTURE_GENERATED_AT,
} from "./fixture-cohort.js";
