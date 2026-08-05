/**
 * Provider-free Scoring V2 evidence audit + feature lineage tests.
 * Includes an in-memory 8-dungeon / 16-slot harness (no provider calls).
 */
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  scoringV2EvidenceAuditDocumentSchema,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceAcquisitionPlanV2,
  type EvidenceCandidateAcquisitionResult,
  type EvidenceCandidateMetadataV2,
  type EvidenceSelectionScope,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
  buildSlotFactSetBindingHash,
  buildScoringV2EvidenceAudit,
  fingerprintExplanationMetrics,
  getFeatureRegistryV2,
  identityValidFactSets,
  replayScoringV2Dimensions,
  finalizeShadowDimensions,
  EXPECTED_EVENT_DATASETS,
  SURVIVAL_V2_SCHEMA_VERSION,
  emptyUtilityV2FactSet,
  type SurvivalFactDocumentV2,
  type PersistedFactSetRef,
} from "../index.js";

const DUNGEONS = [
  "ara-kara",
  "dawnbreaker",
  "priory",
  "rookery",
  "floodgate",
  "eco-dome",
  "city-of-threads",
  "windrunner-spire",
] as const;

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function baseScope(): EvidenceSelectionScope {
  return {
    characterId: "char-audit-1",
    seasonId: "season-audit-1",
    seasonSlug: "tww-s3",
    specializationId: "spec-1",
    classSlug: "warlock",
    specSlug: "affliction",
    role: "DPS",
    refreshContractHash: "refresh-audit",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    highKeyPolicyId: "high-key-v1",
    activeDungeonSlugs: [...DUNGEONS],
  };
}

function candidate(
  overrides: Partial<EvidenceCandidateMetadataV2> & {
    reportCode: string;
    fightId: number;
    dungeonSlug: string;
    keyLevel: number;
  },
): EvidenceCandidateMetadataV2 {
  const { reportCode, fightId, dungeonSlug, keyLevel, ...rest } = overrides;
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision: rest.reportRevision !== undefined ? rest.reportRevision : null,
    dungeonSlug,
    keyLevel,
    timed: rest.timed !== undefined ? rest.timed : true,
    runScore: rest.runScore !== undefined ? rest.runScore : 400,
    evidenceCompleteness: rest.evidenceCompleteness ?? 1,
    completedAt: rest.completedAt !== undefined ? rest.completedAt : "2026-07-01T12:00:00.000Z",
    fightDurationMs: rest.fightDurationMs !== undefined ? rest.fightDurationMs : 1_800_000,
    actorId: rest.actorId !== undefined ? rest.actorId : 10,
    accessState: rest.accessState ?? "PUBLIC",
    identityResolution: rest.identityResolution ?? "RESOLVED",
    fightAccessible: rest.fightAccessible ?? true,
    hardError: rest.hardError ?? false,
  };
}

function acquireFromPlan(
  plan: EvidenceAcquisitionPlanV2,
  skipSlotId?: string,
): EvidenceCandidateAcquisitionResult[] {
  const seen = new Set<string>();
  const results: EvidenceCandidateAcquisitionResult[] = [];
  for (const slot of plan.slots) {
    if (skipSlotId && slot.slotId === skipSlotId) continue;
    for (const attempt of slot.orderedCandidates) {
      const key = `${attempt.discoveryIdentity.reportCode}:${attempt.discoveryIdentity.fightId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const factMembers = [
        {
          extractorFamily: "survival",
          extractorVersion: "survival-facts-v2.0.0",
          inputFingerprint: sha(`surv-${key}`),
        },
        {
          extractorFamily: "utility",
          extractorVersion: "utility-v2.0.0",
          inputFingerprint: sha(`util-${key}`),
        },
        {
          extractorFamily: "performance",
          extractorVersion: "performance-facts-v2.0.0",
          inputFingerprint: sha(`perf-${key}`),
        },
      ];
      results.push({
        discoveryIdentity: { ...attempt.discoveryIdentity },
        acquisitionStatus: "ACQUIRED",
        reportRevision: 1,
        rejectionReason: null,
        rejectionDetail: null,
        datasetHashes: EXPECTED_EVENT_DATASETS.map((d) => ({
          dataset: d.kind,
          contentHash: sha(`${d.kind}-${key}`),
        })),
        factSetHash: buildSlotFactSetBindingHash(factMembers),
        dimensionValidity: {
          performance: "VALID",
          survival: "VALID",
          utility: "VALID",
          reasons: [],
        },
        keyLevel: attempt.keyLevel,
        timed: attempt.timed,
        runScore: attempt.runScore,
        completedAt: attempt.completedAt,
        actorId: attempt.actorId,
        evidenceCompleteness: attempt.evidenceCompleteness,
      });
    }
  }
  return results;
}

function survivalFact(
  slot: CharacterSeasonEvidenceManifestV2["slots"][number],
): SurvivalFactDocumentV2 {
  const identity = slot.identity!;
  return {
    schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
    extractorFamily: "survival",
    extractorVersion: "survival-facts-v2.0.0",
    dungeonSlug: slot.dungeonSlug,
    slotIndex: slot.slotIndex,
    identity: {
      reportCode: identity.reportCode,
      fightId: identity.fightId,
      reportRevision: identity.reportRevision,
    },
    keyLevel: slot.keyLevel,
    deaths: { count: slot.slotIndex },
    activeCombat: { durationMs: 1_800_000, fightDurationMs: 2_000_000 },
    defensiveActivations: {
      byCategory: { DEFENSIVE_MAJOR: 2, DEFENSIVE_MINOR: 4 },
      toolkit: [
        { category: "DEFENSIVE_MAJOR", state: "AVAILABLE_CONFIRMED" },
        { category: "DEFENSIVE_MINOR", state: "AVAILABLE_CONFIRMED" },
      ],
      catalogCoverage: 0.9,
    },
    dangerWindows: [
      {
        startMs: 1000,
        endMs: 2000,
        triggerTypes: ["LOW_HP"],
        hpEvidenceQuality: "EXPLICIT",
        recoveryEligible: true,
        recoveryUseful: true,
      },
    ],
    healthEvidence: { mode: "FULL", catalogSelfHealCoverage: 0.8 },
    relativeDamage: null,
    limitations: [],
  };
}

function buildHarness(options?: { leaveWindrunnerSlot1Missing?: boolean }) {
  const leaveMissing = options?.leaveWindrunnerSlot1Missing ?? true;
  const candidates = DUNGEONS.flatMap((dungeonSlug, di) => {
    const base = di * 10;
    // Windrunner Spire: only one distinct candidate when leaveMissing
    if (leaveMissing && dungeonSlug === "windrunner-spire") {
      return [
        candidate({
          reportCode: `WR${String(base).padStart(4, "0")}`,
          fightId: base + 1,
          dungeonSlug,
          keyLevel: 14,
        }),
      ];
    }
    return [
      candidate({
        reportCode: `R${String(base).padStart(4, "0")}A`,
        fightId: base + 1,
        dungeonSlug,
        keyLevel: 16 - (di % 3),
      }),
      candidate({
        reportCode: `R${String(base).padStart(4, "0")}B`,
        fightId: base + 2,
        dungeonSlug,
        keyLevel: 14 - (di % 2),
      }),
    ];
  });

  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope: baseScope(),
    candidates,
    plannedAt: "2026-08-01T11:00:00.000Z",
  });

  const skipSlotId = leaveMissing ? "windrunner-spire:1" : undefined;
  const { manifest } = finalizeEvidenceManifestV2({
    plan,
    acquisitionResults: acquireFromPlan(plan, skipSlotId),
    selectedAt: "2026-08-01T12:00:00.000Z",
  });

  const selected = manifest.slots.filter((s) => s.state === "SELECTED");
  const slotRows = manifest.slots.map((s) => ({
    id: `slot-row-${s.slotId}`,
    dungeonSlug: s.dungeonSlug,
    slotIndex: s.slotIndex,
    state: s.state,
    reportCode: s.identity?.reportCode ?? null,
    fightId: s.identity?.fightId ?? null,
    reportRevision: s.identity?.reportRevision ?? null,
    keyLevel: s.keyLevel,
    selectionReason: s.state === "SELECTED" ? "preferred" : "missing",
    candidateRank: s.selectedRank,
  }));

  const datasets = [];
  const pagesByIdentity = [];
  const factSets: Array<{
    id: string;
    manifestSlotId: string;
    extractorFamily: string;
    extractorVersion: string;
    schemaVersion: string;
    inputFingerprint: string;
    facts: unknown;
    coverage: unknown;
    limitations: unknown;
    relationReportCode: string | null;
    relationFightId: number | null;
    relationReportRevision: number | null;
    dungeonSlug: string | null;
    slotIndex: number | null;
  }> = [];
  const masterDataByIdentity = [];

  for (const slot of selected) {
    const identity = slot.identity!;
    const rowId = `slot-row-${slot.slotId}`;
    const key = `${identity.reportCode}:${identity.fightId}`;

    masterDataByIdentity.push({
      reportCode: identity.reportCode,
      fightId: identity.fightId,
      reportRevision: identity.reportRevision,
      digestId: `digest-${key}`,
      masterDataArtifactId: `artifact-master-${key}`,
      contentFingerprint: sha(`master-${key}`),
    });

    for (const spec of EXPECTED_EVENT_DATASETS) {
      const contentHash = sha(`${spec.kind}-${key}-p0`);
      const page = {
        pageIndex: 0,
        artifactId: `artifact-${spec.kind}-${key}`,
        contentHash,
        eventCount: spec.kind === "HOSTILE_CASTS" ? 0 : 12,
        scopeFingerprint: "scope:actor-10",
        reportCode: identity.reportCode,
        fightId: identity.fightId,
        reportRevision: identity.reportRevision,
        datasetKey: spec.persistedKey,
      };
      pagesByIdentity.push(page);
      datasets.push({
        id: `ds-${spec.kind}-${key}`,
        manifestSlotId: rowId,
        datasetKey: spec.persistedKey,
        compatibilityKey: `${identity.reportCode}:${identity.fightId}:${identity.reportRevision}:${spec.kind}:wcl-graphql-v2-events`,
        artifactId: page.artifactId,
        schemaVersion: "1.0.0",
        providerContractVersion: "wcl-graphql-v2-events",
        state: "PERSISTED",
        eventCount: page.eventCount,
        pageCount: 1,
        truncated: false,
        payloadFingerprint: contentHash,
        pages: [page],
      });
    }

    const surv = survivalFact(slot);
    const util = emptyUtilityV2FactSet({
      slotId: slot.slotId,
      runId: key,
      dungeonSlug: slot.dungeonSlug,
      slotIndex: slot.slotIndex as 0 | 1,
      reportCode: identity.reportCode,
      fightId: identity.fightId,
      reportRevision: identity.reportRevision,
      keyLevel: slot.keyLevel,
      activeCombatMs: 1_800_000,
      hostileBegincastCount: 20,
      hostileObservability: "PRESENT",
      interruptAttempts: [
        {
          id: "int-1",
          timestampMs: 1000,
          abilityGameId: 2139,
          sourceActorId: 10,
          sourceKind: "PLAYER",
          targetActorId: 50,
          classification: "CONFIRMED_SUCCESS",
          credit: 1,
          note: "ok",
        },
      ],
    });
    const perf = {
      kind: "performance_run_parse_fact_v2",
      extractorFamily: "performance",
      extractorVersion: "performance-facts-v2.0.0",
      slotId: slot.slotId,
      dungeonSlug: slot.dungeonSlug,
      keyLevel: slot.keyLevel ?? 12,
      parsePercentile: 75,
      semantic: "BRACKET_PERCENT",
      partition: 1,
      rawDps: null,
      identity: {
        reportCode: identity.reportCode,
        fightId: identity.fightId,
        reportRevision: identity.reportRevision,
      },
      reportCode: identity.reportCode,
      fightId: identity.fightId,
      reportRevision: identity.reportRevision,
    };

    const members = [
      {
        family: "survival",
        version: "survival-facts-v2.0.0",
        schema: SURVIVAL_V2_SCHEMA_VERSION,
        fp: sha(`surv-${key}`),
        facts: surv,
      },
      {
        family: "utility",
        version: "utility-v2.0.0",
        schema: "utility-v2-facts",
        fp: sha(`util-${key}`),
        facts: util,
      },
      {
        family: "performance",
        version: "performance-facts-v2.0.0",
        schema: "performance-facts-v2.0.0",
        fp: sha(`perf-${key}`),
        facts: perf,
      },
    ];

    for (const m of members) {
      factSets.push({
        id: `fs-${m.family}-${key}`,
        manifestSlotId: rowId,
        extractorFamily: m.family,
        extractorVersion: m.version,
        schemaVersion: m.schema,
        inputFingerprint: m.fp,
        facts: m.facts,
        coverage: { artifactIds: [`artifact-${m.family}-${key}`] },
        limitations: [],
        relationReportCode: identity.reportCode,
        relationFightId: identity.fightId,
        relationReportRevision: identity.reportRevision,
        dungeonSlug: slot.dungeonSlug,
        slotIndex: slot.slotIndex,
      });
    }

    // RANKING_PARSE descriptor (no pages) — logical WRITTEN outcome.
    datasets.push({
      id: `ds-RANKING_PARSE-${key}`,
      manifestSlotId: rowId,
      datasetKey: "ranking_parse",
      compatibilityKey: `${identity.reportCode}:${identity.fightId}:${identity.reportRevision}:RANKING_PARSE:wcl-ranking-parse-v1`,
      artifactId: `artifact-ranking-${key}`,
      schemaVersion: "1.0.0",
      providerContractVersion: "wcl-ranking-parse-v1",
      state: "READY",
      eventCount: 1,
      pageCount: 0,
      truncated: false,
      payloadFingerprint: sha(`ranking-${key}`),
      pages: [],
    });
  }

  const artifactsById: Record<
    string,
    {
      id: string;
      provider: string | null;
      artifactClass: string | null;
      contentHash: string | null;
      byteLength: number | null;
      payloadReadability: "DB_PAYLOAD_READABLE";
    }
  > = {};
  const registerArtifact = (id: string, artifactClass: string, contentHash: string) => {
    artifactsById[id] = {
      id,
      provider: "WARCRAFTLOGS",
      artifactClass,
      contentHash,
      byteLength: 128,
      payloadReadability: "DB_PAYLOAD_READABLE",
    };
  };
  for (const page of pagesByIdentity) {
    if (page.artifactId) {
      registerArtifact(page.artifactId, "wcl_event_page", page.contentHash);
    }
  }
  for (const md of masterDataByIdentity) {
    if (md.masterDataArtifactId) {
      registerArtifact(md.masterDataArtifactId, "wcl_master_data", md.contentFingerprint);
    }
  }
  for (const ds of datasets) {
    if (ds.datasetKey === "ranking_parse" && ds.artifactId) {
      registerArtifact(ds.artifactId, "wcl-ranking-parse-v2", ds.payloadFingerprint ?? sha(ds.id));
    }
  }
  for (const fs of factSets) {
    const ids =
      typeof fs.coverage === "object" &&
      fs.coverage != null &&
      Array.isArray((fs.coverage as { artifactIds?: unknown }).artifactIds)
        ? ((fs.coverage as { artifactIds: string[] }).artifactIds)
        : [];
    for (const id of ids) {
      registerArtifact(id, "wcl_event_page", sha(id));
    }
  }

  const factRefs: PersistedFactSetRef[] = factSets.map((f) => ({
    extractorFamily: f.extractorFamily,
    extractorVersion: f.extractorVersion,
    schemaVersion: f.schemaVersion,
    inputFingerprint: f.inputFingerprint,
    facts: f.facts,
    limitations: f.limitations,
    manifestSlotId: f.manifestSlotId,
    reportCode: f.relationReportCode,
    fightId: f.relationFightId,
    reportRevision: f.relationReportRevision,
    dungeonSlug: f.dungeonSlug,
    slotIndex: f.slotIndex,
  }));

  const finalized = finalizeShadowDimensions({
    characterId: manifest.characterId,
    seasonId: manifest.seasonId,
    manifestId: "manifest-audit-1",
    scoreModelId: "model-audit-1",
    manifest,
    expectedManifestContentHash: manifest.contentHash,
    enabledDimensions: ["PERFORMANCE", "SURVIVAL", "UTILITY"],
    factSets: factRefs,
    experienceHistory: null,
    computedAt: new Date("2026-08-01T12:00:00.000Z"),
  });

  const dimensions = finalized.outcomes.map((o) => ({
    dimension: o.dimension,
    score: o.record.score,
    confidence: o.record.confidence,
    state: o.record.availabilityState,
    inputFingerprint: o.record.inputFingerprint,
    metrics: o.record.metrics,
    explanation: o.record.explanation,
    manifestId: "manifest-audit-1",
  }));

  const replay = replayScoringV2Dimensions({
    characterId: manifest.characterId,
    seasonId: manifest.seasonId,
    manifestId: "manifest-audit-1",
    scoreModelId: "model-audit-1",
    manifestDocument: manifest,
    expectedManifestContentHash: manifest.contentHash,
    factSets: factRefs,
    persistedDimensions: dimensions.map((d) => ({
      dimension: d.dimension,
      score: d.score,
      confidence: d.confidence,
      state: d.state,
      inputFingerprint: d.inputFingerprint,
      metrics: d.metrics,
      explanation: d.explanation,
    })),
  });

  const audit = buildScoringV2EvidenceAudit({
    manifestId: "manifest-audit-1",
    characterId: manifest.characterId,
    seasonId: manifest.seasonId,
    manifestDocument: manifest,
    coverageState: manifest.coverage.state,
    expectedSlotCount: manifest.expectedSlotCount,
    selectedSlotCount: manifest.selectedSlotCount,
    auditedAt: "2026-08-04T12:00:00.000Z",
    slotRows,
    datasets,
    factSets,
    dimensions,
    masterDataByIdentity,
    pagesByIdentity,
    artifactsById,
    replay,
  });

  return {
    manifest,
    audit,
    replay,
    factSets,
    finalized,
    datasets,
    pagesByIdentity,
    masterDataByIdentity,
    artifactsById,
  };
}

describe("feature registry v2", () => {
  it("declares Survival, Utility, and Performance features with scoring roles", () => {
    const reg = getFeatureRegistryV2();
    expect(reg.version).toBe("feature-registry-v2.0.0");
    expect(reg.features.some((f) => f.featurePath === "survival.deaths")).toBe(true);
    expect(reg.features.some((f) => f.featurePath === "utility.interruptAttempts.CONFIRMED_SUCCESS")).toBe(
      true,
    );
    expect(reg.features.some((f) => f.featurePath === "performance.parsePercentile")).toBe(true);
    for (const f of reg.features) {
      expect(["SCORE", "CONFIDENCE", "AVAILABILITY", "EXPLAINABILITY_ONLY"]).toContain(
        f.scoringRole,
      );
      expect(f.outputMetricOrExplanationField.length).toBeGreaterThan(0);
    }
  });
});

describe("16-slot evidence lineage harness", () => {
  it("audits all 16 slots with one explicit UNAVAILABLE windrunner-spire:1", () => {
    const { manifest, audit, replay } = buildHarness();

    expect(manifest.expectedSlotCount).toBe(16);
    expect(manifest.selectedSlotCount).toBe(15);
    expect(audit.slots).toHaveLength(16);
    expect(scoringV2EvidenceAuditDocumentSchema.safeParse(audit).success).toBe(true);

    const missing = audit.slots.find(
      (s) => s.dungeonSlug === "windrunner-spire" && s.slotIndex === 1,
    );
    expect(missing?.slotAuditState).toBe("UNAVAILABLE");
    expect(missing?.reportCode).toBeNull();

    const selected = audit.slots.filter((s) => s.slotState === "SELECTED");
    expect(selected).toHaveLength(15);
    for (const slot of selected) {
      expect(slot.frozenIdentityCompleteness).toBe("COMPLETE");
      expect(slot.duplicateIdentityStatus).toBe("UNIQUE");
      expect(slot.manifestFactSetHash).toBeTruthy();
      expect(slot.computedFactSetBindingHash).toBe(slot.manifestFactSetHash);

      const surv = slot.factSets.find((f) => f.extractorFamily === "SURVIVAL");
      const util = slot.factSets.find((f) => f.extractorFamily === "UTILITY");
      const perf = slot.factSets.find((f) => f.extractorFamily === "PERFORMANCE");
      expect(surv?.runFactSetPresent).toBe(true);
      expect(util?.runFactSetPresent).toBe(true);
      expect(perf?.runFactSetPresent).toBe(true);
      expect(surv?.hashMatchAgainstManifest).toBe(true);

      for (const ds of slot.eventDatasets.filter((d) => d.required)) {
        expect(["PRESENT", "ZERO_EVENT"]).toContain(ds.persistenceState);
      }
      expect(slot.masterData?.present).toBe(true);
    }

    const identities = new Set(
      selected.map((s) => `${s.reportCode}:${s.fightId}`),
    );
    expect(identities.size).toBe(15);

    const survival = audit.dimensionConsumption.find((d) => d.dimension === "SURVIVAL");
    const utility = audit.dimensionConsumption.find((d) => d.dimension === "UTILITY");
    const performance = audit.dimensionConsumption.find((d) => d.dimension === "PERFORMANCE");
    expect(survival?.featureUsage.some((f) => f.consumed && f.scoringRole === "SCORE")).toBe(
      true,
    );
    expect(utility?.featureUsage.some((f) => f.featurePath.includes("interrupt"))).toBe(true);
    expect(performance?.computationPresent).toBe(true);
    expect(performance?.auditScope).toBe("AUDITED");
    expect(
      audit.dimensionConsumption.find((d) => d.dimension === "EXPERIENCE")?.auditScope,
    ).toBe("OUT_OF_SCOPE");

    for (const slot of selected) {
      expect(slot.rankingParse?.logicalOutcome).toBe("WRITTEN");
      expect(slot.rankingParse?.descriptorPresent).toBe(true);
      const surv = slot.factSets.find((f) => f.extractorFamily === "SURVIVAL");
      expect(surv?.identityMatchAgainstManifest).toBe(true);
      expect(surv?.artifactReferences.length).toBeGreaterThan(0);
      expect(surv?.artifactReferences[0]?.contentHash).toBeTruthy();
    }

    expect(audit.matrix.every((r) => r.experience === "OUT_OF_SCOPE")).toBe(true);
    expect(audit.matrix.filter((r) => r.source === "SELECTED").every((r) => r.ranking === "WRITTEN")).toBe(
      true,
    );

    expect(audit.providerCallCount).toBe(0);
    expect(replay.providerCallCount).toBe(0);
    expect(replay.scoreMatch).toBe(true);
    expect(replay.inputFingerprintMatch).toBe(true);
    expect(replay.deterministicMatch).toBe(true);

    expect(audit.matrix).toHaveLength(16);
    expect(audit.matrix.some((r) => r.auditState === "UNAVAILABLE")).toBe(true);
  });

  it("fails closed when a payload fingerprint changes without matching pages", () => {
    const { audit: base } = buildHarness({ leaveWindrunnerSlot1Missing: false });
    expect(base.slots.filter((s) => s.slotState === "SELECTED")).toHaveLength(16);

    const { manifest, factSets } = buildHarness({ leaveWindrunnerSlot1Missing: false });
    const slotRows = manifest.slots.map((s) => ({
      id: `slot-row-${s.slotId}`,
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex,
      state: s.state,
      reportCode: s.identity?.reportCode ?? null,
      fightId: s.identity?.fightId ?? null,
      reportRevision: s.identity?.reportRevision ?? null,
      keyLevel: s.keyLevel,
      selectionReason: "preferred",
      candidateRank: s.selectedRank,
    }));

    // Mutate first selected fact fingerprint → hash mismatch
    const mutated = factSets.map((f, i) =>
      i === 0 ? { ...f, inputFingerprint: sha("tampered-payload") } : f,
    );

    const audit = buildScoringV2EvidenceAudit({
      manifestId: "manifest-audit-1",
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestDocument: manifest,
      coverageState: manifest.coverage.state,
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      auditedAt: "2026-08-04T12:00:00.000Z",
      slotRows,
      datasets: [],
      factSets: mutated,
      dimensions: [],
      masterDataByIdentity: [],
      pagesByIdentity: [],
    });

    expect(
      audit.integrityFailures.some((f) => f.includes("FACT_SET_HASH_MISMATCH")),
    ).toBe(true);
  });

  it("flags facts bound to an unselected run", () => {
    const { manifest, factSets } = buildHarness();
    const slotRows = manifest.slots.map((s) => ({
      id: `slot-row-${s.slotId}`,
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex,
      state: s.state,
      reportCode: s.identity?.reportCode ?? null,
      fightId: s.identity?.fightId ?? null,
      reportRevision: s.identity?.reportRevision ?? null,
      keyLevel: s.keyLevel,
      selectionReason: s.state === "SELECTED" ? "preferred" : "missing",
      candidateRank: s.selectedRank,
    }));

    const base = factSets[0]!;
    const rogueFacts =
      typeof base.facts === "object" && base.facts != null
        ? {
            ...(base.facts as Record<string, unknown>),
            reportCode: "ROGUE999",
            fightId: 999,
            reportRevision: 1,
            identity: {
              reportCode: "ROGUE999",
              fightId: 999,
              reportRevision: 1,
            },
          }
        : base.facts;

    const rogue = {
      ...base,
      id: randomUUID(),
      manifestSlotId: "unbound-slot",
      relationReportCode: base.relationReportCode,
      relationFightId: base.relationFightId,
      relationReportRevision: base.relationReportRevision,
      facts: rogueFacts,
      dungeonSlug: "ara-kara",
      slotIndex: 0,
    };

    const audit = buildScoringV2EvidenceAudit({
      manifestId: "manifest-audit-1",
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestDocument: manifest,
      coverageState: manifest.coverage.state,
      expectedSlotCount: 16,
      selectedSlotCount: manifest.selectedSlotCount,
      auditedAt: "2026-08-04T12:00:00.000Z",
      slotRows,
      datasets: [],
      factSets: [...factSets, rogue],
      dimensions: [],
      masterDataByIdentity: [],
      pagesByIdentity: [],
    });

    expect(
      audit.integrityFailures.some((f) => f.includes("UNSELECTED_FACT_SET")),
    ).toBe(true);
  });

  it("marks BROKEN when RunFactSet is on the correct DB slot but fact doc identity differs", () => {
    const { manifest, factSets, datasets, pagesByIdentity, masterDataByIdentity } =
      buildHarness({ leaveWindrunnerSlot1Missing: false });
    const slotRows = manifest.slots.map((s) => ({
      id: `slot-row-${s.slotId}`,
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex,
      state: s.state,
      reportCode: s.identity?.reportCode ?? null,
      fightId: s.identity?.fightId ?? null,
      reportRevision: s.identity?.reportRevision ?? null,
      keyLevel: s.keyLevel,
      selectionReason: "preferred",
      candidateRank: s.selectedRank,
      dimensionValidityReasons: [] as string[],
    }));

    const mutated = factSets.map((f, i) => {
      if (i !== 0) return f;
      const facts = {
        ...(f.facts as Record<string, unknown>),
        reportCode: "OTHERFIGHT",
        fightId: 777,
        reportRevision: 9,
        identity: {
          reportCode: "OTHERFIGHT",
          fightId: 777,
          reportRevision: 9,
        },
      };
      return { ...f, facts };
    });

    const audit = buildScoringV2EvidenceAudit({
      manifestId: "manifest-audit-1",
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestDocument: manifest,
      coverageState: manifest.coverage.state,
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      auditedAt: "2026-08-04T12:00:00.000Z",
      slotRows,
      datasets,
      factSets: mutated,
      dimensions: [],
      masterDataByIdentity,
      pagesByIdentity,
    });

    expect(
      audit.integrityFailures.some((f) => f.includes("UNSELECTED_FACT_SET")),
    ).toBe(true);
    const broken = audit.slots
      .flatMap((s) => s.factSets)
      .find((f) => f.limitations.includes("FACT_IDENTITY_MISMATCH"));
    expect(broken?.sourceOutcome).toBe("FAILED");
    expect(broken?.identityMatchAgainstManifest).toBe(false);
  });

  it("reports missing selected-slot facts without durable provenance as FAILED/BROKEN", () => {
    const { manifest } = buildHarness();
    const slotRows = manifest.slots.map((s) => ({
      id: `slot-row-${s.slotId}`,
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex,
      state: s.state,
      reportCode: s.identity?.reportCode ?? null,
      fightId: s.identity?.fightId ?? null,
      reportRevision: s.identity?.reportRevision ?? null,
      keyLevel: s.keyLevel,
      selectionReason: s.state === "SELECTED" ? "preferred" : "missing",
      candidateRank: s.selectedRank,
    }));

    const audit = buildScoringV2EvidenceAudit({
      manifestId: "manifest-audit-1",
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestDocument: manifest,
      coverageState: manifest.coverage.state,
      expectedSlotCount: 16,
      selectedSlotCount: manifest.selectedSlotCount,
      auditedAt: "2026-08-04T12:00:00.000Z",
      slotRows,
      datasets: [],
      factSets: [],
      dimensions: [],
      masterDataByIdentity: [],
      pagesByIdentity: [],
    });

    expect(audit.slots).toHaveLength(16);
    const selected = audit.slots.filter((s) => s.slotState === "SELECTED");
    for (const slot of selected) {
      expect(["PARTIAL", "BROKEN", "UNAVAILABLE"]).toContain(slot.slotAuditState);
      expect(slot.factSets).toHaveLength(3);
      expect(slot.factSets.every((f) => f.runFactSetPresent === false)).toBe(true);
      expect(slot.factSets.every((f) => f.sourceOutcome === "FAILED")).toBe(true);
    }
  });

  it("records mixed ranking logical outcomes across a full 16-slot manifest", () => {
    const { manifest, factSets, datasets, pagesByIdentity, masterDataByIdentity } =
      buildHarness({ leaveWindrunnerSlot1Missing: false });
    const selected = manifest.slots.filter((s) => s.state === "SELECTED");
    expect(selected).toHaveLength(16);

    const slotRows = selected.map((s, idx) => {
      const outcome =
        idx % 4 === 0
          ? "WRITTEN"
          : idx % 4 === 1
            ? "UNAVAILABLE"
            : idx % 4 === 2
              ? "FAILED"
              : "WRITTEN";
      return {
        id: `slot-row-${s.slotId}`,
        dungeonSlug: s.dungeonSlug,
        slotIndex: s.slotIndex,
        state: s.state,
        reportCode: s.identity!.reportCode,
        fightId: s.identity!.fightId,
        reportRevision: s.identity!.reportRevision,
        keyLevel: s.keyLevel,
        selectionReason: "preferred",
        candidateRank: s.selectedRank,
        dimensionValidityReasons:
          outcome === "WRITTEN"
            ? []
            : [`PERFORMANCE:${outcome}:${outcome.toLowerCase()}_fixture`],
      };
    });

    // Drop performance facts for UNAVAILABLE/FAILED slots (WRITTEN keeps fact rows).
    const keptFacts = factSets.filter((f) => {
      if (f.extractorFamily !== "performance") return true;
      const row = slotRows.find((s) => s.id === f.manifestSlotId);
      return row?.dimensionValidityReasons.length === 0;
    });

    const audit = buildScoringV2EvidenceAudit({
      manifestId: "manifest-audit-1",
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestDocument: manifest,
      coverageState: manifest.coverage.state,
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      auditedAt: "2026-08-04T12:00:00.000Z",
      slotRows,
      datasets,
      factSets: keptFacts,
      dimensions: [],
      masterDataByIdentity,
      pagesByIdentity,
    });

    const outcomes = audit.matrix.map((r) => r.ranking);
    expect(outcomes.filter((o) => o === "WRITTEN").length).toBeGreaterThan(0);
    expect(outcomes.filter((o) => o === "UNAVAILABLE").length).toBeGreaterThan(0);
    expect(outcomes.filter((o) => o === "FAILED").length).toBeGreaterThan(0);
    expect(audit.slots).toHaveLength(16);
    for (const slot of audit.slots.filter((s) => s.slotState === "SELECTED")) {
      expect(slot.rankingParse?.logicalOutcome).toBeTruthy();
    }
  });

  it("rejects fact for selected slot B when attached to selected slot A", () => {
    const { manifest, factSets, finalized } = buildHarness({
      leaveWindrunnerSlot1Missing: false,
    });
    const selected = manifest.slots.filter((s) => s.state === "SELECTED");
    expect(selected.length).toBeGreaterThanOrEqual(2);
    const slotA = selected[0]!;
    const slotB = selected[1]!;
    expect(slotA.identity).toBeTruthy();
    expect(slotB.identity).toBeTruthy();
    expect(
      `${slotA.identity!.reportCode}:${slotA.identity!.fightId}`,
    ).not.toBe(`${slotB.identity!.reportCode}:${slotB.identity!.fightId}`);

    const factB = factSets.find(
      (f) =>
        f.extractorFamily === "survival" &&
        f.dungeonSlug === slotB.dungeonSlug &&
        f.slotIndex === slotB.slotIndex,
    );
    expect(factB).toBeTruthy();

    // Attach B's document identity onto slot A's row coordinates.
    const crossAttached = {
      ...factB!,
      id: randomUUID(),
      manifestSlotId: `slot-row-${slotA.slotId}`,
      dungeonSlug: slotA.dungeonSlug,
      slotIndex: slotA.slotIndex,
      relationReportCode: slotA.identity!.reportCode,
      relationFightId: slotA.identity!.fightId,
      relationReportRevision: slotA.identity!.reportRevision,
    };

    const slotRows = selected.map((s) => ({
      id: `slot-row-${s.slotId}`,
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex,
      state: s.state,
      reportCode: s.identity!.reportCode,
      fightId: s.identity!.fightId,
      reportRevision: s.identity!.reportRevision,
      keyLevel: s.keyLevel,
      selectionReason: "preferred",
      candidateRank: s.selectedRank,
    }));

    const mixedFacts = factSets
      .filter(
        (f) =>
          !(
            f.extractorFamily === "survival" &&
            f.dungeonSlug === slotA.dungeonSlug &&
            f.slotIndex === slotA.slotIndex
          ),
      )
      .concat([crossAttached]);

    const audit = buildScoringV2EvidenceAudit({
      manifestId: "manifest-audit-1",
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestDocument: manifest,
      coverageState: manifest.coverage.state,
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      auditedAt: "2026-08-04T12:00:00.000Z",
      slotRows,
      datasets: [],
      factSets: mixedFacts,
      dimensions: [],
      masterDataByIdentity: [],
      pagesByIdentity: [],
    });

    expect(
      audit.integrityFailures.some((f) => f.startsWith("CROSS_SLOT_FACT_ATTACHMENT:")),
    ).toBe(true);

    const slotAAudit = audit.slots.find(
      (s) => s.dungeonSlug === slotA.dungeonSlug && s.slotIndex === slotA.slotIndex,
    );
    const survA = slotAAudit?.factSets.find((f) => f.extractorFamily === "SURVIVAL");
    expect(survA?.identityMatchAgainstManifest).toBe(false);
    expect(survA?.sourceOutcome).toBe("FAILED");
    expect(survA?.limitations).toContain("FACT_IDENTITY_MISMATCH");

    const factRefs: PersistedFactSetRef[] = mixedFacts.map((f) => ({
      extractorFamily: f.extractorFamily,
      extractorVersion: f.extractorVersion,
      schemaVersion: f.schemaVersion,
      inputFingerprint: f.inputFingerprint,
      facts: f.facts,
      limitations: f.limitations,
      manifestSlotId: f.manifestSlotId,
      reportCode: f.relationReportCode,
      fightId: f.relationFightId,
      reportRevision: f.relationReportRevision,
      dungeonSlug: f.dungeonSlug,
      slotIndex: f.slotIndex,
    }));
    const valid = identityValidFactSets(manifest, factRefs);
    expect(
      valid.some(
        (f) =>
          f.extractorFamily === "survival" &&
          f.dungeonSlug === slotA.dungeonSlug &&
          f.slotIndex === slotA.slotIndex,
      ),
    ).toBe(false);

    const survivalOutcome = finalized.outcomes.find((o) => o.dimension === "SURVIVAL");
    expect(survivalOutcome).toBeTruthy();
    const replay = replayScoringV2Dimensions({
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestId: "manifest-audit-1",
      scoreModelId: "model-audit-1",
      manifestDocument: manifest,
      expectedManifestContentHash: manifest.contentHash,
      factSets: factRefs,
      persistedDimensions: [
        {
          dimension: "SURVIVAL",
          score: survivalOutcome!.record.score,
          confidence: survivalOutcome!.record.confidence,
          state: survivalOutcome!.record.availabilityState,
          inputFingerprint: survivalOutcome!.record.inputFingerprint,
          metrics: survivalOutcome!.record.metrics,
          explanation: survivalOutcome!.record.explanation,
        },
      ],
      enabledDimensions: ["SURVIVAL"],
    });
    expect(replay.details.some((d) => d.startsWith("excluded_identity_invalid_facts:"))).toBe(
      true,
    );
  });

  it("marks NOT_ENABLED fact outcomes when a WCL family is disabled", () => {
    const { manifest, factSets, datasets, pagesByIdentity, masterDataByIdentity } =
      buildHarness();
    const slotRows = manifest.slots.map((s) => ({
      id: `slot-row-${s.slotId}`,
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex,
      state: s.state,
      reportCode: s.identity?.reportCode ?? null,
      fightId: s.identity?.fightId ?? null,
      reportRevision: s.identity?.reportRevision ?? null,
      keyLevel: s.keyLevel,
      selectionReason: s.state === "SELECTED" ? "preferred" : "missing",
      candidateRank: s.selectedRank,
    }));

    const audit = buildScoringV2EvidenceAudit({
      manifestId: "manifest-audit-1",
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestDocument: manifest,
      coverageState: manifest.coverage.state,
      expectedSlotCount: 16,
      selectedSlotCount: manifest.selectedSlotCount,
      auditedAt: "2026-08-04T12:00:00.000Z",
      slotRows,
      datasets,
      factSets,
      dimensions: [],
      masterDataByIdentity,
      pagesByIdentity,
      enabledFamilies: ["SURVIVAL", "UTILITY"],
    });

    const selected = audit.slots.filter((s) => s.slotState === "SELECTED");
    expect(selected.length).toBeGreaterThan(0);
    for (const slot of selected) {
      const perf = slot.factSets.find((f) => f.extractorFamily === "PERFORMANCE");
      expect(perf?.sourceOutcome).toBe("NOT_ENABLED");
      expect(perf?.runFactSetPresent).toBe(false);
      expect(perf?.limitations).toContain("dimension_not_enabled");
    }
    const perfDim = audit.dimensionConsumption.find((d) => d.dimension === "PERFORMANCE");
    expect(perfDim?.auditScope).toBe("NOT_AUDITED");
    expect(perfDim?.availabilityState).toBe("NOT_ENABLED");
  });

  it("does not synthesize consumed=true when scorer traces are missing", () => {
    const { manifest, factSets } = buildHarness({ leaveWindrunnerSlot1Missing: false });
    const slotRows = manifest.slots.map((s) => ({
      id: `slot-row-${s.slotId}`,
      dungeonSlug: s.dungeonSlug,
      slotIndex: s.slotIndex,
      state: s.state,
      reportCode: s.identity?.reportCode ?? null,
      fightId: s.identity?.fightId ?? null,
      reportRevision: s.identity?.reportRevision ?? null,
      keyLevel: s.keyLevel,
      selectionReason: "preferred",
      candidateRank: s.selectedRank,
    }));

    const audit = buildScoringV2EvidenceAudit({
      manifestId: "manifest-audit-1",
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestDocument: manifest,
      coverageState: manifest.coverage.state,
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      auditedAt: "2026-08-04T12:00:00.000Z",
      slotRows,
      datasets: [],
      factSets,
      dimensions: [
        {
          dimension: "SURVIVAL",
          score: 50,
          confidence: 0.5,
          state: "AVAILABLE",
          inputFingerprint: "fp-surv",
          metrics: { availabilityState: "AVAILABLE" },
          explanation: {},
          manifestId: "manifest-audit-1",
        },
      ],
      masterDataByIdentity: [],
      pagesByIdentity: [],
    });

    const survival = audit.dimensionConsumption.find((d) => d.dimension === "SURVIVAL");
    expect(survival?.featureUsage.length).toBeGreaterThan(0);
    expect(survival?.featureUsage.every((f) => f.consumed === false)).toBe(true);
    expect(
      survival?.featureUsage.some(
        (f) =>
          f.scoringRole === "SCORE" &&
          f.exclusionReason === "SCORE_FEATURE_NOT_CONSUMED",
      ),
    ).toBe(true);
    expect(
      audit.integrityFailures.some((f) => f.startsWith("SCORE_FEATURE_NOT_CONSUMED:")),
    ).toBe(true);
  });

  it("canonical fingerprints match under key reorder and fail on featureUsage drift", () => {
    const metricsA = {
      availabilityState: "AVAILABLE",
      scoreComponents: { deaths: 1, combat: 2 },
      featureUsage: [
        {
          featurePath: "survival.deaths",
          scoringRole: "SCORE",
          consumed: true,
          exclusionReason: null,
          outputComponentOrConfidenceField: "deathsPenalty",
          selectedSlotCountContaining: 1,
          validValueCount: 1,
          missingCount: 0,
          zeroCount: 0,
        },
      ],
      computedAt: "2026-01-01T00:00:00.000Z",
    };
    const metricsB = {
      computedAt: "2099-01-01T00:00:00.000Z",
      featureUsage: metricsA.featureUsage,
      scoreComponents: { combat: 2, deaths: 1 },
      availabilityState: "AVAILABLE",
    };
    const explA = { summary: "ok", details: { a: 1, b: 2 } };
    const explB = { details: { b: 2, a: 1 }, summary: "ok" };
    expect(fingerprintExplanationMetrics(metricsA, explA)).toBe(
      fingerprintExplanationMetrics(metricsB, explB),
    );

    const drifted = {
      ...metricsB,
      featureUsage: [
        {
          ...metricsA.featureUsage[0]!,
          consumed: false,
          exclusionReason: "SCORE_FEATURE_NOT_CONSUMED",
        },
      ],
    };
    expect(fingerprintExplanationMetrics(metricsA, explA)).not.toBe(
      fingerprintExplanationMetrics(drifted, explB),
    );
  });
});
