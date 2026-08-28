/**
 * Shadow ability-catalog refresh contracts.
 * Candidates never write AbilityRule / RETAIL_ABILITY_CATALOG.
 */

import type { AbilityCategory } from "../types.js";

export type CatalogRefreshSourceKind = "BLIZZARD" | "SIMULATIONCRAFT";

export type AbilitySpellBindingRole =
  | "PRIMARY_ACTIVATION"
  | "CAST_ALIAS"
  | "ACTIVATION_AURA"
  | "STACK_AURA"
  | "TRIGGERED_EFFECT"
  | "SUMMON";

export type RefreshCertainty = "unverified" | "supported" | "conflicting" | "deprecated";

export type CatalogRelevance = "ACTIVE_CANDIDATE" | "PASSIVE_DISCOVERED" | "UNCLASSIFIED";

export type InventoryCompleteness = "COMPLETE" | "PARTIAL" | "UNKNOWN";
export type InventoryQueryClaim = "COMPLETE_FOR_QUERY" | "NONE";
export type InventoryScopeClassification =
  | "PLAYABLE_CLASS"
  | "PLAYABLE_SPEC"
  | "PLAYABLE_RACE"
  | "PET_TALENT_TREE"
  | "PSEUDO_SPEC"
  | "SPELL_IDENTITY";

/** Distinguishes demo/golden data from an operator-pinned source dump. */
export type SnapshotDatasetKind = "FIXTURE" | "PINNED";
export type SnapshotCaptureProvenance = "SYNTHETIC_CONTRACT" | "REAL_CAPTURE";

export type SourceObservationState =
  | "PRESENT"
  | "ABSENT_FROM_SCOPED_INVENTORY"
  | "IDENTITY_ONLY"
  | "NOT_OBSERVED"
  | "NOT_OBSERVED_IN_CURRENT_SOURCE_QUERY";

export type CatalogDiffStatus =
  | "UNCHANGED"
  | "MISSING_FROM_CURRENT_CATALOG"
  | "MISSING_FROM_EXTERNAL_SOURCES"
  | "NOT_OBSERVED_IN_CURRENT_QUERIES"
  | "REMOVAL_REVIEW_CANDIDATE"
  | "METADATA_CHANGED"
  | "APPLICABILITY_CHANGED"
  | "SPELL_BINDING_CHANGED"
  | "AMBIGUOUS"
  | "SOURCE_CONFLICT";

export type CatalogEligibilityState =
  | "STRONG_REVIEW_CANDIDATE"
  | "WEAK_REVIEW_CANDIDATE"
  | "EXCLUDED_STRUCTURALLY"
  | "UNCLASSIFIED";

export type CatalogEligibilityReason =
  | "ACTIVE"
  | "PASSIVE"
  | "HAS_COOLDOWN"
  | "HAS_CHARGES"
  | "PLAYABLE_CLASS_OWNED"
  | "PLAYABLE_SPEC_OWNED"
  | "RACIAL_ACTIVE"
  | "PET_OWNED"
  | "PSEUDO_SPEC"
  | "MATCHED_CURRENT_RULE"
  | "NO_PLAYABLE_OWNERSHIP";

export type SourceSnapshotDiffStatus =
  | "ADDED"
  | "REMOVED"
  | "METADATA_CHANGED"
  | "APPLICABILITY_CHANGED"
  | "EFFECT_CHANGED"
  | "UNCHANGED"
  | "NOT_COMPARABLE";

export interface ExternalSourceSnapshotIdentity {
  source: CatalogRefreshSourceKind;
  datasetKind: SnapshotDatasetKind;
  /** Immutable version pin (build, dump schema, extractor version). Never "latest". */
  sourceVersion: string;
  /** Immutable revision: Blizzard build/content hash or SimC git SHA/prefix. */
  sourceRevision: string;
  retrievedAt: string;
  validFromBuild?: string;
  validToBuild?: string;
  seasonSlug?: string;
  blizzardNamespace?: string;
  blizzardLocale?: string;
  captureProvenance?: SnapshotCaptureProvenance;
  /** SimC binary self-report (optional; present on new Live captures). */
  applicationVersion?: string | null;
  dataMode?: "LIVE" | "PTR" | "UNKNOWN" | null;
  revisionPrecision?: "FULL_SHA" | "PREFIX" | "UNKNOWN" | null;
  binaryReportedRevision?: string | null;
  resolvedFullRevision?: string | null;
}

export interface BlizzardSnapshotMetadata {
  namespace: string;
  locale: string;
  region?: string;
  gameVersion?: string;
  wowBuild?: string;
}

export interface SimulationCraftSnapshotMetadata {
  gitCommitSha: string;
  branch?: string;
  extractorVersion: string;
  applicationVersion?: string | null;
  wowBuild?: string | null;
  gitRevision?: string | null;
  dataMode?: "LIVE" | "PTR" | "UNKNOWN";
  executablePath?: string;
  /** Exact binary-reported revision (may be a short prefix). */
  binaryReportedRevision?: string | null;
  /** Full 40-char SHA when proven. */
  resolvedFullRevision?: string | null;
  revisionPrecision?: "FULL_SHA" | "PREFIX" | "UNKNOWN";
}

export interface ScopedInventory {
  kind: "CLASS" | "SPEC" | "RACE" | "SPELL_IDENTITY";
  classSlug?: string | null;
  specSlug?: string | null;
  raceSlug?: string | null;
  completeness: InventoryCompleteness;
  queryClaim?: InventoryQueryClaim;
  /** True only when the source claims a closed catalog-relevant toolkit for this scope. SpellQuery never does. */
  claimsCompleteToolkit: boolean;
  scopeClassification?: InventoryScopeClassification;
  queryExpression?: string;
}

export interface ExternalSourceSnapshot {
  identity: ExternalSourceSnapshotIdentity;
  blizzard?: BlizzardSnapshotMetadata;
  simulationCraft?: SimulationCraftSnapshotMetadata;
  inventories: ScopedInventory[];
  records: ExternalSourceRecord[];
}

export interface ExternalSourceRecord {
  spellId: number;
  name: string;
  classSlug?: string | null;
  specSlugs?: string[];
  raceSlugs?: string[];
  cooldownSeconds?: number | null;
  charges?: number | null;
  stacks?: number | null;
  isPassive?: boolean | null;
  catalogRelevant?: boolean;
  bindings?: AbilitySpellBindingCandidate[];
  proposedCanonicalKey?: string;
  notes?: string[];
  extra?: Record<string, unknown>;
}

export interface AbilitySpellBindingCandidate {
  spellId: number;
  role: AbilitySpellBindingRole;
  source: CatalogRefreshSourceKind;
  certainty: RefreshCertainty;
  evidence?: string;
}

export interface SourceObservation {
  source: CatalogRefreshSourceKind;
  state: SourceObservationState;
  identity: ExternalSourceSnapshotIdentity;
  notes?: string[];
}

export interface ExternalAbilityCandidate {
  candidateKey: string;
  name: string;
  primarySpellId: number;
  classSlug: string | null;
  specSlugs: string[];
  raceSlugs: string[];
  cooldownSeconds?: number | null;
  charges?: number | null;
  stacks?: number | null;
  isPassive?: boolean | null;
  catalogRelevance: CatalogRelevance;
  category?: AbilityCategory | "UNKNOWN";
  bindings: AbilitySpellBindingCandidate[];
  sourceObservations: SourceObservation[];
  certainty: RefreshCertainty;
  validFromBuild?: string;
  validToBuild?: string;
  notes: string[];
  eligibilityState: CatalogEligibilityState;
  eligibilityReasons: CatalogEligibilityReason[];
  ownershipKind: InventoryScopeClassification | "PLAYABLE_PLAYER";
}

export interface CatalogRefreshCandidate {
  candidate: ExternalAbilityCandidate;
}

export interface CatalogDiffEntry {
  status: CatalogDiffStatus;
  candidateKey?: string;
  currentCanonicalKey?: string;
  name: string;
  primarySpellId?: number;
  classSlug: string | null;
  specSlugs: string[];
  raceSlugs: string[];
  sourceObservations: SourceObservation[];
  /** Normalized candidate metadata preserved for review draft prefill. */
  cooldownSeconds?: number | null;
  charges?: number | null;
  isPassive?: boolean | null;
  ownershipKind?: InventoryScopeClassification | "PLAYABLE_PLAYER";
  validFromBuild?: string;
  validToBuild?: string;
  candidateBindings?: Array<{ spellId: number; role: AbilitySpellBindingRole }>;
  bindingChanges?: Array<{
    spellId: number;
    currentRoles: AbilitySpellBindingRole[];
    candidateRoles: AbilitySpellBindingRole[];
  }>;
  metadataChanges?: string[];
  applicabilityChanges?: string[];
  ambiguousCurrentKeys?: string[];
  ambiguousCandidateKeys?: string[];
  notes: string[];
}

export interface RefreshValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  candidateKey?: string;
  spellId?: number;
}

export interface CatalogRefreshValidationReport {
  valid: boolean;
  errors: RefreshValidationIssue[];
  warnings: RefreshValidationIssue[];
}

export interface InventoryScopeRow {
  source: CatalogRefreshSourceKind;
  datasetKind: SnapshotDatasetKind;
  kind: ScopedInventory["kind"];
  classSlug?: string | null;
  specSlug?: string | null;
  raceSlug?: string | null;
  completeness: InventoryCompleteness;
  claimsCompleteToolkit: boolean;
  queryClaim?: InventoryQueryClaim;
  scopeClassification?: InventoryScopeClassification;
}

export interface CatalogRefreshCoverageReport {
  datasetKind: SnapshotDatasetKind | "MIXED";
  classesDiscovered: string[];
  specsDiscovered: string[];
  racesDiscovered: string[];
  candidateAbilities: number;
  candidateActiveAbilities: number;
  candidatePassiveAbilities: number;
  candidateUnknownAbilities: number;
  racialCandidates: number;
  candidatesByClass: Record<string, number>;
  candidatesBySpec: Record<string, number>;
  candidatesByCategory: Record<string, number>;
  currentCatalogEntries: number;
  missingFromCurrentCatalog: number;
  missingFromExternalSources: number;
  changedBindings: number;
  ambiguities: number;
  sourceConflicts: number;
  claimedCompleteInventories: number;
  partialOrUnknownInventories: number;
  inventoryScopes: InventoryScopeRow[];
  topology: RetailTopologyDiff;
}

export interface RetailTopologyDiff {
  matrixClassCount: number;
  matrixSpecCount: number;
  snapshotClassCount: number;
  snapshotSpecCount: number;
  addedClasses: string[];
  removedClasses: string[];
  addedSpecs: string[];
  removedSpecs: string[];
  nonRetailRejected: string[];
}

export interface CatalogRefreshReport {
  schemaVersion: "ability-catalog-refresh-shadow-v1";
  generatedAt: string;
  publication: "NONE";
  datasetKind: SnapshotDatasetKind | "MIXED";
  snapshots: ExternalSourceSnapshotIdentity[];
  validation: CatalogRefreshValidationReport;
  coverage: CatalogRefreshCoverageReport;
  diff: CatalogDiffEntry[];
  diffTotals: Record<CatalogDiffStatus, number>;
  quality: {
    incompleteScopes: number;
    failedSources: string[];
    unknownClassifications: number;
  };
  review?: CatalogReviewQueues;
  sourceSnapshotDiff?: SourceSnapshotDiffReport;
  racialVariantCollapse?: {
    rawRacialCandidates: number;
    conceptualGroups: number;
    historicalVariantsExcluded: number;
    currentSingleIdGroups: number;
    currentMultiIdGroups: number;
    ambiguousGroups: number;
  };
}

export interface CatalogReviewQueues {
  strongNewCandidates: CatalogDiffEntry[];
  weakDiscoveries: CatalogDiffEntry[];
  excludedStructurally: CatalogDiffEntry[];
  currentRulesNotObserved: CatalogDiffEntry[];
  removalReview: CatalogDiffEntry[];
  bindingReview: CatalogDiffEntry[];
}

export interface SourceSnapshotDiffEntry {
  status: SourceSnapshotDiffStatus;
  spellId: number;
  name: string;
  notes: string[];
}

export interface SourceSnapshotDiffReport {
  comparable: boolean;
  previousRevision: string | null;
  currentRevision: string | null;
  entries: SourceSnapshotDiffEntry[];
  totals: Record<SourceSnapshotDiffStatus, number>;
}

export interface CurrentRulePositiveEvidence {
  canonicalKey: string;
  identityObserved: boolean;
  classApplicabilityObserved: boolean;
  specApplicabilityObserved: boolean;
  cooldownObserved: boolean;
  bindingObserved: boolean;
  activeObserved: boolean;
  notObservedInCurrentQueries: boolean;
}

/** Future WCL observational evidence — not collected in this phase. */
export interface ObservationalEvidenceContract {
  source: "WCL";
  status: "NOT_COLLECTED";
}
