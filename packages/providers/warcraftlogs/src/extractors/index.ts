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
  type BuildOffensiveProbeReportInput,
} from "./offensive/activations.js";
export type {
  OffensiveProbeParticipantActivation,
  OffensiveProbeParticipantReport,
  OffensiveProbeFightSelection,
  OffensiveSourceKind,
} from "./offensive/types.js";

export {
  extractUtilityActionTimeline,
  UTILITY_ACTION_MERGE_WINDOW_MS,
  type ExtractUtilityActionsInput,
  type ExtractUtilityActionsResult,
} from "./utility/extract-actions.js";
export {
  evaluateUtilityCapabilities,
  isUtilityCatalogRule,
  mapAbilityCategoryToUtilityCategory,
  spellIdsForRule as utilitySpellIdsForRule,
  type UtilityProbeParticipant,
  type UtilityProbeSourceIdentity,
  type UtilityDatasetCoverageRow,
} from "./utility/types.js";

export {
  extractSurvivalFromCapabilityPackage,
  SURVIVAL_ACTION_MERGE_WINDOW_MS,
  type ExtractSurvivalFromCapabilityInput,
  type ExtractSurvivalFromCapabilityResult,
} from "./survival/extract.js";
export {
  evaluateSurvivalCapabilities,
  isSurvivalCatalogRule,
  mapAbilityCategoryToSurvivalDefensive,
  survivalActivationKindForCategory,
  type SurvivalProbeParticipant,
  type SurvivalProbeSourceIdentity,
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
