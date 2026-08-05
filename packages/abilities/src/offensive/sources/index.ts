export type {
  OffensiveCandidateProposal,
  OffensiveSourceAdapter,
  OffensiveSourceAdapterMeta,
  OffensiveSourceKind,
  OffensiveSourceSnapshot,
} from "./types.js";
export { provenanceSourceForKind } from "./types.js";
export { blizzardGameDataAdapter, loadAuthoritativeBlizzardPlayableMatrix } from "./blizzard-adapter.js";
export type { BlizzardPlayableSpecRow } from "./blizzard-adapter.js";
export { existingCatalogAdapter } from "./existing-catalog-adapter.js";
export {
  createWclObservedAdapter,
  wclObservedAdapter,
  type WclUnmatchedAbilityRow,
} from "./wcl-adapter.js";
export { simcAdvisoryAdapter, SIMC_ADAPTER_DOCUMENTED_AT } from "./simc-adapter.js";
