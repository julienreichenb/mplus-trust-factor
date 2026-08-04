/**
 * Provider-free Scoring V2 evidence audit builder.
 * Produces a bounded downloadable JSON document for one frozen EvidenceManifest.
 */

import { createHash } from "node:crypto";
import type {
  CharacterSeasonEvidenceManifestV2,
  DatasetPersistenceState,
  EvidenceAuditArtifactRef,
  EvidenceAuditDimensionConsumption,
  EvidenceAuditFactSetEntry,
  EvidenceAuditMatrixRow,
  EvidenceAuditSlot,
  EvidenceDatasetKind,
  FactSourceOutcome,
  ScoringV2EvidenceAuditDocument,
  SlotAuditState,
} from "@mplus/contracts";
import {
  EVIDENCE_AUDIT_V2_SCHEMA_VERSION,
  FEATURE_REGISTRY_V2_VERSION,
  characterSeasonEvidenceManifestV2Schema,
} from "@mplus/contracts";
import {
  buildSlotFactSetBindingHash,
  validateFrozenManifestIdentities,
  verifyFactSetHashesAgainstManifest,
  type PersistedFactSetRef,
} from "../dimensions/v2/index.js";
import { parseSurvivalFactDocumentV2 } from "../survival/v2/index.js";
import type { SurvivalFactDocumentV2 } from "../survival/v2/types.js";
import { parsePerformanceRunParseFactV2 } from "../performance/v2/facts.js";
import type { PerformanceRunParseFactV2 } from "../performance/v2/types.js";
import {
  UTILITY_V2_EXTRACTOR_FAMILY,
  type UtilityV2RunFactSet,
} from "../utility/v2/index.js";
import { emitPerformanceConsumptionTraces } from "../performance/v2/consumption-traces.js";
import { emitSurvivalConsumptionTraces } from "../survival/v2/consumption-traces.js";
import { emitUtilityConsumptionTraces } from "../utility/v2/consumption-traces.js";
import { EXPECTED_EVENT_DATASETS, datasetKindFromPersistedKey } from "./dataset-catalog.js";
import {
  artifactIdsFromCoverage,
  identitiesMatch,
  parseFactDocumentIdentity,
} from "./fact-identity.js";
import { getFeatureRegistryV2 } from "./feature-registry.js";
import {
  buildPerformanceFeatureUsage,
  buildSurvivalFeatureUsage,
  buildUtilityFeatureUsage,
  featureUsageFromMetrics,
} from "./feature-usage.js";
import type { EvidenceAuditReplayResult } from "@mplus/contracts";

export interface AuditDatasetPageInput {
  pageIndex: number;
  artifactId: string | null;
  contentHash: string | null;
  eventCount: number;
  scopeFingerprint: string | null;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  datasetKey: string;
}

export interface AuditDatasetInput {
  id: string;
  manifestSlotId: string;
  datasetKey: string;
  compatibilityKey: string;
  artifactId: string | null;
  schemaVersion: string;
  providerContractVersion: string;
  state: string;
  eventCount: number;
  pageCount: number;
  truncated: boolean;
  payloadFingerprint: string | null;
  pages: AuditDatasetPageInput[];
}

export interface AuditFactSetInput {
  id: string;
  manifestSlotId: string;
  extractorFamily: string;
  extractorVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  facts: unknown;
  coverage: unknown;
  limitations: unknown;
  /** DB EvidenceManifestSlot relation identity (not fact-document identity). */
  relationReportCode: string | null;
  relationFightId: number | null;
  relationReportRevision: number | null;
  dungeonSlug: string | null;
  slotIndex: number | null;
  /** Durable acquisition outcome when RunFactSet row is absent (from dimensionValidity). */
  durableOutcome?: FactSourceOutcome | null;
  durableReason?: string | null;
  durableCategory?: string | null;
}

export interface AuditArtifactMetaInput {
  id: string;
  provider: string | null;
  artifactClass: string | null;
  contentHash: string | null;
  byteLength: number | null;
}

export interface AuditDimensionInput {
  dimension: string;
  score: number | null;
  confidence: number | null;
  state: string;
  inputFingerprint: string;
  metrics: unknown;
  explanation: unknown;
  manifestId: string;
  scoreModelId?: string | null;
}

export interface AuditMasterDataInput {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  digestId: string | null;
  masterDataArtifactId: string | null;
  contentFingerprint: string | null;
}

export interface AuditManifestSlotRow {
  id: string;
  dungeonSlug: string;
  slotIndex: number;
  state: string;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  keyLevel: number | null;
  selectionReason: string | null;
  candidateRank: number | null;
  /** Slot-level dimensionValidity.reasons strings for durable provenance. */
  dimensionValidityReasons?: string[];
}

export interface BuildScoringV2EvidenceAuditInput {
  manifestId: string;
  characterId: string;
  seasonId: string;
  /** Frozen manifest document (JSON). */
  manifestDocument: unknown;
  coverageState: string;
  expectedSlotCount: number;
  selectedSlotCount: number;
  auditedAt?: string;
  slotRows: AuditManifestSlotRow[];
  datasets: AuditDatasetInput[];
  factSets: AuditFactSetInput[];
  dimensions: AuditDimensionInput[];
  masterDataByIdentity: AuditMasterDataInput[];
  /** Pages found by immutable report identity (may include unbound pages). */
  pagesByIdentity: AuditDatasetPageInput[];
  /** Optional RawArtifact metadata keyed by id (bounded). */
  artifactsById?: Record<string, AuditArtifactMetaInput>;
  /** Optional precomputed replay result. */
  replay?: EvidenceAuditReplayResult | null;
  /** Enabled WCL extractors for this audit (EXPERIENCE always out of scope here). */
  enabledFamilies?: Array<"PERFORMANCE" | "SURVIVAL" | "UTILITY">;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function limitationsList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function identityKey(
  reportCode: string | null | undefined,
  fightId: number | null | undefined,
  reportRevision?: number | null,
): string | null {
  if (!reportCode || fightId == null) return null;
  if (reportRevision == null) return `${reportCode}:${fightId}`;
  return `${reportCode}:${fightId}:${reportRevision}`;
}

function discoveryKey(reportCode: string, fightId: number): string {
  return `${reportCode}:${fightId}`;
}

function parseUtilityFact(facts: unknown): UtilityV2RunFactSet | null {
  if (!isRecord(facts)) return null;
  if (facts.extractorFamily !== UTILITY_V2_EXTRACTOR_FAMILY && facts.extractorFamily !== "utility") {
    // Accept documents that omit family if schema looks right.
    if (typeof facts.runId !== "string" || typeof facts.dungeonSlug !== "string") return null;
  }
  if (typeof facts.runId !== "string" || typeof facts.dungeonSlug !== "string") return null;
  return facts as unknown as UtilityV2RunFactSet;
}

function datasetPersistenceState(input: {
  rowPresent: boolean;
  eventCount: number | null;
  state: string | null;
  integrityErrors: string[];
}): DatasetPersistenceState {
  if (input.integrityErrors.length > 0) return "BROKEN";
  if (!input.rowPresent) return "MISSING";
  if (input.state && /fail|error/i.test(input.state)) return "FAILED";
  if (input.state && /unavail/i.test(input.state)) return "UNAVAILABLE";
  if (input.eventCount === 0) return "ZERO_EVENT";
  return "PRESENT";
}

function mergeSlotAuditState(parts: SlotAuditState[]): SlotAuditState {
  if (parts.includes("BROKEN")) return "BROKEN";
  if (parts.includes("UNAVAILABLE") && parts.every((p) => p === "UNAVAILABLE")) {
    return "UNAVAILABLE";
  }
  if (parts.includes("UNAVAILABLE") || parts.includes("PARTIAL")) return "PARTIAL";
  if (parts.every((p) => p === "COMPLETE")) return "COMPLETE";
  return "PARTIAL";
}

function summarizeSurvivalFacts(facts: unknown): Record<string, unknown> | null {
  const parsed = parseSurvivalFactDocumentV2(facts);
  if (!parsed.ok) return null;
  const d = parsed.document;
  return {
    deaths: d.deaths.count,
    activeCombatMs: d.activeCombat.durationMs,
    dangerWindowCount: d.dangerWindows.length,
    healthMode: d.healthEvidence.mode,
    catalogCoverage: d.defensiveActivations.catalogCoverage,
    limitationCount: d.limitations.length,
  };
}

function summarizeUtilityFacts(facts: unknown): Record<string, unknown> | null {
  const u = parseUtilityFact(facts);
  if (!u) return null;
  return {
    interruptAttemptCount: u.interruptAttempts.length,
    ccActionCount: u.ccActions.length,
    supportActionCount: u.supportActions.length,
    dispelPurgeSuccessCount: u.dispelPurgeSuccessCount,
    activeCombatMs: u.activeCombatMs,
    hostileObservability: u.hostileObservability,
    limitationCount: u.limitations.length,
  };
}

function summarizePerformanceFacts(facts: unknown): Record<string, unknown> | null {
  const parsed = parsePerformanceRunParseFactV2(facts);
  if (!parsed.ok) return null;
  return {
    semantic: parsed.fact.semantic,
    parsePercentile: parsed.fact.parsePercentile,
    keyLevel: parsed.fact.keyLevel,
    partition: parsed.fact.partition,
  };
}

function auditEventDatasetsForSlot(input: {
  selected: boolean;
  manifestSlotId: string | null;
  identity: { reportCode: string; fightId: number; reportRevision: number } | null;
  datasets: AuditDatasetInput[];
  pagesByIdentity: AuditDatasetPageInput[];
}): EvidenceAuditSlot["eventDatasets"] {
  const slotDatasets = input.manifestSlotId
    ? input.datasets.filter((d) => d.manifestSlotId === input.manifestSlotId)
    : [];

  return EXPECTED_EVENT_DATASETS.map((spec) => {
    const row =
      slotDatasets.find(
        (d) => datasetKindFromPersistedKey(d.datasetKey) === spec.kind,
      ) ?? null;

    const identityPages =
      input.identity == null
        ? []
        : input.pagesByIdentity.filter(
            (p) =>
              p.reportCode === input.identity!.reportCode &&
              p.fightId === input.identity!.fightId &&
              p.reportRevision === input.identity!.reportRevision &&
              datasetKindFromPersistedKey(p.datasetKey) === spec.kind,
          );

    const pages =
      row && row.pages.length > 0
        ? row.pages
        : identityPages;

    const integrityErrors: string[] = [];
    if (!input.selected) {
      // Unselected / missing slots: datasets expected absent.
      return {
        datasetKind: spec.kind,
        required: spec.required,
        consumers: [...spec.consumers],
        rowPresent: false,
        compatibilityKey: null,
        manifestSlotId: input.manifestSlotId,
        artifactId: null,
        payloadFingerprint: null,
        eventCount: null,
        pageCount: null,
        truncated: null,
        pages: [],
        schemaVersion: null,
        providerContractVersion: null,
        persistenceState: "UNAVAILABLE" as const,
        integrityErrors: [],
      };
    }

    if (spec.required && !row) {
      integrityErrors.push(`REQUIRED_DATASET_MISSING:${spec.kind}`);
    }
    if (row?.payloadFingerprint && pages.length > 0) {
      const hashes = pages.map((p) => p.contentHash).filter(Boolean);
      const unique = new Set(hashes);
      if (hashes.length !== unique.size) {
        integrityErrors.push(`DUPLICATE_PAGE_CONTENT_HASH:${spec.kind}`);
      }
    }
    if (row && input.identity) {
      for (const page of pages) {
        if (
          page.reportCode !== input.identity.reportCode ||
          page.fightId !== input.identity.fightId ||
          page.reportRevision !== input.identity.reportRevision
        ) {
          integrityErrors.push(`PAGE_IDENTITY_MISMATCH:${spec.kind}`);
        }
      }
    }

    const eventCount = row?.eventCount ?? null;
    const persistenceState = datasetPersistenceState({
      rowPresent: row != null,
      eventCount,
      state: row?.state ?? null,
      integrityErrors,
    });

    return {
      datasetKind: spec.kind,
      required: spec.required,
      consumers: [...spec.consumers],
      rowPresent: row != null,
      compatibilityKey: row?.compatibilityKey ?? null,
      manifestSlotId: input.manifestSlotId,
      artifactId: row?.artifactId ?? null,
      payloadFingerprint: row?.payloadFingerprint ?? null,
      eventCount,
      pageCount: row?.pageCount ?? (pages.length > 0 ? pages.length : null),
      truncated: row?.truncated ?? null,
      pages: pages.map((p) => ({
        pageIndex: p.pageIndex,
        artifactId: p.artifactId,
        contentHash: p.contentHash,
        eventCount: p.eventCount,
        scopeFingerprint: p.scopeFingerprint,
      })),
      schemaVersion: row?.schemaVersion ?? null,
      providerContractVersion: row?.providerContractVersion ?? null,
      persistenceState,
      integrityErrors,
    };
  });
}

function resolveArtifactRefs(
  coverage: unknown,
  artifactsById: Record<string, AuditArtifactMetaInput> | undefined,
): { refs: EvidenceAuditArtifactRef[]; missing: string[] } {
  const ids = artifactIdsFromCoverage(coverage);
  const refs: EvidenceAuditArtifactRef[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const meta = artifactsById?.[id];
    if (!meta) {
      missing.push(id);
      refs.push({
        artifactId: id,
        provider: null,
        artifactClass: null,
        contentHash: null,
        byteLength: null,
      });
      continue;
    }
    refs.push({
      artifactId: meta.id,
      provider: meta.provider,
      artifactClass: meta.artifactClass,
      contentHash: meta.contentHash,
      byteLength: meta.byteLength,
    });
  }
  return { refs, missing };
}

function parseDurableOutcomeFromReasons(
  family: "PERFORMANCE" | "SURVIVAL" | "UTILITY",
  reasons: string[] | undefined,
): { outcome: FactSourceOutcome; reason: string | null } | null {
  if (!reasons?.length) return null;
  const prefix = `${family}:`;
  for (const r of reasons) {
    if (!r.startsWith(prefix)) continue;
    const rest = r.slice(prefix.length);
    if (rest.startsWith("UNAVAILABLE:")) {
      return { outcome: "UNAVAILABLE", reason: rest.slice("UNAVAILABLE:".length) || rest };
    }
    if (rest.startsWith("FAILED:")) {
      return { outcome: "FAILED", reason: rest.slice("FAILED:".length) || rest };
    }
    if (rest.startsWith("WRITTEN:")) {
      return { outcome: "WRITTEN", reason: rest.slice("WRITTEN:".length) || null };
    }
  }
  return null;
}

function auditFactSetsForSlot(input: {
  selected: boolean;
  slot: CharacterSeasonEvidenceManifestV2["slots"][number] | null;
  manifestSlotId: string | null;
  factSets: AuditFactSetInput[];
  enabledFamilies: Array<"PERFORMANCE" | "SURVIVAL" | "UTILITY">;
  dimensionValidityReasons?: string[];
  artifactsById?: Record<string, AuditArtifactMetaInput>;
}): EvidenceAuditFactSetEntry[] {
  const slotFacts = input.manifestSlotId
    ? input.factSets.filter((f) => f.manifestSlotId === input.manifestSlotId)
    : [];

  const identity = input.slot?.identity ?? null;
  const expectedHash = input.slot?.factSetHash ?? null;
  const relation = {
    reportCode: input.slot?.identity?.reportCode ?? null,
    fightId: input.slot?.identity?.fightId ?? null,
    reportRevision: input.slot?.identity?.reportRevision ?? null,
  };

  return input.enabledFamilies.map((family) => {
    const familyLower = family.toLowerCase();
    const row =
      slotFacts.find((f) => f.extractorFamily.toLowerCase() === familyLower) ?? null;

    const empty = (
      outcome: FactSourceOutcome,
      extra: Partial<EvidenceAuditFactSetEntry> = {},
    ): EvidenceAuditFactSetEntry => ({
      extractorFamily: family,
      runFactSetPresent: false,
      extractorVersion: null,
      schemaVersion: null,
      inputFingerprint: null,
      reportCode: null,
      fightId: null,
      reportRevision: null,
      relationReportCode: relation.reportCode,
      relationFightId: relation.fightId,
      relationReportRevision: relation.reportRevision,
      manifestSlotId: input.manifestSlotId,
      artifactReferences: [],
      coverage: null,
      limitations: [],
      parserValidation: outcome === "NOT_ENABLED" ? "SKIPPED" : "UNAVAILABLE",
      sourceOutcome: outcome,
      boundedFactsSummary: null,
      hashMatchAgainstManifest: null,
      identityMatchAgainstManifest: null,
      ...extra,
    });

    if (!input.selected) {
      return empty("UNAVAILABLE");
    }

    if (!input.enabledFamilies.includes(family)) {
      return empty("NOT_ENABLED", { limitations: ["dimension_not_enabled"] });
    }

    if (!row) {
      const durable = parseDurableOutcomeFromReasons(
        family,
        input.dimensionValidityReasons,
      );
      if (!durable) {
        return empty("FAILED", {
          limitations: ["missing_run_fact_set_without_durable_provenance"],
          parserValidation: "INVALID",
          hashMatchAgainstManifest: expectedHash == null ? null : false,
        });
      }
      return empty(durable.outcome, {
        limitations: [
          durable.reason ?? "missing_run_fact_set",
          `durable_outcome:${durable.outcome}`,
        ],
        parserValidation:
          durable.outcome === "FAILED" ? "INVALID" : "UNAVAILABLE",
        hashMatchAgainstManifest: expectedHash == null ? null : false,
      });
    }

    const docIdentity = parseFactDocumentIdentity(family, row.facts);
    let parserValidation: EvidenceAuditFactSetEntry["parserValidation"] = "SKIPPED";
    let summary: Record<string, unknown> | null = null;
    let sourceOutcome: FactSourceOutcome = "WRITTEN";

    if (family === "SURVIVAL") {
      const parsed = parseSurvivalFactDocumentV2(row.facts);
      parserValidation = parsed.ok ? "VALID" : "INVALID";
      summary = summarizeSurvivalFacts(row.facts);
      if (!parsed.ok) sourceOutcome = "FAILED";
    } else if (family === "UTILITY") {
      const parsed = parseUtilityFact(row.facts);
      parserValidation = parsed ? "VALID" : "INVALID";
      summary = summarizeUtilityFacts(row.facts);
      if (!parsed) sourceOutcome = "FAILED";
    } else {
      const parsed = parsePerformanceRunParseFactV2(row.facts);
      if (parsed.ok) {
        parserValidation = "VALID";
        summary = summarizePerformanceFacts(row.facts);
        if (parsed.fact.semantic === "UNAVAILABLE") sourceOutcome = "UNAVAILABLE";
      } else if (isRecord(row.facts) && row.facts.kind === "shadow_placeholder") {
        parserValidation = "INVALID";
        sourceOutcome = "FAILED";
        summary = { kind: "shadow_placeholder" };
      } else {
        const lim = limitationsList(row.limitations);
        if (lim.some((l) => /unavailable|ranking_parse/i.test(l))) {
          parserValidation = "UNAVAILABLE";
          sourceOutcome = "UNAVAILABLE";
          summary = { limitations: lim.slice(0, 8) };
        } else {
          parserValidation = "INVALID";
          sourceOutcome = "FAILED";
        }
      }
    }

    const bindingMembers = slotFacts.map((f) => ({
      extractorFamily: f.extractorFamily,
      extractorVersion: f.extractorVersion,
      inputFingerprint: f.inputFingerprint,
    }));
    const computed = buildSlotFactSetBindingHash(bindingMembers);
    const hashMatch = expectedHash == null ? null : computed === expectedHash;

    const { refs, missing } = resolveArtifactRefs(row.coverage, input.artifactsById);
    const lim = limitationsList(row.limitations);
    if (missing.length > 0) {
      lim.push(`MISSING_ARTIFACT_REFS:${missing.length}`);
    }

    const identityOk =
      identity != null &&
      identitiesMatch(docIdentity, {
        reportCode: identity.reportCode,
        fightId: identity.fightId,
        reportRevision: identity.reportRevision,
      });

    if (identity && !identityOk) {
      lim.push("FACT_IDENTITY_MISMATCH");
      return {
        extractorFamily: family,
        runFactSetPresent: true,
        extractorVersion: row.extractorVersion,
        schemaVersion: row.schemaVersion,
        inputFingerprint: row.inputFingerprint,
        reportCode: docIdentity.reportCode,
        fightId: docIdentity.fightId,
        reportRevision: docIdentity.reportRevision,
        relationReportCode: row.relationReportCode,
        relationFightId: row.relationFightId,
        relationReportRevision: row.relationReportRevision,
        manifestSlotId: row.manifestSlotId,
        artifactReferences: refs,
        coverage: isRecord(row.coverage) ? row.coverage : null,
        limitations: lim,
        parserValidation: "INVALID",
        sourceOutcome: "FAILED",
        boundedFactsSummary: summary,
        hashMatchAgainstManifest: false,
        identityMatchAgainstManifest: false,
      };
    }

    if (missing.length > 0) {
      sourceOutcome = "FAILED";
      parserValidation = "INVALID";
    }

    return {
      extractorFamily: family,
      runFactSetPresent: true,
      extractorVersion: row.extractorVersion,
      schemaVersion: row.schemaVersion,
      inputFingerprint: row.inputFingerprint,
      reportCode: docIdentity.reportCode,
      fightId: docIdentity.fightId,
      reportRevision: docIdentity.reportRevision,
      relationReportCode: row.relationReportCode,
      relationFightId: row.relationFightId,
      relationReportRevision: row.relationReportRevision,
      manifestSlotId: row.manifestSlotId,
      artifactReferences: refs,
      coverage: isRecord(row.coverage) ? row.coverage : null,
      limitations: lim,
      parserValidation,
      sourceOutcome,
      boundedFactsSummary: summary,
      hashMatchAgainstManifest: hashMatch,
      identityMatchAgainstManifest: identity ? identityOk : null,
    };
  });
}

function slotMatrixStatus(
  fact: EvidenceAuditFactSetEntry | undefined,
): "OK" | "PARTIAL" | "UNAVAILABLE" | "FAILED" | "NOT_ENABLED" | "N/A" {
  if (!fact) return "N/A";
  if (fact.sourceOutcome === "NOT_ENABLED") return "NOT_ENABLED";
  if (fact.sourceOutcome === "FAILED" || fact.parserValidation === "INVALID") {
    return "FAILED";
  }
  if (fact.sourceOutcome === "UNAVAILABLE" || !fact.runFactSetPresent) return "UNAVAILABLE";
  if (fact.hashMatchAgainstManifest === false || fact.identityMatchAgainstManifest === false) {
    return "PARTIAL";
  }
  return "OK";
}

function slotMatrixDimStatus(
  fact: EvidenceAuditFactSetEntry | undefined,
): "OK" | "PARTIAL" | "UNAVAILABLE" | "N/A" {
  const s = slotMatrixStatus(fact);
  if (s === "FAILED" || s === "PARTIAL") return "PARTIAL";
  if (s === "NOT_ENABLED") return "N/A";
  if (s === "UNAVAILABLE") return "UNAVAILABLE";
  if (s === "OK") return "OK";
  return "N/A";
}

/**
 * Build a provider-free evidence audit document for one frozen manifest.
 */
export function buildScoringV2EvidenceAudit(
  input: BuildScoringV2EvidenceAuditInput,
): ScoringV2EvidenceAuditDocument {
  const auditedAt = input.auditedAt ?? new Date().toISOString();
  const integrityFailures: string[] = [];

  const parsedManifest = characterSeasonEvidenceManifestV2Schema.safeParse(
    input.manifestDocument,
  );
  if (!parsedManifest.success) {
    integrityFailures.push("MANIFEST_DOCUMENT_INVALID");
  }
  const manifest = parsedManifest.success ? parsedManifest.data : null;

  const enabledFamilies: Array<"PERFORMANCE" | "SURVIVAL" | "UTILITY"> = [
    "PERFORMANCE",
    "SURVIVAL",
    "UTILITY",
  ];

  // Expected slots: prefer manifest.activeDungeonSlugs × 2, else slot rows / expected count.
  const dungeonSlugs =
    manifest?.activeDungeonSlugs ??
    [...new Set(input.slotRows.map((s) => s.dungeonSlug))].sort();
  const expectedSlotCount =
    manifest?.expectedSlotCount ??
    input.expectedSlotCount ??
    dungeonSlugs.length * 2;

  const identityCounts = new Map<string, number>();
  if (manifest) {
    for (const slot of manifest.slots) {
      if (slot.state !== "SELECTED" || !slot.identity) continue;
      const key = discoveryKey(slot.identity.reportCode, slot.identity.fightId);
      identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
    }
  }

  if (manifest) {
    const identityIssues = validateFrozenManifestIdentities(manifest);
    for (const issue of identityIssues) {
      integrityFailures.push(`FROZEN_IDENTITY:${issue.code}:${issue.slotId}`);
    }
    const factRefs: PersistedFactSetRef[] = input.factSets.map((f) => {
      const family = f.extractorFamily.toUpperCase();
      const dim =
        family === "PERFORMANCE" || family === "SURVIVAL" || family === "UTILITY"
          ? (family as "PERFORMANCE" | "SURVIVAL" | "UTILITY")
          : "SURVIVAL";
      const docId = parseFactDocumentIdentity(dim, f.facts);
      return {
        extractorFamily: f.extractorFamily,
        extractorVersion: f.extractorVersion,
        schemaVersion: f.schemaVersion,
        inputFingerprint: f.inputFingerprint,
        facts: f.facts,
        limitations: f.limitations,
        manifestSlotId: f.manifestSlotId,
        reportCode: docId.reportCode,
        fightId: docId.fightId,
        reportRevision: docId.reportRevision,
        dungeonSlug: f.dungeonSlug,
        slotIndex: f.slotIndex,
      };
    });
    const hashCheck = verifyFactSetHashesAgainstManifest(manifest, factRefs);
    if (!hashCheck.ok) {
      integrityFailures.push(`FACT_SET_HASH_MISMATCH:${hashCheck.reason}`);
    }
  }

  // Reject facts whose document identity is not a selected slot (never use relation copy).
  if (manifest) {
    const selectedKeys = new Set(
      manifest.slots
        .filter((s) => s.state === "SELECTED" && s.identity)
        .map((s) =>
          identityKey(
            s.identity!.reportCode,
            s.identity!.fightId,
            s.identity!.reportRevision,
          ),
        )
        .filter((k): k is string => k != null),
    );
    for (const fs of input.factSets) {
      const family = fs.extractorFamily.toUpperCase();
      if (family !== "PERFORMANCE" && family !== "SURVIVAL" && family !== "UTILITY") {
        continue;
      }
      const docId = parseFactDocumentIdentity(family, fs.facts);
      const key = identityKey(docId.reportCode, docId.fightId, docId.reportRevision);
      if (key && !selectedKeys.has(key)) {
        integrityFailures.push(
          `UNSELECTED_FACT_SET:${fs.extractorFamily}:${key}`,
        );
      }
    }
  }

  // Cross-manifest dimension check
  for (const dim of input.dimensions) {
    if (dim.manifestId !== input.manifestId) {
      integrityFailures.push(
        `DIMENSION_OTHER_MANIFEST:${dim.dimension}:${dim.manifestId}`,
      );
    }
  }

  const slots: EvidenceAuditSlot[] = [];
  for (const dungeonSlug of dungeonSlugs) {
    for (const slotIndex of [0, 1] as const) {
      const manifestSlot =
        manifest?.slots.find(
          (s) => s.dungeonSlug === dungeonSlug && s.slotIndex === slotIndex,
        ) ?? null;
      const slotRow =
        input.slotRows.find(
          (s) => s.dungeonSlug === dungeonSlug && s.slotIndex === slotIndex,
        ) ?? null;

      const selected = manifestSlot?.state === "SELECTED";
      const identity = manifestSlot?.identity ?? null;
      const completeIdentity =
        identity != null &&
        typeof identity.reportCode === "string" &&
        identity.reportCode.length > 0 &&
        typeof identity.fightId === "number" &&
        typeof identity.reportRevision === "number";

      let frozenIdentityCompleteness: EvidenceAuditSlot["frozenIdentityCompleteness"] =
        "NOT_APPLICABLE";
      if (selected) {
        frozenIdentityCompleteness = completeIdentity ? "COMPLETE" : "INCOMPLETE";
        if (!completeIdentity) {
          integrityFailures.push(
            `INCOMPLETE_IDENTITY:${dungeonSlug}:${slotIndex}`,
          );
        }
      }

      let duplicateIdentityStatus: EvidenceAuditSlot["duplicateIdentityStatus"] =
        "NOT_APPLICABLE";
      if (selected && identity) {
        const key = discoveryKey(identity.reportCode, identity.fightId);
        duplicateIdentityStatus =
          (identityCounts.get(key) ?? 0) > 1 ? "DUPLICATE" : "UNIQUE";
        if (duplicateIdentityStatus === "DUPLICATE") {
          integrityFailures.push(`DUPLICATE_IDENTITY:${key}`);
        }
      }

      const slotFactRefs = input.factSets.filter(
        (f) => slotRow && f.manifestSlotId === slotRow.id,
      );
      const computedFactSetBindingHash =
        slotFactRefs.length > 0
          ? buildSlotFactSetBindingHash(
              slotFactRefs.map((f) => ({
                extractorFamily: f.extractorFamily,
                extractorVersion: f.extractorVersion,
                inputFingerprint: f.inputFingerprint,
              })),
            )
          : null;

      const eventDatasets = auditEventDatasetsForSlot({
        selected,
        manifestSlotId: slotRow?.id ?? null,
        identity: completeIdentity
          ? {
              reportCode: identity!.reportCode,
              fightId: identity!.fightId,
              reportRevision: identity!.reportRevision,
            }
          : null,
        datasets: input.datasets,
        pagesByIdentity: input.pagesByIdentity,
      });

      const masterHit =
        completeIdentity
          ? input.masterDataByIdentity.find(
              (m) =>
                m.reportCode === identity!.reportCode &&
                m.fightId === identity!.fightId &&
                m.reportRevision === identity!.reportRevision,
            )
          : null;

      const masterData =
        !selected
          ? null
          : {
              present: masterHit != null && masterHit.masterDataArtifactId != null,
              reportCode: identity?.reportCode ?? null,
              fightId: identity?.fightId ?? null,
              reportRevision: identity?.reportRevision ?? null,
              masterDataArtifactId: masterHit?.masterDataArtifactId ?? null,
              digestId: masterHit?.digestId ?? null,
              contentFingerprint: masterHit?.contentFingerprint ?? null,
              persistenceState: (masterHit?.masterDataArtifactId
                ? "PRESENT"
                : "MISSING") as DatasetPersistenceState,
              integrityErrors:
                selected && !masterHit?.masterDataArtifactId
                  ? ["MASTER_DATA_MISSING"]
                  : [],
            };

      const perfFact = slotFactRefs.find(
        (f) => f.extractorFamily.toLowerCase() === "performance",
      );
      const rankingDescriptor = slotRow
        ? input.datasets.find(
            (d) =>
              d.manifestSlotId === slotRow.id &&
              (d.datasetKey.toLowerCase() === "ranking_parse" ||
                d.datasetKey.toLowerCase() === "rankingparse"),
          )
        : null;
      const rankingParse = !selected
        ? null
        : (() => {
            const reasons =
              slotRow?.dimensionValidityReasons ??
              manifestSlot?.dimensionValidity?.reasons ??
              [];
            const durable = parseDurableOutcomeFromReasons("PERFORMANCE", reasons);
            if (!perfFact) {
              const outcome = durable?.outcome ?? "FAILED";
              const provenance = reasons.filter((r) =>
                /PERFORMANCE|RANKING_PARSE/i.test(r),
              );
              return {
                present: false,
                logicalOutcome: outcome as FactSourceOutcome,
                semantic: null,
                factSetId: null,
                inputFingerprint: null,
                reason: durable?.reason ?? null,
                category: null,
                unavailableProvenance: provenance,
                limitations: provenance.slice(0, 8),
                persistenceState: (outcome === "FAILED"
                  ? "FAILED"
                  : "UNAVAILABLE") as DatasetPersistenceState,
                descriptorPresent: rankingDescriptor != null,
                integrityErrors:
                  durable == null
                    ? ["RANKING_PARSE_MISSING_WITHOUT_DURABLE_PROVENANCE"]
                    : [],
              };
            }
            const parsed = parsePerformanceRunParseFactV2(perfFact.facts);
            const lim = limitationsList(perfFact.limitations);
            const logicalOutcome: FactSourceOutcome =
              parsed.ok && parsed.fact.semantic === "UNAVAILABLE"
                ? "UNAVAILABLE"
                : parsed.ok
                  ? "WRITTEN"
                  : "FAILED";
            return {
              present: true,
              logicalOutcome,
              semantic: parsed.ok ? parsed.fact.semantic : null,
              factSetId: perfFact.id,
              inputFingerprint: perfFact.inputFingerprint,
              reason: durable?.reason ?? null,
              category: null,
              unavailableProvenance: lim.filter((l) =>
                /unavailable|ranking_parse/i.test(l),
              ),
              limitations: lim.slice(0, 8),
              persistenceState: (logicalOutcome === "UNAVAILABLE"
                ? "UNAVAILABLE"
                : logicalOutcome === "FAILED"
                  ? "FAILED"
                  : "PRESENT") as DatasetPersistenceState,
              descriptorPresent: rankingDescriptor != null,
              integrityErrors: [
                ...(parsed.ok ? [] : ["RANKING_PARSE_FACT_INVALID"]),
                ...(rankingDescriptor == null && logicalOutcome === "WRITTEN"
                  ? ["RANKING_PARSE_DESCRIPTOR_MISSING"]
                  : []),
              ],
            };
          })();

      const factSets = auditFactSetsForSlot({
        selected,
        slot: manifestSlot,
        manifestSlotId: slotRow?.id ?? null,
        factSets: input.factSets,
        enabledFamilies,
        dimensionValidityReasons:
          slotRow?.dimensionValidityReasons ??
          manifestSlot?.dimensionValidity?.reasons ??
          [],
        artifactsById: input.artifactsById,
      });

      const slotErrors: string[] = [];
      for (const ds of eventDatasets) slotErrors.push(...ds.integrityErrors);
      if (masterData) slotErrors.push(...masterData.integrityErrors);
      if (rankingParse) slotErrors.push(...rankingParse.integrityErrors);
      for (const fs of factSets) {
        if (fs.limitations.includes("FACT_IDENTITY_MISMATCH")) {
          slotErrors.push("FACT_IDENTITY_MISMATCH");
        }
        if (fs.limitations.some((l) => l.startsWith("MISSING_ARTIFACT_REFS"))) {
          slotErrors.push("MISSING_ARTIFACT_REFS");
        }
        if (fs.identityMatchAgainstManifest === false) {
          slotErrors.push("FACT_DOC_IDENTITY_MISMATCH");
        }
        if (fs.hashMatchAgainstManifest === false && selected) {
          slotErrors.push("FACT_SET_HASH_MISMATCH");
        }
        if (
          selected &&
          !fs.runFactSetPresent &&
          fs.sourceOutcome === "FAILED" &&
          fs.limitations.includes("missing_run_fact_set_without_durable_provenance")
        ) {
          slotErrors.push(`MISSING_FACT_PROVENANCE:${fs.extractorFamily}`);
        }
      }

      let slotAuditState: SlotAuditState;
      if (!manifestSlot && !slotRow) {
        slotAuditState = "UNAVAILABLE";
      } else if (!selected) {
        slotAuditState = "UNAVAILABLE";
      } else if (slotErrors.length > 0 || frozenIdentityCompleteness === "INCOMPLETE") {
        slotAuditState = slotErrors.some((e) => /MISMATCH|DUPLICATE|BROKEN/i.test(e))
          ? "BROKEN"
          : "PARTIAL";
      } else {
        const requiredMissing = eventDatasets.some(
          (d) => d.required && (d.persistenceState === "MISSING" || d.persistenceState === "FAILED"),
        );
        const factsMissing = factSets.some(
          (f) =>
            (f.extractorFamily === "SURVIVAL" || f.extractorFamily === "UTILITY") &&
            !f.runFactSetPresent,
        );
        if (requiredMissing || factsMissing) slotAuditState = "PARTIAL";
        else slotAuditState = "COMPLETE";
      }

      slots.push({
        dungeonSlug,
        slotIndex,
        slotId: manifestSlot?.slotId ?? null,
        manifestSlotRowId: slotRow?.id ?? null,
        slotState: (manifestSlot?.state as EvidenceAuditSlot["slotState"]) ?? null,
        reportCode: identity?.reportCode ?? slotRow?.reportCode ?? null,
        fightId: identity?.fightId ?? slotRow?.fightId ?? null,
        reportRevision: identity?.reportRevision ?? slotRow?.reportRevision ?? null,
        keyLevel: manifestSlot?.keyLevel ?? slotRow?.keyLevel ?? null,
        selectionReason: slotRow?.selectionReason ?? null,
        selectedRank: manifestSlot?.selectedRank ?? slotRow?.candidateRank ?? null,
        fallbackReason: manifestSlot?.fallbackReason ?? null,
        frozenIdentityCompleteness,
        duplicateIdentityStatus,
        manifestFactSetHash: manifestSlot?.factSetHash ?? null,
        computedFactSetBindingHash,
        slotAuditState,
        eventDatasets,
        masterData,
        rankingParse,
        factSets,
        integrityErrors: slotErrors,
      });
    }
  }

  // Ensure exactly expectedSlotCount audited (pad UNAVAILABLE if dungeon list short)
  while (slots.length < expectedSlotCount) {
    const idx = slots.length;
    slots.push({
      dungeonSlug: `missing-dungeon-${Math.floor(idx / 2)}`,
      slotIndex: (idx % 2) as 0 | 1,
      slotId: null,
      manifestSlotRowId: null,
      slotState: null,
      reportCode: null,
      fightId: null,
      reportRevision: null,
      keyLevel: null,
      selectionReason: null,
      selectedRank: null,
      fallbackReason: null,
      frozenIdentityCompleteness: "NOT_APPLICABLE",
      duplicateIdentityStatus: "NOT_APPLICABLE",
      manifestFactSetHash: null,
      computedFactSetBindingHash: null,
      slotAuditState: "UNAVAILABLE",
      eventDatasets: auditEventDatasetsForSlot({
        selected: false,
        manifestSlotId: null,
        identity: null,
        datasets: [],
        pagesByIdentity: [],
      }),
      masterData: null,
      rankingParse: null,
      factSets: auditFactSetsForSlot({
        selected: false,
        slot: null,
        manifestSlotId: null,
        factSets: [],
        enabledFamilies,
      }),
      integrityErrors: ["EXPECTED_SLOT_MISSING"],
    });
  }

  // Dimension consumption + feature usage
  const survivalDocs = input.factSets
    .filter((f) => f.extractorFamily.toLowerCase() === "survival")
    .map((f) => parseSurvivalFactDocumentV2(f.facts))
    .filter((p): p is { ok: true; document: SurvivalFactDocumentV2 } => p.ok)
    .map((p) => p.document);

  const utilityDocs = input.factSets
    .filter((f) => f.extractorFamily.toLowerCase() === "utility")
    .map((f) => parseUtilityFact(f.facts))
    .filter((u): u is UtilityV2RunFactSet => u != null);

  const perfDocs = input.factSets
    .filter((f) => f.extractorFamily.toLowerCase() === "performance")
    .map((f) => parsePerformanceRunParseFactV2(f.facts))
    .filter((p): p is { ok: true; fact: PerformanceRunParseFactV2 } => p.ok)
    .map((p) => p.fact);

  const perfProvenance = [
    ...new Set(
      slots.flatMap((s) => s.rankingParse?.unavailableProvenance ?? []),
    ),
  ];

  // Prefer DimensionComputation.metrics.featureUsage (scorer-owned traces).
  // Fallback rebuild marks features consumed for display only when metrics lack featureUsage.
  const survivalFromMetrics = featureUsageFromMetrics(
    input.dimensions.find((d) => d.dimension === "SURVIVAL")?.metrics,
  );
  const utilityFromMetrics = featureUsageFromMetrics(
    input.dimensions.find((d) => d.dimension === "UTILITY")?.metrics,
  );
  const performanceFromMetrics = featureUsageFromMetrics(
    input.dimensions.find((d) => d.dimension === "PERFORMANCE")?.metrics,
  );

  const survivalMode =
    (input.dimensions.find((d) => d.dimension === "SURVIVAL")?.metrics as
      | { relativeDamageMode?: "off" | "shadow" | "active" }
      | undefined)?.relativeDamageMode ?? "shadow";

  const survivalFallbackTraces =
    survivalDocs.length === 0
      ? emitSurvivalConsumptionTraces({
          scoredRuns: [],
          relativeDamageMode: survivalMode,
          hasScore: false,
        })
      : getFeatureRegistryV2()
          .features.filter((f) => f.dimension === "SURVIVAL")
          .map((f) => ({
            featurePath: f.featurePath,
            kind: f.scoringRole === "SCORE" ? ("SCORE" as const) : ("CONFIDENCE" as const),
            outputField: f.outputMetricOrExplanationField,
            exclusionReason: null as string | null,
          }));

  const survivalUsage = buildSurvivalFeatureUsage(survivalDocs, {
    relativeDamageMode: survivalMode,
    consumptionTraces: survivalFallbackTraces,
  });

  const utilityFallbackTraces =
    utilityDocs.length === 0
      ? emitUtilityConsumptionTraces({
          boundFactSets: [],
          result: {
            availabilityState: "UNAVAILABLE",
            domainBreakdown: [],
          } as never,
        })
      : getFeatureRegistryV2()
          .features.filter((f) => f.dimension === "UTILITY")
          .map((f) => ({
            featurePath: f.featurePath,
            kind: f.scoringRole === "SCORE" ? ("SCORE" as const) : ("CONFIDENCE" as const),
            outputField: f.outputMetricOrExplanationField,
            exclusionReason: null as string | null,
          }));

  const utilityUsage = buildUtilityFeatureUsage(utilityDocs, {
    consumptionTraces: utilityFallbackTraces,
  });

  const performanceFallbackTraces =
    perfDocs.length === 0
      ? emitPerformanceConsumptionTraces({
          runParseFacts: [],
          hasProfileAggregate: false,
          hasScore: false,
          unavailableProvenance: perfProvenance,
        })
      : getFeatureRegistryV2()
          .features.filter((f) => f.dimension === "PERFORMANCE")
          .map((f) => ({
            featurePath: f.featurePath,
            kind: f.scoringRole === "SCORE" ? ("SCORE" as const) : ("CONFIDENCE" as const),
            outputField: f.outputMetricOrExplanationField,
            exclusionReason: null as string | null,
          }));

  const performanceUsage = buildPerformanceFeatureUsage(perfDocs, {
    unavailableProvenance: perfProvenance,
    consumptionTraces: performanceFallbackTraces,
  });

  // Integrity for feature consumption comes from persisted DimensionComputation metrics.
  for (const entry of [
    ...(survivalFromMetrics ?? []),
    ...(utilityFromMetrics ?? []),
    ...(performanceFromMetrics ?? []),
  ]) {
    if (
      entry.scoringRole === "SCORE" &&
      entry.exclusionReason === "SCORE_FEATURE_NOT_CONSUMED"
    ) {
      integrityFailures.push(`SCORE_FEATURE_NOT_CONSUMED:${entry.featurePath}`);
    }
  }

  const scoreModelIds = [
    ...new Set(
      input.dimensions
        .map((d) => d.scoreModelId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (scoreModelIds.length > 1) {
    integrityFailures.push(`MIXED_SCORE_MODEL_IDS:${scoreModelIds.join(",")}`);
  }

  const dimensionConsumption: EvidenceAuditDimensionConsumption[] = (
    ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as const
  ).map((dimension) => {
    if (dimension === "EXPERIENCE") {
      return {
        dimension,
        auditScope: "OUT_OF_SCOPE" as const,
        computationPresent: false,
        score: null,
        confidence: null,
        availabilityState: null,
        inputFingerprint: null,
        featureUsage: [],
        integrityErrors: [],
      };
    }
    const row = input.dimensions.find((d) => d.dimension === dimension);
    const fromMetrics = row ? featureUsageFromMetrics(row.metrics) : null;
    let featureUsage = fromMetrics ?? [];
    if (dimension === "SURVIVAL") featureUsage = fromMetrics ?? survivalUsage.featureUsage;
    if (dimension === "UTILITY") featureUsage = fromMetrics ?? utilityUsage.featureUsage;
    if (dimension === "PERFORMANCE") {
      featureUsage = fromMetrics ?? performanceUsage.featureUsage;
    }
    const dimErrors: string[] = [];
    if (row && row.manifestId !== input.manifestId) {
      dimErrors.push("REFERENCES_OTHER_MANIFEST");
    }
    return {
      dimension,
      auditScope: "AUDITED" as const,
      computationPresent: row != null,
      score: row?.score ?? null,
      confidence: row?.confidence ?? null,
      availabilityState: row?.state ?? null,
      inputFingerprint: row?.inputFingerprint ?? null,
      featureUsage,
      integrityErrors: dimErrors,
    };
  });

  const matrix: EvidenceAuditMatrixRow[] = slots.map((slot) => {
    const survival = slot.factSets.find((f) => f.extractorFamily === "SURVIVAL");
    const utility = slot.factSets.find((f) => f.extractorFamily === "UTILITY");
    const performance = slot.factSets.find((f) => f.extractorFamily === "PERFORMANCE");
    const datasetStates = slot.eventDatasets.map((d) =>
      d.persistenceState === "PRESENT" || d.persistenceState === "ZERO_EVENT"
        ? ("COMPLETE" as SlotAuditState)
        : d.persistenceState === "MISSING" || d.persistenceState === "UNAVAILABLE"
          ? ("UNAVAILABLE" as SlotAuditState)
          : ("PARTIAL" as SlotAuditState),
    );
    const rankingOutcome = slot.rankingParse?.logicalOutcome ?? "N/A";
    return {
      dungeonSlug: slot.dungeonSlug,
      slotIndex: slot.slotIndex,
      source:
        slot.slotState === "SELECTED"
          ? "SELECTED"
          : slot.slotAuditState === "UNAVAILABLE"
            ? "MISSING"
            : slot.slotState?.startsWith("MISSING") || slot.slotState?.startsWith("INVALID")
              ? "INVALID"
              : "OTHER",
      wclSource:
        slot.reportCode != null && slot.fightId != null
          ? `${slot.reportCode}#${slot.fightId}`
          : null,
      datasets: mergeSlotAuditState(
        datasetStates.length > 0 ? datasetStates : ["UNAVAILABLE"],
      ),
      ranking:
        rankingOutcome === "WRITTEN" ||
        rankingOutcome === "UNAVAILABLE" ||
        rankingOutcome === "FAILED" ||
        rankingOutcome === "NOT_ENABLED"
          ? rankingOutcome
          : "N/A",
      survivalFacts: slotMatrixStatus(survival),
      utilityFacts: slotMatrixStatus(utility),
      performance: slotMatrixDimStatus(performance),
      survival: slotMatrixDimStatus(survival),
      utility: slotMatrixDimStatus(utility),
      experience: "OUT_OF_SCOPE",
      auditState: slot.slotAuditState,
    };
  });

  const registry = getFeatureRegistryV2();

  return {
    schemaVersion: EVIDENCE_AUDIT_V2_SCHEMA_VERSION,
    featureRegistryVersion: FEATURE_REGISTRY_V2_VERSION,
    auditedAt,
    manifestId: input.manifestId,
    characterId: input.characterId,
    seasonId: input.seasonId,
    manifestContentHash: manifest?.contentHash ?? "invalid",
    expectedSlotCount,
    selectedSlotCount: manifest?.selectedSlotCount ?? input.selectedSlotCount,
    coverageState: manifest?.coverage.state ?? input.coverageState,
    slots: slots.slice(0, Math.max(expectedSlotCount, slots.length)),
    featureRegistry: registry.features,
    dimensionConsumption,
    matrix,
    replay: input.replay ?? null,
    integrityFailures: [...new Set(integrityFailures)],
    providerCallCount: 0,
  };
}

/** Stable fingerprint of explanation+metrics for replay comparison. */
export function fingerprintExplanationMetrics(
  metrics: unknown,
  explanation: unknown,
): string {
  const payload = JSON.stringify({ metrics: metrics ?? {}, explanation: explanation ?? {} });
  return createHash("sha256").update(payload).digest("hex");
}

export type { EvidenceDatasetKind };
