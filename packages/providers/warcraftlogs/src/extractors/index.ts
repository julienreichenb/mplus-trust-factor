/**
 * Canonical scoring evidence extractors (Offensive / Utility / Survival).
 * Scoring calculators must consume these timelines — never raw WCL event pages.
 */
export {
  participantsFromBundleMasterData,
  type MasterDataParticipant,
} from "./participants/from-master-data.js";
export {
  resolveFightParticipants,
  type DigestParticipantLike,
  type ResolvedFightParticipant,
} from "./participants/resolve.js";

export {
  buildOffensiveParticipantActivationReports,
  buildOffensiveProbeReport,
  printOffensiveProbeSummary,
  type BuildOffensiveProbeReportInput,
} from "./offensive/activations.js";
export type {
  OffensiveProbeParticipantActivation,
  OffensiveProbeParticipantReport,
  OffensiveProbeFightSelection,
  OffensiveProbeDataLoad,
  OffensiveProbeReport,
  OffensiveProbePersistenceDataset,
  OffensiveProbePersistenceSection,
  OffensiveSourceKind,
} from "./offensive/types.js";
export { OFFENSIVE_ONE_FIGHT_DATASETS } from "./offensive/types.js";

export {
  extractUtilityActionTimeline,
  buildUtilityProbePrintSummary,
  UTILITY_ACTION_MERGE_WINDOW_MS,
  type ExtractUtilityActionsInput,
  type ExtractUtilityActionsResult,
} from "./utility/extract-actions.js";
export {
  evaluateUtilityCapabilities,
  isUtilityCatalogRule,
  mapAbilityCategoryToUtilityCategory,
  spellIdsForRule as utilitySpellIdsForRule,
  UTILITY_PROBE_REQUIRED_DATASETS,
  UTILITY_PROBE_DATASETS,
  type UtilityProbeParticipant,
  type UtilityProbeSourceIdentity,
  type UtilityDatasetCoverageRow,
  type UtilityOneFightProbeReport,
  type UtilityOneFightDataset,
} from "./utility/types.js";

export {
  extractSurvivalFromCapabilityPackage,
  buildSurvivalProbePrintSummary,
  SURVIVAL_ACTION_MERGE_WINDOW_MS,
  type ExtractSurvivalFromCapabilityInput,
  type ExtractSurvivalFromCapabilityResult,
} from "./survival/extract.js";
export {
  evaluateSurvivalCapabilities,
  isSurvivalCatalogRule,
  mapAbilityCategoryToSurvivalDefensive,
  survivalActivationKindForCategory,
  sharedPackageParticipantProof,
  type SurvivalProbeParticipant,
  type SurvivalProbeSourceIdentity,
  type SurvivalOneFightProbeReport,
} from "./survival/types.js";
export {
  SURVIVAL_ONE_FIGHT_PRESSURE_CONFIG,
  type SurvivalOneFightPressureConfig,
} from "./survival/pressure-config.js";
export {
  buildPressureWindows,
  collectDamageTakenPoints,
  deriveRawPressureSegments,
  type DamageTakenPoint,
} from "./survival/pressure-windows.js";
export {
  rebuildCapabilityPackageFromPersistedEvents,
  type PersistedDatasetBundle,
} from "./survival/rebuild-capability-package.js";
export {
  buildParticipantScoringDigestsFromPackage,
  type BuildParticipantDigestsFromPackageInput,
  type RankingParseFactInput,
} from "./digest/build-participant-scoring-digest.js";
