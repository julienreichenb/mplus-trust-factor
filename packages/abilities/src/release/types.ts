import type { AbilityRule, RetailClassDefinition } from "../types.js";

/** Artifact schema id (full string). Major for releaseKey is derived as `1`. */
export const ABILITY_CATALOG_RELEASE_SCHEMA_V1 = "ability-catalog-release-v1" as const;

export const SUPPORTED_ABILITY_CATALOG_RELEASE_SCHEMAS = [ABILITY_CATALOG_RELEASE_SCHEMA_V1] as const;

export type AbilityCatalogReleaseSchemaVersion =
  (typeof SUPPORTED_ABILITY_CATALOG_RELEASE_SCHEMAS)[number];

/**
 * Bootstrap Release 0 has no trustworthy exact historical WoW build beyond static
 * catalog metadata — do not fabricate a numeric build.
 */
export const BOOTSTRAP_WOW_BUILD = "unknown-static" as const;

export const BOOTSTRAP_MANIFEST_ORIGIN = "BOOTSTRAP_STATIC_CATALOG" as const;

export interface ReleaseRaceTopology {
  slug: string;
  /** Blizzard playable-race IDs that map to this slug (sorted ascending). */
  blizzardRaceIds: number[];
}

/** Immutable topology embedded in every compiled release. */
export interface ReleaseTopology {
  classes: RetailClassDefinition[];
  races: ReleaseRaceTopology[];
}

/** Traceability for one explicit curated change included in a release. */
export interface ReleaseCurationEntry {
  operation: "ADD_RULE" | "UPDATE_RULE" | "TOMBSTONE_RULE" | "UPDATE_TOPOLOGY";
  canonicalKey?: string;
  reviewBatchId?: string;
  reviewItemId?: string;
  draftRuleId?: string;
  draftTopologyId?: string;
  decisionEventId?: string;
  draftVersion?: number;
  actorUserId?: string | null;
  sourceReportDigest?: string | null;
  sourceBaselineIds?: string[];
}

export interface AbilityCatalogReleaseManifest {
  origin: typeof BOOTSTRAP_MANIFEST_ORIGIN | "CURATED_RELEASE";
  /** Legacy static pin when origin is BOOTSTRAP_STATIC_CATALOG. */
  staticCatalogVersionId?: string;
  sourceSnapshot?: string | null;
  /** Explicit curated change / review item IDs; empty for Bootstrap 0. */
  curatedChangeIds: string[];
  /** Structured curation traceability (release-level; not embedded in AbilityRule). */
  curationEntries?: ReleaseCurationEntry[];
  notes?: string;
}

/**
 * Content-bearing payload for contentDigest.
 * Excludes: generatedAt, contentDigest, topologyDigest, releaseKey, DB ids, paths.
 */
export interface AbilityCatalogReleaseContent {
  schemaVersion: AbilityCatalogReleaseSchemaVersion;
  gameVersion: string;
  wowBuild: string;
  seasonSlug: string;
  previousReleaseId: string | null;
  topology: ReleaseTopology;
  rules: AbilityRule[];
  manifest: AbilityCatalogReleaseManifest;
}

/** Full release artifact envelope (volatile metadata allowed outside digest). */
export interface AbilityCatalogReleaseArtifact {
  schemaVersion: AbilityCatalogReleaseSchemaVersion;
  releaseKey: string;
  contentDigest: string;
  topologyDigest: string;
  gameVersion: string;
  wowBuild: string;
  seasonSlug: string;
  previousReleaseId: string | null;
  /** Operational timestamp — must NOT affect contentDigest. */
  generatedAt: string;
  topology: ReleaseTopology;
  rules: AbilityRule[];
  manifest: AbilityCatalogReleaseManifest;
}

/**
 * Explicit curated operations for future Phase 3B.2+.
 * Bootstrap 0 applies an empty list.
 */
export type CompiledCatalogChange =
  | { op: "ADD_RULE"; rule: AbilityRule }
  | { op: "UPDATE_RULE"; canonicalKey: string; rule: AbilityRule }
  | {
      op: "TOMBSTONE_RULE";
      canonicalKey: string;
      /** Build where removal becomes effective (AbilityRule.validToBuild). */
      validToBuild: string;
    }
  | { op: "UPDATE_TOPOLOGY"; topology: ReleaseTopology };

export interface CompileAbilityCatalogReleaseInput {
  baseRules: readonly AbilityRule[];
  baseTopology: ReleaseTopology;
  changes?: readonly CompiledCatalogChange[];
  gameVersion: string;
  wowBuild: string;
  seasonSlug: string;
  previousReleaseId?: string | null;
  manifest: AbilityCatalogReleaseManifest;
  /** Volatile; defaults to current ISO time. */
  generatedAt?: string;
}

export interface ArtifactValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  canonicalKey?: string;
}

export interface ArtifactValidationReport {
  valid: boolean;
  errors: ArtifactValidationIssue[];
  warnings: ArtifactValidationIssue[];
}
