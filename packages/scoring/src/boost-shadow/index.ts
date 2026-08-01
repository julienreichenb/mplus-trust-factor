export {
  BOOST_FEATURE_SCHEMA_VERSION,
  BOOST_EXTRACTOR_VERSION,
  HIGH_KEY_POLICY_VERSION,
  MIN_USABLE_HIGH_KEY_RUNS,
  SCORE_GAP_ONSET,
  STRONG_TEAMMATE_GAP_ONSET,
  VERIFIED_ALT_FRESHNESS_DAYS,
} from "./constants.js";

export type {
  BoostFeatureEvidenceV1,
  BoostFeatureFactsV1,
  BoostFeatureKeyV1,
  BoostFeatureMissingV1,
  BoostFeatureDiagnosticsV1,
  BoostFeatureExtractorInput,
  BoostShadowRunInput,
  BoostShadowRunParticipantInput,
  BoostShadowRatingSnapshotInput,
  VerifiedOwnershipEvidenceInput,
  BoostShadowIsolationGuarantees,
  CanonicalTeammateIdentity,
  FeatureComputeResult,
  OwnershipStatusInput,
  OwnershipConfidenceInput,
} from "./types.js";

export { resolveCanonicalTeammateIdentity, isUsableTeammateIdentity } from "./identity.js";
export { selectHighKeySet, type HighKeySetResult } from "./high-key-policy.js";
export {
  resolveTimeAlignedRating,
  buildAlignedRunGaps,
  type AlignedRunGap,
} from "./time-aligned.js";
export { computeProgressionVelocity } from "./progression-velocity.js";
export { computeTeammateScoreGap } from "./teammate-score-gap.js";
export { computeRepeatedStrongerTeammateCohort } from "./repeated-stronger-cohort.js";
export { computeHighKeyGroupConcentration } from "./high-key-group-concentration.js";
export {
  computeVerifiedAltExperienceMitigation,
  isEligibleVerifiedSubjectAtT,
  isEligibleVerifiedAltAtT,
} from "./verified-alt-mitigation.js";
export { extractBoostFeatureFactsV1, BOOST_SHADOW_ISOLATION } from "./extract.js";
export {
  assertShadowOnlyFacts,
  isOmittedNotZero,
} from "./isolation.js";
export {
  buildOfflineEvaluation,
  type BoostShadowOfflineEvaluationV1,
} from "./offline-eval.js";
export {
  fixtureRapidProgression,
  fixtureEstablishedFarmer,
  fixtureStrongerCohort,
  fixtureStableTeam,
  fixtureMissingSubjectAlignedRating,
  fixtureRejectFutureSnapshot,
  fixtureVerifiedAltMitigation,
  fixturePostHocOwnership,
  FIXTURE_IDS,
} from "./fixtures.js";

/** Phase 2 offline / backtest harness (shadow-only). */
export {
  BOOST_SHADOW_BACKTEST_REPORT_SCHEMA,
  BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA,
  BOOST_SHADOW_COHORT_MANIFEST_SCHEMA,
  BOOST_SHADOW_EXPERIMENT_PARAMS_VERSION,
  PHASE2_FEATURE_KEYS,
  DEFAULT_BOOST_SHADOW_EXPERIMENT_PARAMS,
  mergeExperimentParams,
  validateBoostShadowCohortManifest,
  unlabeledResearchLabel,
  createMapEvidencePort,
  filterEvidenceAtCutoff,
  filterMemberEvidenceAsOf,
  filterProductionAuthenticityAsOf,
  mapPersistedCharacterSnapshotsToSeasonBound,
  emptyProductionAuthenticity,
  toExtractorInput,
  validateBoostShadowEvidenceBundle,
  assignLeakageSafeSplits,
  assertNoCharacterLeakage,
  assertNoCohortLeakage,
  computeTeammateCohortFingerprint,
  buildBacktestAnalysis,
  classifyPattern,
  experimentalUnusualPattern,
  isLabeledForSupervised,
  runBoostShadowBacktest,
  runBoostShadowBacktestFromBundle,
  createMutationGuard,
  createReadOnlyPrismaProxy,
  anonymizeBacktestReport,
  assertNoIdentityLeakage,
  buildBacktestArtifacts,
  reportToCsv,
  reportToJson,
  reportToMarkdown,
  buildPhase2FixtureBundle,
  PHASE2_FIXTURE_GENERATED_AT,
} from "./backtest/index.js";
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
  BoostShadowExperimentParamsV1,
  BoostShadowCohortManifestV1,
  BoostShadowCohortMemberV1,
  BoostShadowOperatorInputV1,
  BoostShadowMemberEvidenceV1,
  BoostShadowEvidenceBundleV1,
  BoostShadowEvidencePort,
  MutationGuard,
  RunBoostShadowBacktestResult,
} from "./backtest/index.js";
