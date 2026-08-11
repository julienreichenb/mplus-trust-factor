export {
  PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
  PERFORMANCE_ROLE_AWARE_MODEL_LABEL,
  PARSE_CHANNEL_WEIGHTS,
  DPS_PERFORMANCE_WEIGHTS,
  HEALER_PERFORMANCE_WEIGHTS,
  PERFORMANCE_SPEC_BINDING_POLICY,
} from "./constants.js";
export {
  computeEqualDungeonPercentileAverages,
  countParseChannelCells,
  computeParseChannelScore,
} from "./parse-channel.js";
export {
  computeRoleAwarePerformance,
  computeRoleAwarePerformanceInputFingerprint,
} from "./compute.js";
export { throughputChannelsFromPersistedV2 } from "./from-aggregate.js";
export {
  extractPersistedRoleAwarePerformanceEvidence,
  buildRoleAwarePerformanceSummary,
  projectPerformanceSummaryFromDimensionDetails,
  mergePublishedSelectedRunsIntoPerformanceSummary,
} from "./public-summary.js";
export type {
  PersistedRoleAwarePerformanceEvidence,
  PersistedParseChannelEvidence,
} from "./public-summary.js";
export type {
  PerformanceThroughputChannelKind,
  PerformanceDungeonThroughputFact,
  PerformanceThroughputChannelFact,
  ParseChannelScoreResult,
  RoleAwarePerformanceWeightsApplied,
  RoleAwarePerformanceComputeInput,
  RoleAwarePerformanceComputeResult,
} from "./types.js";
