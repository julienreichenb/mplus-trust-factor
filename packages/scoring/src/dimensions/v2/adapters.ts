/**
 * Provider-free adapters: validate persisted facts / history for Scoring V2
 * dimension finalization. Does not extract WCL events or call providers.
 */

import { createHash } from "node:crypto";
import type { CharacterSeasonEvidenceManifestV2 } from "@mplus/contracts";
import {
  PERFORMANCE_V2_ALGORITHM_VERSION,
  createManualDifficultyPolicyV2,
  parsePerformanceRunParseFactV2,
  type PerformanceRunParseFactV2,
  type PerformanceV2ComputeInput,
  type SeasonDifficultyPolicyV2,
} from "../../performance/v2/index.js";
import {
  EXPERIENCE_V3_ALGORITHM_VERSION,
  type ExperienceV3ComputeInput,
  type ExperienceV3CurrentExposureFact,
  type ExperienceV3EliteHistoryFact,
  type ExperienceV3HistoricalRankFact,
  type ExperienceV3PreviousSeasonFact,
  type HistoricalRankPolicyV3,
  type PreviousSeasonNormalizationPolicyV3,
} from "../../experience/v3/index.js";
import {
  SURVIVAL_V2_ALGORITHM_VERSION,
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  parseSurvivalFactDocumentV2,
  type SurvivalFactDocumentV2,
  type SurvivalV2ComputeInput,
  type SurvivalV2RelativeDamageMode,
} from "../../survival/v2/index.js";
import {
  UTILITY_V2_ALGORITHM_VERSION,
  UTILITY_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_SCHEMA_VERSION,
  type UtilityV2ComputeInput,
  type UtilityV2FrozenManifestRef,
  type UtilityV2RunFactSet,
} from "../../utility/v2/index.js";
import type { ScoringPublicDimension } from "./shadow-record.js";
import { buildSlotFactSetBindingHash } from "./fact-set-binding-hash.js";

export interface PersistedFactSetRef {
  extractorFamily: string;
  extractorVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  facts: unknown;
  limitations?: unknown;
  manifestSlotId?: string;
  reportCode?: string | null;
  fightId?: number | null;
  reportRevision?: number | null;
  dungeonSlug?: string | null;
  slotIndex?: number | null;
}

export interface FrozenSlotIdentityIssue {
  slotId: string;
  code:
    | "MISSING_IDENTITY"
    | "MISSING_REPORT_CODE"
    | "MISSING_FIGHT_ID"
    | "MISSING_REPORT_REVISION"
    | "DUPLICATE_FROZEN_IDENTITY";
  message: string;
}

export interface FactReadinessResult {
  ready: boolean;
  limitations: string[];
  failureReasons: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Detect acquisition shadow_placeholder fact documents (not calculator-ready). */
export function isShadowPlaceholderFact(facts: unknown): boolean {
  if (!isRecord(facts)) return false;
  return facts.kind === "shadow_placeholder";
}

export function limitationsFromFact(facts: unknown, limitations?: unknown): string[] {
  const out: string[] = [];
  if (isShadowPlaceholderFact(facts)) out.push("shadow_placeholder");
  if (Array.isArray(limitations)) {
    for (const item of limitations) {
      if (typeof item === "string" && item.length > 0) out.push(item);
    }
  }
  if (isRecord(facts) && Array.isArray(facts.limitations)) {
    for (const item of facts.limitations) {
      if (typeof item === "string" && item.length > 0) out.push(item);
    }
  }
  return [...new Set(out)];
}

/**
 * Validate selected slots carry frozen identity: reportCode + fightId + reportRevision.
 * Also detects duplicate frozen identities within the manifest.
 */
export function validateFrozenManifestIdentities(
  manifest: CharacterSeasonEvidenceManifestV2,
): FrozenSlotIdentityIssue[] {
  const issues: FrozenSlotIdentityIssue[] = [];
  const seen = new Map<string, string>();

  for (const slot of manifest.slots) {
    if (slot.state !== "SELECTED") continue;
    const slotId = `${slot.dungeonSlug}:${slot.slotIndex}`;
    if (slot.identity == null) {
      issues.push({
        slotId,
        code: "MISSING_IDENTITY",
        message: `selected slot ${slotId} missing frozen identity`,
      });
      continue;
    }
    const { reportCode, fightId, reportRevision } = slot.identity;
    if (!reportCode) {
      issues.push({
        slotId,
        code: "MISSING_REPORT_CODE",
        message: `selected slot ${slotId} missing reportCode`,
      });
    }
    if (fightId == null || !Number.isFinite(fightId)) {
      issues.push({
        slotId,
        code: "MISSING_FIGHT_ID",
        message: `selected slot ${slotId} missing fightId`,
      });
    }
    if (reportRevision == null || !Number.isFinite(reportRevision)) {
      issues.push({
        slotId,
        code: "MISSING_REPORT_REVISION",
        message: `selected slot ${slotId} missing reportRevision`,
      });
    }
    if (reportCode && fightId != null && reportRevision != null) {
      const key = `${reportCode}:${fightId}:${reportRevision}`;
      const prior = seen.get(key);
      if (prior) {
        issues.push({
          slotId,
          code: "DUPLICATE_FROZEN_IDENTITY",
          message: `frozen identity ${key} duplicated on slots ${prior} and ${slotId}`,
        });
      } else {
        seen.set(key, slotId);
      }
    }
  }
  return issues;
}

export function verifyManifestContentHash(
  manifest: CharacterSeasonEvidenceManifestV2,
  expectedContentHash: string,
): { ok: true } | { ok: false; reason: string } {
  if (!expectedContentHash || expectedContentHash !== manifest.contentHash) {
    return {
      ok: false,
      reason: `manifest_content_hash_mismatch: expected=${expectedContentHash} actual=${manifest.contentHash}`,
    };
  }
  return { ok: true };
}

export interface FactSetHashMismatchDetail {
  dimensionHint: "fact_set";
  manifestContentHash: string;
  slotId: string;
  slotIndex: number;
  expectedHash: string | null;
  actualHash: string | null;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
}

/**
 * Fail-closed validation of persisted fact-set bindings against frozen
 * EvidenceManifestV2 slot.factSetHash references. Does not call providers.
 *
 * A selected slot may reference multiple typed RunFactSet rows; the slot hash
 * is the composite from {@link buildSlotFactSetBindingHash}.
 */
export function verifyFactSetHashesAgainstManifest(
  manifest: CharacterSeasonEvidenceManifestV2,
  factSets: PersistedFactSetRef[],
): { ok: true } | { ok: false; reason: string; details: FactSetHashMismatchDetail[] } {
  const details: FactSetHashMismatchDetail[] = [];
  const selected = manifest.slots.filter((s) => s.state === "SELECTED");

  for (const slot of selected) {
    const slotId = slot.slotId ?? `${slot.dungeonSlug}:${slot.slotIndex}`;
    const expectedHash = slot.factSetHash;
    const identity = slot.identity;

    if (!expectedHash) {
      details.push({
        dimensionHint: "fact_set",
        manifestContentHash: manifest.contentHash,
        slotId,
        slotIndex: slot.slotIndex,
        expectedHash: null,
        actualHash: null,
        reportCode: identity?.reportCode ?? null,
        fightId: identity?.fightId ?? null,
        reportRevision: identity?.reportRevision ?? null,
      });
      continue;
    }

    const matching = factSets.filter((fs) => {
      if (!identity) return false;
      return (
        fs.reportCode === identity.reportCode &&
        fs.fightId === identity.fightId &&
        fs.reportRevision === identity.reportRevision
      );
    });

    if (matching.length === 0) {
      // Missing facts for a hashed slot — still a hash/reference failure.
      details.push({
        dimensionHint: "fact_set",
        manifestContentHash: manifest.contentHash,
        slotId,
        slotIndex: slot.slotIndex,
        expectedHash,
        actualHash: null,
        reportCode: identity?.reportCode ?? null,
        fightId: identity?.fightId ?? null,
        reportRevision: identity?.reportRevision ?? null,
      });
      continue;
    }

    const actualHash = buildSlotFactSetBindingHash(
      matching.map((fs) => ({
        extractorFamily: fs.extractorFamily,
        extractorVersion: fs.extractorVersion,
        inputFingerprint: fs.inputFingerprint,
        facts: fs.facts,
      })),
    );
    if (actualHash !== expectedHash) {
      details.push({
        dimensionHint: "fact_set",
        manifestContentHash: manifest.contentHash,
        slotId,
        slotIndex: slot.slotIndex,
        expectedHash,
        actualHash,
        reportCode: identity?.reportCode ?? null,
        fightId: identity?.fightId ?? null,
        reportRevision: identity?.reportRevision ?? null,
      });
    }
  }

  if (details.length === 0) return { ok: true };

  const reason = details
    .map(
      (d) =>
        `fact_set_hash_mismatch: slot=${d.slotId} index=${d.slotIndex} expected=${d.expectedHash ?? "missing"} actual=${d.actualHash ?? "missing"} manifest=${d.manifestContentHash}`,
    )
    .join("; ");
  return { ok: false, reason, details };
}

export function buildUnavailableInputFingerprint(input: {
  dimension: ScoringPublicDimension;
  algorithmVersion: string;
  manifestContentHash: string;
  reasons: string[];
}): string {
  const payload = {
    kind: "unavailable",
    dimension: input.dimension,
    algorithmVersion: input.algorithmVersion,
    manifestContentHash: input.manifestContentHash,
    reasons: [...input.reasons].sort(),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function algorithmVersionForDimension(
  dimension: ScoringPublicDimension,
): string {
  switch (dimension) {
    case "PERFORMANCE":
      return PERFORMANCE_V2_ALGORITHM_VERSION;
    case "SURVIVAL":
      return SURVIVAL_V2_ALGORITHM_VERSION;
    case "UTILITY":
      return UTILITY_V2_ALGORITHM_VERSION;
    case "EXPERIENCE":
      return EXPERIENCE_V3_ALGORITHM_VERSION;
  }
}

function classifyPersistedFacts(
  factSets: PersistedFactSetRef[],
  expectedFamily: string,
): FactReadinessResult {
  const limitations: string[] = [];
  const failureReasons: string[] = [];

  if (factSets.length === 0) {
    failureReasons.push("missing_fact_sets");
    return { ready: false, limitations, failureReasons };
  }

  let anyFamilyMatch = false;
  for (const fs of factSets) {
    const lim = limitationsFromFact(fs.facts, fs.limitations);
    limitations.push(...lim);
    if (isShadowPlaceholderFact(fs.facts)) {
      failureReasons.push("shadow_placeholder_facts");
      continue;
    }
    if (fs.extractorFamily !== expectedFamily) {
      continue;
    }
    anyFamilyMatch = true;
  }

  if (!anyFamilyMatch) {
    failureReasons.push(`missing_extractor_family:${expectedFamily}`);
  }

  const uniqueLimits = [...new Set(limitations)];
  const uniqueFails = [...new Set(failureReasons)];
  const ready =
    uniqueFails.length === 0 &&
    !uniqueLimits.includes("shadow_placeholder") &&
    anyFamilyMatch;

  return {
    ready,
    limitations: uniqueLimits,
    failureReasons: uniqueFails,
  };
}

/**
 * Map acquisition-time PERFORMANCE outcomes from frozen manifest slot
 * dimensionValidity.reasons into bounded dimension failure reasons.
 * Distinguishes never-requested / public-API unavailable / row absent /
 * schema unsupported / extraction failure without inventing parse facts.
 */
export function performanceProvenanceFromManifest(
  manifest: CharacterSeasonEvidenceManifestV2,
): string[] {
  const reasons: string[] = [];
  for (const slot of manifest.slots) {
    if (slot.state !== "SELECTED") continue;
    const slotReasons = slot.dimensionValidity?.reasons ?? [];
    for (const raw of slotReasons) {
      if (!raw.startsWith("PERFORMANCE:")) continue;
      // Format: PERFORMANCE:STATUS:reason
      const parts = raw.split(":");
      const status = parts[1] ?? "";
      const detail = parts.slice(2).join(":") || "n/a";
      if (status === "UNAVAILABLE") {
        if (detail === "ranking_parse_not_requested") {
          reasons.push("performance_extractor_not_requested");
        } else if (
          detail === "RANKING_PARSE_PUBLIC_API_UNAVAILABLE" ||
          detail === "ranking_parse_provider_capability_absent"
        ) {
          reasons.push("ranking_parse_public_api_unavailable");
        } else if (
          detail === "ranking_parse_row_absent" ||
          detail === "ranking_parse_absent"
        ) {
          reasons.push("ranking_parse_row_absent");
        } else if (
          detail === "ranking_parse_zone_payload_empty" ||
          detail.includes("schema")
        ) {
          reasons.push(
            detail.includes("schema")
              ? "ranking_parse_schema_unsupported"
              : "ranking_parse_zone_payload_empty",
          );
        } else {
          reasons.push(`performance_unavailable:${detail}`);
        }
      } else if (status === "FAILED") {
        reasons.push(`performance_extraction_failed:${detail}`);
      }
    }
  }
  return [...new Set(reasons)].slice(0, 16);
}

export type PerformanceAdapterResult =
  | { ok: true; input: PerformanceV2ComputeInput }
  | { ok: false; limitations: string[]; failureReasons: string[] };

export function adaptPerformanceComputeInput(input: {
  manifest: CharacterSeasonEvidenceManifestV2;
  factSets: PersistedFactSetRef[];
  /** Calculator-ready parse facts when available (fixture / future extractors). */
  runParseFacts?: PerformanceRunParseFactV2[];
  profileAggregate?: PerformanceV2ComputeInput["profileAggregate"];
  difficultyPolicy?: SeasonDifficultyPolicyV2 | null;
  expectedPartition?: number | null;
  logFreshness?: number;
  computedAt: string;
}): PerformanceAdapterResult {
  const familyFacts = input.factSets.filter((f) => f.extractorFamily === "performance");
  const readiness = classifyPersistedFacts(
    familyFacts.length > 0 ? familyFacts : input.factSets,
    "performance",
  );

  const runParseFacts: PerformanceRunParseFactV2[] = [...(input.runParseFacts ?? [])];
  const parseFailures: string[] = [];

  for (const fs of familyFacts) {
    if (isShadowPlaceholderFact(fs.facts)) continue;
    const parsed = parsePerformanceRunParseFactV2(fs.facts);
    if (!parsed.ok) {
      parseFailures.push(`performance_fact_parse:${parsed.reason}`);
      continue;
    }
    // Skip unavailable semantic rows — they are not score inputs.
    if (parsed.fact.semantic === "UNAVAILABLE" || parsed.fact.parsePercentile == null) {
      continue;
    }
    runParseFacts.push(parsed.fact);
  }

  if (runParseFacts.length === 0) {
    const provenance = performanceProvenanceFromManifest(input.manifest);
    const failureReasons = [
      ...(provenance.length > 0
        ? provenance
        : readiness.failureReasons.length > 0
          ? readiness.failureReasons
          : ["missing_performance_parse_facts"]),
      ...parseFailures,
      // Keep parse-facts absence when we only know the extractor family was empty
      // and acquisition left no structured provenance.
      ...(provenance.length === 0 &&
      readiness.failureReasons.includes("missing_extractor_family:performance")
        ? ["missing_performance_parse_facts"]
        : []),
    ];
    return {
      ok: false,
      limitations: readiness.limitations,
      failureReasons: [...new Set(failureReasons)],
    };
  }

  const difficultyPolicy =
    input.difficultyPolicy ??
    createManualDifficultyPolicyV2({
      seasonId: input.manifest.seasonId,
      region: "eu",
      role: input.manifest.role,
      specSlug: input.manifest.specSlug,
    });

  return {
    ok: true,
    input: {
      manifest: {
        contentHash: input.manifest.contentHash,
        schemaVersion: input.manifest.schemaVersion,
        selectorVersion: input.manifest.selectorVersion,
        characterId: input.manifest.characterId,
        seasonId: input.manifest.seasonId,
        seasonSlug: input.manifest.seasonSlug,
        specSlug: input.manifest.specSlug,
        role: input.manifest.role,
        highKeyPolicyId: input.manifest.highKeyPolicyId,
        activeDungeonSlugs: input.manifest.activeDungeonSlugs,
        expectedSlotCount: input.manifest.expectedSlotCount,
        selectedSlotCount: input.manifest.selectedSlotCount,
        evidenceCutoffAt: input.manifest.evidenceCutoffAt,
      },
      runParseFacts,
      profileAggregate: input.profileAggregate ?? null,
      difficultyPolicy,
      expectedPartition: input.expectedPartition ?? null,
      logFreshness: input.logFreshness ?? 0,
      computedAt: input.computedAt,
    },
  };
}

export type SurvivalAdapterResult =
  | { ok: true; input: SurvivalV2ComputeInput }
  | { ok: false; limitations: string[]; failureReasons: string[] };

export function adaptSurvivalComputeInput(input: {
  manifest: CharacterSeasonEvidenceManifestV2;
  factSets: PersistedFactSetRef[];
  /** Optional pre-parsed documents (fixtures). */
  parsedDocuments?: SurvivalFactDocumentV2[];
  relativeDamageMode?: SurvivalV2RelativeDamageMode;
  scoreModelId?: string | null;
}): SurvivalAdapterResult {
  const familyFacts = input.factSets.filter(
    (f) => f.extractorFamily === SURVIVAL_V2_EXTRACTOR_FAMILY,
  );
  const readiness = classifyPersistedFacts(
    familyFacts.length > 0 ? familyFacts : input.factSets,
    SURVIVAL_V2_EXTRACTOR_FAMILY,
  );

  const documents: SurvivalFactDocumentV2[] = [...(input.parsedDocuments ?? [])];
  const parseFailures: string[] = [];

  for (const fs of familyFacts) {
    if (isShadowPlaceholderFact(fs.facts)) continue;
    const parsed = parseSurvivalFactDocumentV2(fs.facts);
    if (!parsed.ok) {
      parseFailures.push(`survival_fact_parse:${parsed.reason}`);
      continue;
    }
    documents.push(parsed.document);
  }

  if (documents.length === 0) {
    return {
      ok: false,
      limitations: readiness.limitations,
      failureReasons: [
        ...new Set([
          ...readiness.failureReasons,
          ...parseFailures,
          ...(readiness.failureReasons.length === 0 ? ["missing_survival_fact_documents"] : []),
        ]),
      ],
    };
  }

  return {
    ok: true,
    input: {
      manifest: input.manifest,
      factSets: documents,
      relativeDamageMode: input.relativeDamageMode ?? "off",
      scoreModelId: input.scoreModelId ?? null,
    },
  };
}

function isUtilityRunFactSet(value: unknown): value is UtilityV2RunFactSet {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== UTILITY_V2_SCHEMA_VERSION) return false;
  if (value.extractorFamily !== UTILITY_V2_EXTRACTOR_FAMILY) return false;
  if (typeof value.slotId !== "string") return false;
  if (typeof value.runId !== "string") return false;
  if (typeof value.dungeonSlug !== "string") return false;
  return true;
}

export type UtilityAdapterResult =
  | { ok: true; input: UtilityV2ComputeInput }
  | { ok: false; limitations: string[]; failureReasons: string[] };

export function adaptUtilityComputeInput(input: {
  manifest: CharacterSeasonEvidenceManifestV2;
  factSets: PersistedFactSetRef[];
  /** Optional typed fact sets (fixtures). */
  typedFactSets?: UtilityV2RunFactSet[];
}): UtilityAdapterResult {
  const familyFacts = input.factSets.filter(
    (f) => f.extractorFamily === UTILITY_V2_EXTRACTOR_FAMILY,
  );
  const readiness = classifyPersistedFacts(
    familyFacts.length > 0 ? familyFacts : input.factSets,
    UTILITY_V2_EXTRACTOR_FAMILY,
  );

  const typed: UtilityV2RunFactSet[] = [...(input.typedFactSets ?? [])];
  const parseFailures: string[] = [];

  for (const fs of familyFacts) {
    if (isShadowPlaceholderFact(fs.facts)) continue;
    if (!isUtilityRunFactSet(fs.facts)) {
      parseFailures.push("utility_fact_parse:invalid_shape");
      continue;
    }
    typed.push(fs.facts);
  }

  if (typed.length === 0) {
    return {
      ok: false,
      limitations: readiness.limitations,
      failureReasons: [
        ...new Set([
          ...readiness.failureReasons,
          ...parseFailures,
          ...(readiness.failureReasons.length === 0 ? ["missing_utility_fact_sets"] : []),
        ]),
      ],
    };
  }

  const manifestRef: UtilityV2FrozenManifestRef = {
    contentHash: input.manifest.contentHash,
    schemaVersion: input.manifest.schemaVersion,
    selectorVersion: input.manifest.selectorVersion,
    expectedSlotCount: input.manifest.expectedSlotCount,
    selectedSlotCount: input.manifest.selectedSlotCount,
    activeDungeonSlugs: input.manifest.activeDungeonSlugs,
    slots: input.manifest.slots.map((s) => ({
      slotId: `${s.dungeonSlug}:${s.slotIndex}`,
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex as 0 | 1,
      state: s.state,
      identity: s.identity
        ? {
            reportCode: s.identity.reportCode,
            fightId: s.identity.fightId,
            reportRevision: s.identity.reportRevision,
          }
        : null,
    })),
  };

  return {
    ok: true,
    input: {
      manifest: manifestRef,
      factSets: typed,
    },
  };
}

export type ExperienceAdapterResult =
  | { ok: true; input: ExperienceV3ComputeInput }
  | { ok: false; limitations: string[]; failureReasons: string[] };

export interface ExperienceHistoryInputs {
  currentExposure: ExperienceV3CurrentExposureFact;
  previousSeason: ExperienceV3PreviousSeasonFact;
  previousSeasonPolicy: PreviousSeasonNormalizationPolicyV3;
  eliteHistory: ExperienceV3EliteHistoryFact;
  historicalRank: ExperienceV3HistoricalRankFact | null;
  historicalRankPolicy: HistoricalRankPolicyV3;
}

/**
 * Experience is WCL-independent. Requires frozen history inputs from persisted
 * Blizzard/local facts (supplied by the worker). Missing history → UNAVAILABLE.
 */
export function adaptExperienceComputeInput(input: {
  manifest: CharacterSeasonEvidenceManifestV2;
  history: ExperienceHistoryInputs | null;
  computedAt: string;
}): ExperienceAdapterResult {
  if (!input.history) {
    return {
      ok: false,
      limitations: ["missing_experience_history"],
      failureReasons: ["missing_experience_history_inputs"],
    };
  }
  return {
    ok: true,
    input: {
      manifest: {
        contentHash: input.manifest.contentHash,
        schemaVersion: input.manifest.schemaVersion,
        selectorVersion: input.manifest.selectorVersion,
        characterId: input.manifest.characterId,
        seasonId: input.manifest.seasonId,
        seasonSlug: input.manifest.seasonSlug,
        highKeyPolicyId: input.manifest.highKeyPolicyId,
        evidenceCutoffAt: input.manifest.evidenceCutoffAt,
      },
      currentExposure: input.history.currentExposure,
      previousSeason: input.history.previousSeason,
      previousSeasonPolicy: input.history.previousSeasonPolicy,
      eliteHistory: input.history.eliteHistory,
      historicalRank: input.history.historicalRank,
      historicalRankPolicy: input.history.historicalRankPolicy,
      computedAt: input.computedAt,
    },
  };
}
