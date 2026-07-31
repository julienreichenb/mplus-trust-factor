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
