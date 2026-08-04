/**
 * Provider-free Scoring V2 evidence audit builder.
 * Produces a bounded downloadable JSON document for one frozen EvidenceManifest.
 */

import { createHash } from "node:crypto";
import type {
  CharacterSeasonEvidenceManifestV2,
  DatasetPersistenceState,
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
import { EXPECTED_EVENT_DATASETS, datasetKindFromPersistedKey } from "./dataset-catalog.js";
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
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  dungeonSlug: string | null;
  slotIndex: number | null;
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
  /** Optional precomputed replay result. */
  replay?: EvidenceAuditReplayResult | null;
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

function auditFactSetsForSlot(input: {
  selected: boolean;
  slot: CharacterSeasonEvidenceManifestV2["slots"][number] | null;
  manifestSlotId: string | null;
  factSets: AuditFactSetInput[];
  enabledFamilies: Array<"PERFORMANCE" | "SURVIVAL" | "UTILITY">;
}): EvidenceAuditFactSetEntry[] {
  const slotFacts = input.manifestSlotId
    ? input.factSets.filter((f) => f.manifestSlotId === input.manifestSlotId)
    : [];

  const identity = input.slot?.identity ?? null;
  const expectedHash = input.slot?.factSetHash ?? null;

  return input.enabledFamilies.map((family) => {
    const familyLower = family.toLowerCase();
    const row =
      slotFacts.find((f) => f.extractorFamily.toLowerCase() === familyLower) ?? null;

    if (!input.selected) {
      return {
        extractorFamily: family,
        runFactSetPresent: false,
        extractorVersion: null,
        schemaVersion: null,
        inputFingerprint: null,
        reportCode: null,
        fightId: null,
        reportRevision: null,
        manifestSlotId: input.manifestSlotId,
        artifactReferences: [],
        coverage: null,
        limitations: [],
        parserValidation: "UNAVAILABLE" as const,
        sourceOutcome: "UNAVAILABLE" as FactSourceOutcome,
        boundedFactsSummary: null,
        hashMatchAgainstManifest: null,
      };
    }

    if (!row) {
      return {
        extractorFamily: family,
        runFactSetPresent: false,
        extractorVersion: null,
        schemaVersion: null,
        inputFingerprint: null,
        reportCode: identity?.reportCode ?? null,
        fightId: identity?.fightId ?? null,
        reportRevision: identity?.reportRevision ?? null,
        manifestSlotId: input.manifestSlotId,
        artifactReferences: [],
        coverage: null,
        limitations: ["missing_run_fact_set"],
        parserValidation: "UNAVAILABLE" as const,
        sourceOutcome: "UNAVAILABLE" as FactSourceOutcome,
        boundedFactsSummary: null,
        hashMatchAgainstManifest: expectedHash == null ? null : false,
      };
    }

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
        // Structured unavailable without full parse doc is still an explicit outcome.
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

    // Identity binding check
    if (
      identity &&
      (row.reportCode !== identity.reportCode ||
        row.fightId !== identity.fightId ||
        row.reportRevision !== identity.reportRevision)
    ) {
      // Wrong binding — fail closed in summary limitations.
      const lim = limitationsList(row.limitations);
      lim.push("FACT_IDENTITY_MISMATCH");
      return {
        extractorFamily: family,
        runFactSetPresent: true,
        extractorVersion: row.extractorVersion,
        schemaVersion: row.schemaVersion,
        inputFingerprint: row.inputFingerprint,
        reportCode: row.reportCode,
        fightId: row.fightId,
        reportRevision: row.reportRevision,
        manifestSlotId: row.manifestSlotId,
        artifactReferences: [],
        coverage: isRecord(row.coverage) ? row.coverage : null,
        limitations: lim,
        parserValidation: "INVALID",
        sourceOutcome: "FAILED",
        boundedFactsSummary: summary,
        hashMatchAgainstManifest: false,
      };
    }

    return {
      extractorFamily: family,
      runFactSetPresent: true,
      extractorVersion: row.extractorVersion,
      schemaVersion: row.schemaVersion,
      inputFingerprint: row.inputFingerprint,
      reportCode: row.reportCode,
      fightId: row.fightId,
      reportRevision: row.reportRevision,
      manifestSlotId: row.manifestSlotId,
      artifactReferences: [],
      coverage: isRecord(row.coverage) ? row.coverage : null,
      limitations: limitationsList(row.limitations),
      parserValidation,
      sourceOutcome,
      boundedFactsSummary: summary,
      hashMatchAgainstManifest: hashMatch,
    };
  });
}

function slotMatrixStatus(
  fact: EvidenceAuditFactSetEntry | undefined,
): "OK" | "PARTIAL" | "UNAVAILABLE" | "N/A" {
  if (!fact) return "N/A";
  if (fact.sourceOutcome === "UNAVAILABLE" || !fact.runFactSetPresent) return "UNAVAILABLE";
  if (fact.sourceOutcome === "FAILED" || fact.parserValidation === "INVALID") return "PARTIAL";
  if (fact.hashMatchAgainstManifest === false) return "PARTIAL";
  return "OK";
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
    const factRefs: PersistedFactSetRef[] = input.factSets.map((f) => ({
      extractorFamily: f.extractorFamily,
      extractorVersion: f.extractorVersion,
      schemaVersion: f.schemaVersion,
      inputFingerprint: f.inputFingerprint,
      facts: f.facts,
      limitations: f.limitations,
      manifestSlotId: f.manifestSlotId,
      reportCode: f.reportCode,
      fightId: f.fightId,
      reportRevision: f.reportRevision,
      dungeonSlug: f.dungeonSlug,
      slotIndex: f.slotIndex,
    }));
    const hashCheck = verifyFactSetHashesAgainstManifest(manifest, factRefs);
    if (!hashCheck.ok) {
      integrityFailures.push(`FACT_SET_HASH_MISMATCH:${hashCheck.reason}`);
    }
  }

  // Reject facts from unselected runs (wrong report/fight/revision identity).
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
      const key = identityKey(fs.reportCode, fs.fightId, fs.reportRevision);
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
      const rankingParse = !selected
        ? null
        : (() => {
            if (!perfFact) {
              const provenance =
                manifestSlot?.dimensionValidity?.reasons?.filter((r) =>
                  /PERFORMANCE|RANKING_PARSE/i.test(r),
                ) ?? [];
              return {
                present: false,
                semantic: null,
                factSetId: null,
                inputFingerprint: null,
                unavailableProvenance: provenance,
                persistenceState: "UNAVAILABLE" as DatasetPersistenceState,
                integrityErrors: [],
              };
            }
            const parsed = parsePerformanceRunParseFactV2(perfFact.facts);
            const lim = limitationsList(perfFact.limitations);
            return {
              present: true,
              semantic: parsed.ok ? parsed.fact.semantic : null,
              factSetId: perfFact.id,
              inputFingerprint: perfFact.inputFingerprint,
              unavailableProvenance: lim.filter((l) =>
                /unavailable|ranking_parse/i.test(l),
              ),
              persistenceState: (parsed.ok && parsed.fact.semantic === "UNAVAILABLE"
                ? "UNAVAILABLE"
                : parsed.ok
                  ? "PRESENT"
                  : "FAILED") as DatasetPersistenceState,
              integrityErrors: parsed.ok ? [] : ["RANKING_PARSE_FACT_INVALID"],
            };
          })();

      const factSets = auditFactSetsForSlot({
        selected,
        slot: manifestSlot,
        manifestSlotId: slotRow?.id ?? null,
        factSets: input.factSets,
        enabledFamilies,
      });

      const slotErrors: string[] = [];
      for (const ds of eventDatasets) slotErrors.push(...ds.integrityErrors);
      if (masterData) slotErrors.push(...masterData.integrityErrors);
      if (rankingParse) slotErrors.push(...rankingParse.integrityErrors);
      for (const fs of factSets) {
        if (fs.limitations.includes("FACT_IDENTITY_MISMATCH")) {
          slotErrors.push("FACT_IDENTITY_MISMATCH");
        }
        if (fs.hashMatchAgainstManifest === false && selected) {
          slotErrors.push("FACT_SET_HASH_MISMATCH");
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

  const survivalUsage = buildSurvivalFeatureUsage(survivalDocs);
  const utilityUsage = buildUtilityFeatureUsage(utilityDocs);
  const performanceUsage = buildPerformanceFeatureUsage(perfDocs, {
    unavailableProvenance: perfProvenance,
  });
  integrityFailures.push(
    ...survivalUsage.integrityFailures,
    ...utilityUsage.integrityFailures,
    ...performanceUsage.integrityFailures,
  );

  const dimensionConsumption: EvidenceAuditDimensionConsumption[] = (
    ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as const
  ).map((dimension) => {
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
    const factStates = slot.factSets.map((f) => {
      if (!f.runFactSetPresent) return "UNAVAILABLE" as SlotAuditState;
      if (f.sourceOutcome === "FAILED") return "BROKEN" as SlotAuditState;
      if (f.sourceOutcome === "UNAVAILABLE") return "UNAVAILABLE" as SlotAuditState;
      return "COMPLETE" as SlotAuditState;
    });
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
      datasets: mergeSlotAuditState(
        datasetStates.length > 0 ? datasetStates : ["UNAVAILABLE"],
      ),
      facts: mergeSlotAuditState(factStates.length > 0 ? factStates : ["UNAVAILABLE"]),
      survival: slotMatrixStatus(survival),
      utility: slotMatrixStatus(utility),
      performance: slotMatrixStatus(performance),
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
