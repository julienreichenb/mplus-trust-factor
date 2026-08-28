export type {
  AbilityCatalogReleaseArtifact,
  AbilityCatalogReleaseContent,
  AbilityCatalogReleaseManifest,
  AbilityCatalogReleaseSchemaVersion,
  ArtifactValidationIssue,
  ArtifactValidationReport,
  CompiledCatalogChange,
  CompileAbilityCatalogReleaseInput,
  ReleaseCurationEntry,
  ReleaseRaceTopology,
  ReleaseTopology,
} from "./types.js";

export {
  ABILITY_CATALOG_RELEASE_SCHEMA_V1,
  BOOTSTRAP_MANIFEST_ORIGIN,
  BOOTSTRAP_WOW_BUILD,
  SUPPORTED_ABILITY_CATALOG_RELEASE_SCHEMAS,
} from "./types.js";

export { stableSha256, stableStringify, sha256Utf8 } from "./canonicalize.js";

export {
  buildReleaseContent,
  buildReleaseKey,
  compareAscii,
  contentDigestOf,
  normalizeAbilityRuleForContent,
  normalizeRulesForContent,
  normalizeTopologyForContent,
  topologyDigestOf,
} from "./normalize.js";

export {
  applyCompiledCatalogChanges,
  compileAbilityCatalogRelease,
  rulesFromReleaseArtifact,
  topologyFromReleaseArtifact,
} from "./compile.js";

export {
  currentStaticReleaseTopology,
  topologyCounts,
} from "./topology.js";

export {
  parseAndValidateReleaseArtifact,
  validateAbilityCatalogReleaseArtifact,
} from "./validate-artifact.js";

export {
  allResolvableSpellIdsFromRules,
  filterArtifactRulesForLookup,
  getAbilityCatalogFromArtifact,
  resolveAbilityCatalogFromArtifact,
  resolveAbilityRuleBySpellIdFromArtifact,
} from "./shadow-catalog.js";

export {
  createReleaseAbilityCatalogContext,
  topologyViewFromReleaseArtifact,
  activeRulesFromReleaseArtifact,
} from "./release-catalog-context.js";

export {
  compareStaticCatalogToReleaseArtifact,
  formatParityReportHuman,
  type AbilityCatalogParityReport,
  type ParityVerdict,
} from "./parity.js";

export {
  compileBootstrapRelease0,
  formatBootstrapSummary,
  type BootstrapRelease0Result,
} from "./bootstrap.js";

export {
  serializeSemanticReleaseContentBytes,
  artifactFromSemanticContentBytes,
  casHashOfSemanticBytes,
  semanticContentFromArtifact,
} from "./serialize-cas.js";

export {
  diffReleaseArtifacts,
  topologyEqual,
  type ReleaseDiffCode,
  type ReleaseDiffDocument,
  type ReleaseDiffEntry,
} from "./diff.js";
