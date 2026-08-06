import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  expectedEvidenceSlotCount,
  withParticipantDigestContentHash,
  type EvidenceCandidateMetadataV2,
  type EvidenceSelectionScope,
  type ParticipantScoringDigestV1,
} from "@mplus/contracts";
import {
  DigestDimensionIncompleteError,
  performanceRunParseFactFromDigest,
  survivalFactDocumentFromDigest,
  utilityRunFactSetFromDigest,
} from "@mplus/scoring";
import {
  createMemoryOrchestrationPorts,
  fingerprintDimensionResults,
  orchestrateScoringV2Runs,
  replayScoringV2FromPersistedEvidence,
  sourceFightKey,
} from "./index.js";

const EIGHT_DUNGEONS = [
  "ara-kara-city-of-echoes",
  "eco-dome-aldani",
  "halls-of-atonement",
  "operation-floodgate",
  "priory-of-the-sacred-flame",
  "tazavesh-streets-of-wonder",
  "the-dawnbreaker",
  "the-rookery",
] as const;

const CHAR_ID = "11111111-1111-4111-8111-111111111111";

function scope(
  overrides?: Partial<EvidenceSelectionScope>,
): EvidenceSelectionScope {
  return {
    characterId: CHAR_ID,
    seasonId: "season-1",
    seasonSlug: "the-war-within-season-1",
    specializationId: "spec-1",
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS",
    refreshContractHash: "refresh-hash-1",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    highKeyPolicyId: "high-key-v1",
    activeDungeonSlugs: [...EIGHT_DUNGEONS],
    ...overrides,
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
    reportRevision: rest.reportRevision !== undefined ? rest.reportRevision : 1,
    dungeonSlug,
    keyLevel,
    timed: rest.timed !== undefined ? rest.timed : true,
    runScore: rest.runScore !== undefined ? rest.runScore : 400,
    evidenceCompleteness: rest.evidenceCompleteness ?? 1,
    completedAt: rest.completedAt ?? "2026-07-01T12:00:00.000Z",
    fightDurationMs: rest.fightDurationMs ?? 1_800_000,
    actorId: rest.actorId ?? 1,
    accessState: rest.accessState ?? "PUBLIC",
    identityResolution: rest.identityResolution ?? "RESOLVED",
    fightAccessible: rest.fightAccessible ?? true,
    hardError: rest.hardError ?? false,
  };
}

function fullSixteenCandidates(): EvidenceCandidateMetadataV2[] {
  return EIGHT_DUNGEONS.flatMap((dungeonSlug, i) => [
    candidate({
      reportCode: `best-${i}`,
      fightId: 1,
      dungeonSlug,
      keyLevel: 16,
      runScore: 500,
    }),
    candidate({
      reportCode: `second-${i}`,
      fightId: 2,
      dungeonSlug,
      keyLevel: 14,
      runScore: 420,
    }),
    candidate({
      reportCode: `third-${i}`,
      fightId: 3,
      dungeonSlug,
      keyLevel: 12,
      runScore: 380,
    }),
  ]);
}

function baseOrchestrationInput(
  ports: ReturnType<typeof createMemoryOrchestrationPorts>,
  overrides?: Partial<Parameters<typeof orchestrateScoringV2Runs>[0]>,
) {
  return {
    characterId: CHAR_ID,
    region: "eu",
    realm: "test",
    characterName: "Target",
    seasonId: "season-1",
    scoringModelId: "model-1",
    scoringModelVersion: "v1",
    liveProviderPermission: "ALLOWED" as const,
    scope: scope(),
    candidates: fullSixteenCandidates(),
    ports,
    plannedAt: "2026-08-01T11:00:00.000Z",
    selectedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("scoring V2 run orchestration (provider-free)", () => {
  it("selects 8 dungeons × 2 distinct runs = 16 slots", async () => {
    const ports = createMemoryOrchestrationPorts();
    const result = await orchestrateScoringV2Runs(baseOrchestrationInput(ports));
    expect(result.expectedSlotCount).toBe(expectedEvidenceSlotCount(8));
    expect(result.selectedSlotCount).toBe(16);
    expect(result.incomplete).toBe(false);
    expect(result.uniqueSourceFights).toHaveLength(16);
  });

  it("reports explicit incomplete coverage when a dungeon lacks runs", async () => {
    const ports = createMemoryOrchestrationPorts();
    const candidates = fullSixteenCandidates().filter(
      (c) => c.dungeonSlug !== "the-rookery",
    );
    const result = await orchestrateScoringV2Runs(
      baseOrchestrationInput(ports, { candidates }),
    );
    expect(result.incomplete).toBe(true);
    expect(result.selectedSlotCount).toBe(14);
    expect(result.incompleteSlotIds.length).toBeGreaterThan(0);
    expect(result.publicationAllowed).toBe(false);
  });

  it("cached +14 never replaces uncached +15 in selection", async () => {
    const ports = createMemoryOrchestrationPorts();
    const candidates = [
      candidate({
        reportCode: "cached-14",
        fightId: 1,
        dungeonSlug: "skyreach",
        keyLevel: 14,
        evidenceCompleteness: 1,
        runScore: 999,
      }),
      candidate({
        reportCode: "uncached-15",
        fightId: 2,
        dungeonSlug: "skyreach",
        keyLevel: 15,
        evidenceCompleteness: 0,
        runScore: 100,
      }),
      candidate({
        reportCode: "third",
        fightId: 3,
        dungeonSlug: "skyreach",
        keyLevel: 12,
      }),
    ];
    const result = await orchestrateScoringV2Runs(
      baseOrchestrationInput(ports, {
        scope: scope({ activeDungeonSlugs: ["skyreach"] }),
        candidates,
      }),
    );
    expect(result.manifest.slots[0]!.identity?.reportCode).toBe("uncached-15");
    expect(result.manifest.slots[1]!.identity?.reportCode).toBe("cached-14");
  });

  it("compatible provider package causes 0 WCL calls", async () => {
    const ports = createMemoryOrchestrationPorts();
    const first = await orchestrateScoringV2Runs(baseOrchestrationInput(ports));
    expect(first.accounting.providerCalls).toBeGreaterThan(0);
    const callsAfterFirst = ports.stats.providerCalls;
    const packagesAfterFirst = ports.getPackageCount();

    const second = await orchestrateScoringV2Runs(
      baseOrchestrationInput(ports, {
        existingManifest: first.manifest,
        liveProviderPermission: "FORBIDDEN",
      }),
    );
    expect(second.accounting.providerCalls).toBe(0);
    expect(ports.stats.providerCalls).toBe(callsAfterFirst);
    expect(ports.getPackageCount()).toBe(packagesAfterFirst);
    expect(second.accounting.packagesCreated).toBe(0);
  });

  it("missing package + live disabled returns structured cache miss", async () => {
    const ports = createMemoryOrchestrationPorts();
    const result = await orchestrateScoringV2Runs(
      baseOrchestrationInput(ports, {
        liveProviderPermission: "FORBIDDEN",
        scope: scope({ activeDungeonSlugs: ["skyreach"] }),
        candidates: [
          candidate({
            reportCode: "a",
            fightId: 1,
            dungeonSlug: "skyreach",
            keyLevel: 16,
          }),
          candidate({
            reportCode: "b",
            fightId: 2,
            dungeonSlug: "skyreach",
            keyLevel: 14,
          }),
        ],
      }),
    );
    expect(result.cacheMisses.length).toBeGreaterThan(0);
    expect(result.cacheMisses[0]!.code).toBe("PROVIDER_EVIDENCE_CACHE_MISS");
    expect(result.accounting.providerCalls).toBe(0);
    expect(result.publicationAllowed).toBe(false);
  });

  it("one missing fight + live enabled performs one acquisition and five digests", async () => {
    const ports = createMemoryOrchestrationPorts();
    const result = await orchestrateScoringV2Runs(
      baseOrchestrationInput(ports, {
        scope: scope({ activeDungeonSlugs: ["skyreach"] }),
        candidates: [
          candidate({
            reportCode: "only",
            fightId: 1,
            dungeonSlug: "skyreach",
            keyLevel: 16,
          }),
          candidate({
            reportCode: "only",
            fightId: 1,
            dungeonSlug: "skyreach",
            keyLevel: 16,
          }),
        ],
      }),
    );
    // Distinct identity → one unique fight even if duplicated in candidates.
    expect(result.uniqueSourceFights).toHaveLength(1);
    expect(result.accounting.packagesCreated).toBe(1);
    expect(ports.stats.acquireCalls).toBe(1);
    expect(result.accounting.fights[0]!.participantDigestCount).toBe(5);
    expect(result.allParticipantDigests).toHaveLength(5);
  });

  it("repeated execution performs no second acquisition", async () => {
    const ports = createMemoryOrchestrationPorts();
    const input = baseOrchestrationInput(ports, {
      scope: scope({ activeDungeonSlugs: ["skyreach"] }),
      candidates: [
        candidate({
          reportCode: "a",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 16,
        }),
        candidate({
          reportCode: "b",
          fightId: 2,
          dungeonSlug: "skyreach",
          keyLevel: 14,
        }),
      ],
    });
    const first = await orchestrateScoringV2Runs(input);
    const acquires = ports.stats.acquireCalls;
    const second = await orchestrateScoringV2Runs({
      ...input,
      existingManifest: first.manifest,
    });
    expect(ports.stats.acquireCalls).toBe(acquires);
    expect(second.accounting.providerCalls).toBe(0);
    expect(second.accounting.packagesCreated).toBe(0);
  });

  it("one missing digest rebuilds from persisted package without WCL", async () => {
    const ports = createMemoryOrchestrationPorts();
    const first = await orchestrateScoringV2Runs(
      baseOrchestrationInput(ports, {
        scope: scope({ activeDungeonSlugs: ["skyreach"] }),
        candidates: [
          candidate({
            reportCode: "a",
            fightId: 1,
            dungeonSlug: "skyreach",
            keyLevel: 16,
          }),
          candidate({
            reportCode: "b",
            fightId: 2,
            dungeonSlug: "skyreach",
            keyLevel: 14,
          }),
        ],
      }),
    );
    expect(first.allParticipantDigests.length).toBeGreaterThan(0);
    // Drop one digest from the cache to simulate partial digest cache.
    const victim = first.allParticipantDigests[0]!;
    const key = [
      "participant-scoring-digest",
      victim.digest.reportCode,
      `r${victim.digest.reportRevision}`,
      `f${victim.digest.fightId}`,
      `actor:${victim.digest.participantActorId}`,
      victim.digest.schemaVersion,
      victim.digest.extractorCompatVersion,
      `pkg:${victim.digest.capabilityPackageContentHash}`,
      `catalog:${victim.digest.catalogVersion}`,
    ].join("|");
    // Access internal map via find+overwrite: re-seed all except victim by clearing digests.
    const kept = first.allParticipantDigests.slice(1);
    const ports2 = createMemoryOrchestrationPorts();
    for (const fight of first.uniqueSourceFights) {
      const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: fight });
      expect(hit).not.toBeNull();
      ports2.seedPackage(hit!);
      ports2.setParticipants(
        fight,
        await ports.resolveParticipantsForFight({ sourceFight: fight }),
      );
    }
    for (const d of kept) ports2.seedDigest(d);

    const providerBefore = ports2.stats.providerCalls;
    const replay = await replayScoringV2FromPersistedEvidence({
      ...baseOrchestrationInput(ports2),
      existingManifest: first.manifest,
      liveProviderPermission: undefined as never,
    });
    expect(ports2.stats.providerCalls).toBe(providerBefore);
    expect(replay.accounting.providerCalls).toBe(0);
    expect(replay.allParticipantDigests.length).toBe(
      first.allParticipantDigests.length,
    );
    void key;
  });

  it("concurrent same-fight requests perform at most one acquisition", async () => {
    const ports = createMemoryOrchestrationPorts();
    const input = baseOrchestrationInput(ports, {
      scope: scope({ activeDungeonSlugs: ["skyreach"] }),
      candidates: [
        candidate({
          reportCode: "shared",
          fightId: 9,
          dungeonSlug: "skyreach",
          keyLevel: 16,
        }),
        candidate({
          reportCode: "other",
          fightId: 10,
          dungeonSlug: "skyreach",
          keyLevel: 14,
        }),
      ],
    });
    const [a, b] = await Promise.all([
      orchestrateScoringV2Runs(input),
      orchestrateScoringV2Runs(input),
    ]);
    expect(ports.stats.acquireCalls).toBeLessThanOrEqual(2); // two unique fights
    expect(ports.getPackageCount()).toBe(2);
    expect(a.accounting.packagesCreated + b.accounting.packagesCreated).toBeLessThanOrEqual(
      2,
    );
  });

  it("16 selected fights produce 80 participant digests; each fight acquired at most once", async () => {
    const ports = createMemoryOrchestrationPorts();
    const result = await orchestrateScoringV2Runs(baseOrchestrationInput(ports));
    expect(result.uniqueSourceFights).toHaveLength(16);
    expect(result.allParticipantDigests).toHaveLength(80);
    expect(ports.stats.acquireCalls).toBe(16);
    expect(ports.getPackageCount()).toBe(16);
    expect(result.characterDigests).toHaveLength(16);
  });

  it("provider-free replay is deterministic with zero provider calls", async () => {
    const ports = createMemoryOrchestrationPorts();
    const first = await orchestrateScoringV2Runs(baseOrchestrationInput(ports));
    const fingerprint1 = fingerprintDimensionResults(first);

    const second = await replayScoringV2FromPersistedEvidence({
      ...baseOrchestrationInput(ports),
      existingManifest: first.manifest,
    });
    expect(second.accounting.providerCalls).toBe(0);
    expect(second.accounting.packagesCreated).toBe(0);
    expect(ports.getDigestCount()).toBe(80);
    expect(fingerprintDimensionResults(second)).toBe(fingerprint1);
  });

  it("digest version change rebuilds digests only (no WCL)", async () => {
    const ports = createMemoryOrchestrationPorts();
    const first = await orchestrateScoringV2Runs(
      baseOrchestrationInput(ports, {
        scope: scope({ activeDungeonSlugs: ["skyreach"] }),
        candidates: [
          candidate({
            reportCode: "a",
            fightId: 1,
            dungeonSlug: "skyreach",
            keyLevel: 16,
          }),
          candidate({
            reportCode: "b",
            fightId: 2,
            dungeonSlug: "skyreach",
            keyLevel: 14,
          }),
        ],
      }),
    );
    const packages = ports.getPackageCount();
    const providerCalls = ports.stats.providerCalls;
    // Simulate extractor/catalog bump by clearing digests while keeping packages.
    const ports2 = createMemoryOrchestrationPorts();
    ports2.digestCatalogVersion = "catalog-test-v2";
    for (const fight of first.uniqueSourceFights) {
      const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: fight });
      ports2.seedPackage(hit!);
      ports2.setParticipants(
        fight,
        await ports.resolveParticipantsForFight({ sourceFight: fight }),
      );
    }
    const rebuilt = await orchestrateScoringV2Runs(
      baseOrchestrationInput(ports2, {
        existingManifest: first.manifest,
        liveProviderPermission: "FORBIDDEN",
        scope: scope({ activeDungeonSlugs: ["skyreach"] }),
        candidates: [],
      }),
    );
    expect(ports2.stats.providerCalls).toBe(0);
    expect(ports2.getPackageCount()).toBe(packages);
    expect(rebuilt.accounting.providerCalls).toBe(0);
    expect(rebuilt.allParticipantDigests.length).toBe(first.allParticipantDigests.length);
    expect(ports.stats.providerCalls).toBe(providerCalls);
  });

  it("score-model change recalculates without WCL or digest rebuild", async () => {
    const ports = createMemoryOrchestrationPorts();
    const first = await orchestrateScoringV2Runs(
      baseOrchestrationInput(ports, {
        scope: scope({ activeDungeonSlugs: ["skyreach"] }),
        candidates: [
          candidate({
            reportCode: "a",
            fightId: 1,
            dungeonSlug: "skyreach",
            keyLevel: 16,
          }),
          candidate({
            reportCode: "b",
            fightId: 2,
            dungeonSlug: "skyreach",
            keyLevel: 14,
          }),
        ],
      }),
    );
    const digestsBefore = ports.getDigestCount();
    const packagesBefore = ports.getPackageCount();
    const providerBefore = ports.stats.providerCalls;

    const second = await orchestrateScoringV2Runs(
      baseOrchestrationInput(ports, {
        existingManifest: first.manifest,
        scoringModelId: "model-2",
        scoringModelVersion: "v2",
        liveProviderPermission: "FORBIDDEN",
        scope: scope({ activeDungeonSlugs: ["skyreach"] }),
        candidates: [],
      }),
    );
    expect(second.accounting.providerCalls).toBe(0);
    expect(ports.stats.providerCalls).toBe(providerBefore);
    expect(ports.getPackageCount()).toBe(packagesBefore);
    expect(ports.getDigestCount()).toBe(digestsBefore);
    expect(second.dimensions.lineage.every((l) => l.scoreModelId === "model-2")).toBe(
      true,
    );
  });

  it("calculators cannot access raw WCL pages (digest adapters only)", () => {
    const digest = withParticipantDigestContentHash({
      schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
      reportCode: "r",
      fightId: 1,
      reportRevision: 1,
      dungeonSlug: "skyreach",
      keyLevel: 15,
      timed: true,
      runScore: 400,
      completedAt: "2026-07-01T12:00:00.000Z",
      participantActorId: 1,
      characterId: CHAR_ID,
      characterName: "Target",
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
      ownedPetActorIds: [],
      capabilityPackageArtifactId: "pkg-1",
      capabilityPackageContentHash: "a".repeat(32),
      catalogVersion: "catalog-test-v1",
      extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
      performance: {
        parsePercentile: 80,
        parseSemantic: "BRACKET_PERCENT",
        partition: null,
        rawDps: null,
        offensiveActivations: [],
        completeness: "COMPLETE",
        limitations: [],
      },
      utility: {
        actions: [],
        capabilityCompleteness: [],
        completeness: "COMPLETE",
        limitations: [],
      },
      survival: {
        damageTakenTotal: 1000,
        damageTakenEventCount: 10,
        deaths: [],
        personalDefensiveActivations: [],
        recoveryActivations: [],
        externalsReceived: [],
        pressureWindows: [],
        fightDurationMs: 1_800_000,
        activeCombatMs: 1_500_000,
        capabilityCompleteness: [],
        completeness: "COMPLETE",
        limitations: [],
      },
      createdAt: "2026-08-01T12:00:00.000Z",
    }) as ParticipantScoringDigestV1;

    const perf = performanceRunParseFactFromDigest(digest, "slot-0");
    expect(perf.parsePercentile).toBe(80);
    expect(JSON.stringify(perf)).not.toMatch(/compactEvents|rawPages|cas:\/\//);

    const util = utilityRunFactSetFromDigest(digest, {
      slotId: "slot-0",
      slotIndex: 0,
    });
    expect(util.interruptAttempts).toEqual([]);
    expect(JSON.stringify(util)).not.toMatch(/compactEvents|graphql/);

    const surv = survivalFactDocumentFromDigest(digest, 0);
    expect(surv.deaths.count).toBe(0);
    expect(JSON.stringify(surv)).not.toMatch(/compactEvents|WCL/);
  });

  it("incomplete dimension evidence blocks that dimension explicitly", () => {
    const digest = withParticipantDigestContentHash({
      schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
      reportCode: "r",
      fightId: 1,
      reportRevision: 1,
      dungeonSlug: "skyreach",
      keyLevel: 15,
      timed: true,
      runScore: null,
      completedAt: null,
      participantActorId: 1,
      characterId: null,
      characterName: "Target",
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
      ownedPetActorIds: [],
      capabilityPackageArtifactId: "pkg-1",
      capabilityPackageContentHash: "b".repeat(32),
      catalogVersion: "catalog-test-v1",
      extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
      performance: {
        parsePercentile: null,
        parseSemantic: "UNAVAILABLE",
        partition: null,
        rawDps: null,
        offensiveActivations: [],
        completeness: "UNAVAILABLE",
        limitations: ["ranking_parse_absent"],
      },
      utility: {
        actions: [],
        capabilityCompleteness: [],
        completeness: "UNAVAILABLE",
        limitations: ["no_utility"],
      },
      survival: {
        damageTakenTotal: 0,
        damageTakenEventCount: 0,
        deaths: [],
        personalDefensiveActivations: [],
        recoveryActivations: [],
        externalsReceived: [],
        pressureWindows: [],
        fightDurationMs: null,
        activeCombatMs: null,
        capabilityCompleteness: [],
        completeness: "UNAVAILABLE",
        limitations: ["no_survival"],
      },
      createdAt: "2026-08-01T12:00:00.000Z",
    });

    expect(() => performanceRunParseFactFromDigest(digest, "s")).toThrow(
      DigestDimensionIncompleteError,
    );
    expect(() =>
      utilityRunFactSetFromDigest(digest, { slotId: "s", slotIndex: 0 }),
    ).toThrow(DigestDimensionIncompleteError);
    expect(() => survivalFactDocumentFromDigest(digest, 0)).toThrow(
      DigestDimensionIncompleteError,
    );
  });

  it("sourceFightKey identity is reportCode+fightId+revision", () => {
    expect(
      sourceFightKey({ reportCode: "abc", fightId: 2, reportRevision: 3 }),
    ).toBe("abc:2:3");
  });
});
