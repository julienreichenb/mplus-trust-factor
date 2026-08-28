/**
 * Ability catalog release replay report types (Phase 3B.3).
 * Shadow / diagnostic only — not publication approval.
 */

export const ABILITY_CATALOG_REPLAY_ENGINE_VERSION =
  "ability-catalog-release-replay-v1" as const;

export const ABILITY_CATALOG_REPLAY_REPORT_SCHEMA =
  "ability-catalog-replay-report-v1" as const;

export type AbilityCatalogReplayFailureCode =
  | "INPUT_ARTIFACT_MISSING"
  | "INPUT_ARTIFACT_CORRUPT"
  | "UNSUPPORTED_INPUT_SCHEMA"
  | "BASE_RELEASE_LOAD_FAILED"
  | "CANDIDATE_RELEASE_LOAD_FAILED"
  | "UNKNOWN_CLASS_SPEC"
  | "SCORING_ERROR"
  | "RESOLUTION_ERROR"
  | "NON_DETERMINISTIC_RESULT";

export type AbilityCatalogReplayAssociation =
  | "DIRECTLY_ASSOCIATED"
  | "POSSIBLY_ASSOCIATED"
  | "UNATTRIBUTED";

export type AbilityResolutionChangeKind =
  | "UNCHANGED"
  | "BECAME_RECOGNIZED"
  | "BECAME_UNRECOGNIZED"
  | "CANONICAL_KEY_CHANGED"
  | "CATEGORY_CHANGED"
  | "DIMENSION_CHANGED"
  | "BINDING_CHANGED"
  | "COOLDOWN_CHANGED"
  | "AMBIGUOUS_BEFORE"
  | "AMBIGUOUS_AFTER"
  | "AMBIGUOUS_BOTH";

export type AbilityCatalogCorpusSpecCoverageStatus =
  | "AVAILABLE_NATIVE_V4"
  | "DERIVED_FROM_FROZEN_EVIDENCE"
  | "MISSING_CORPUS_EVIDENCE"
  | "UNSUPPORTED_SCHEMA";

export interface AbilityCatalogReplayCorpusSelectionMeta {
  maxPerSpec: number;
  maxTotal: number;
  extractorCompatVersion: string;
  availableCount: number;
  selectedCount: number;
  unsupportedSchemaCount: number;
  corruptCount: number;
  expectedSpecCount: number;
  nativeV4SpecCount: number;
  derivedSpecCount: number;
  missingSpecCount: number;
  corpusCoveragePass: boolean;
  coverage: {
    classes: { available: string[]; selected: string[]; missing: string[] };
    specs: {
      available: Array<{ classSlug: string; specSlug: string; role: string | null }>;
      selected: Array<{ classSlug: string; specSlug: string; role: string | null }>;
      missing: Array<{ classSlug: string; specSlug: string; role: string }>;
      expected: Array<{ classSlug: string; specSlug: string; role: string }>;
      nativeV4: string[];
      derived: string[];
    };
    perSpecStatus: Array<{
      classSlug: string;
      specSlug: string;
      role: string;
      status: AbilityCatalogCorpusSpecCoverageStatus;
    }>;
    roles: {
      available: string[];
      selected: string[];
      missing: string[];
      diversity: Array<{ role: string; distinctSpecs: number; specs: string[] }>;
    };
    racialEvidenceSelected: number;
    offensiveCooldownEvidenceSelected: number;
    defensiveCooldownEvidenceSelected: number;
    utilityInterruptEvidenceSelected: number;
    unknownSpellIdEvidenceSelected: number;
    sparseAbilityEvidenceSelected: number;
    aliasSpellIdEvidenceSelected: number;
  };
  note: string;
}

export interface AbilityCatalogReplayScorePair {
  performanceCooldownDiscipline: number | null;
  utility: number | null;
  survival: number | null;
  experience: "INVARIANT_UNAFFECTED";
  /**
   * Trust cannot be reconstructed from ParticipantScoringDigestV1 alone:
   * Trust Score needs character-level aggregate context (seasonal history /
   * multi-run confidence inputs) that is not frozen inside a single-run digest.
   * Classification: BLOCKS_PRODUCTION_ONLY — not required to pin a catalog
   * release in test environments (3B.4), but required before claiming full
   * production score-impact parity including Trust.
   */
  trust: "TRUST_REPLAY_UNAVAILABLE";
  boost: "INVARIANT_UNAFFECTED";
}

export interface AbilityResolutionDiffEntry {
  spellId: number;
  beforeStatus: string;
  afterStatus: string;
  beforeCanonicalKey: string | null;
  afterCanonicalKey: string | null;
  beforeCategory: string | null;
  afterCategory: string | null;
  changeKind: AbilityResolutionChangeKind;
  association: AbilityCatalogReplayAssociation;
  correlatedDiffCodes: string[];
}

export interface AbilityCatalogReplayAnalysisDetail {
  sourceDigestId: string;
  contentHash: string;
  classSlug: string | null;
  specSlug: string | null;
  role: string | null;
  reportCode: string;
  fightId: number;
  scoresBefore: AbilityCatalogReplayScorePair;
  scoresAfter: AbilityCatalogReplayScorePair;
  deltas: {
    performanceCooldownDiscipline: number | null;
    utility: number | null;
    survival: number | null;
  };
  resolutionDiffs: AbilityResolutionDiffEntry[];
  changed: boolean;
  failureCode: AbilityCatalogReplayFailureCode | null;
  failureDetail: string | null;
}

export interface AbilityCatalogReplayTiming {
  loadMs: number;
  baseReplayMs: number;
  candidateReplayMs: number;
  diffMs: number;
  totalMs: number;
  corpusAvailableCount: number;
  selectedCount: number;
}

export interface AbilityCatalogReplayReportSummary {
  artifactsSelected: number;
  artifactsReplayed: number;
  replayFailures: number;
  exactMatches: number;
  changedAnalyses: number;
  spellIdsEncountered: number;
  resolutionUnchanged: number;
  becameRecognized: number;
  becameUnrecognized: number;
  canonicalKeyChanged: number;
  ambiguousBeforeAfter: number;
  performanceChanged: number;
  survivalChanged: number;
  utilityChanged: number;
  experienceChanged: number;
  trustChanged: number;
  boostChanged: number;
  maxAbsUtilityDelta: number | null;
  medianUtilityDelta: number | null;
  maxAbsSurvivalDelta: number | null;
  medianSurvivalDelta: number | null;
  maxAbsPerformanceCdDelta: number | null;
  medianPerformanceCdDelta: number | null;
  affectedClassSpecs: string[];
  unresolvedFailures: number;
  trustReplayStatus: "TRUST_REPLAY_UNAVAILABLE";
  humanSummary: string;
  publicationNote: string;
}

export interface AbilityCatalogReplayReport {
  schemaVersion: typeof ABILITY_CATALOG_REPLAY_REPORT_SCHEMA;
  replayEngineVersion: typeof ABILITY_CATALOG_REPLAY_ENGINE_VERSION;
  base: {
    kind: "STATIC" | "RELEASE";
    releaseId: string | null;
    releaseKey: string | null;
    contentDigest: string | null;
    catalogVersion?: string;
  };
  candidate: {
    releaseId: string;
    releaseKey: string;
    contentDigest: string;
  };
  corpus: AbilityCatalogReplayCorpusSelectionMeta;
  corpusDigest: string;
  replayInputDigest: string;
  status: "PASSED" | "FAILED";
  summary: AbilityCatalogReplayReportSummary;
  timing: AbilityCatalogReplayTiming;
  /** Changed analyses + failures only (privacy: no PII beyond internal refs). */
  details: AbilityCatalogReplayAnalysisDetail[];
  failures: Array<{
    sourceDigestId: string | null;
    code: AbilityCatalogReplayFailureCode;
    detail: string;
  }>;
}
