/**
 * Refresh shadow entry ↔ digest orchestrator integration (provider-free).
 */
import { describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  expectedEvidenceSlotCount,
  withParticipantDigestContentHash,
  type EvidenceCandidateMetadataV2,
  type ParticipantScoringDigestV1,
} from "@mplus/contracts";
import {
  DigestDimensionIncompleteError,
  performanceRunParseFactFromDigest,
} from "@mplus/scoring";
import { rankingParseFactFromPersistedEvidence } from "./run-orchestration/ranking-hydrate.js";
import { evaluatePublicationEligibility } from "./run-orchestration/publication-eligibility.js";
import {
  buildMinimalCapabilityPackage,
  createMemoryOrchestrationPorts,
  orchestrateScoringV2Runs,
  replayScoringV2FromPersistedEvidence,
  sourceFightKey,
} from "./run-orchestration/index.js";
import { maybeStartScoringV2ShadowFromRefresh } from "./refresh-bridge.js";
import type { WorkerContainer } from "../../container.js";

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
    discoverySource: rest.discoverySource ?? "test",
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

function mockContainer(env: Record<string, unknown>): WorkerContainer {
  return {
    env,
    prisma: {} as never,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    createRedisConnection: vi.fn(),
    providers: {} as never,
    disabledProviders: new Set(),
    calculateScore: vi.fn() as never,
    repositories: {
      artifacts: {} as never,
      evidence: {} as never,
      capabilityEvidencePackages: {
        findCompleteBySourceFight: vi.fn(async () => null),
      },
      participantScoringDigests: {} as never,
    } as never,
  } as unknown as WorkerContainer;
}

const refreshContract = {
  scoringModelKey: "test",
  scoringModelVersion: "1",
  activeSeasonId: "s1",
  providerMode: "fixture" as const,
};

describe("maybeStartScoringV2ShadowFromRefresh ↔ run orchestrator", () => {
  it("1. invokes run orchestrator when all required flags are enabled", async () => {
    const ports = createMemoryOrchestrationPorts();
    const container = mockContainer({
      SCORING_V2_ENABLED: true,
      SCORING_V2_SELECTION_ENABLED: true,
      SCORING_V2_EVIDENCE_FETCH_ENABLED: true,
      SCORING_V2_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
    });

    const diag = await maybeStartScoringV2ShadowFromRefresh({
      container,
      characterId: CHAR_ID,
      seasonId: "season-1",
      seasonSlug: "the-war-within-season-1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      refreshContract,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs: [...EIGHT_DUNGEONS],
      candidates: fullSixteenCandidates(),
      scoreModelId: "model-1",
      parentIngestionJobId: null,
      correlationId: "corr-1",
      refreshGeneration: 1,
      region: "eu",
      realm: "test",
      characterName: "Target",
      portsOverride: ports,
      skipLegacyShadowPipeline: true,
    });

    expect(diag.skipped).toBe(false);
    expect(diag.orchestration).not.toBeNull();
    expect(diag.orchestration!.selectedSlotCount).toBe(16);
    expect(diag.publicScorePointerMutated).toBe(false);
  });

  it("2. does nothing when Scoring V2 master flag is disabled", async () => {
    const ports = createMemoryOrchestrationPorts();
    const acquire = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    const container = mockContainer({
      SCORING_V2_ENABLED: false,
      SCORING_V2_SELECTION_ENABLED: true,
      SCORING_V2_EVIDENCE_FETCH_ENABLED: true,
      SCORING_V2_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
    });

    const diag = await maybeStartScoringV2ShadowFromRefresh({
      container,
      characterId: CHAR_ID,
      seasonId: "season-1",
      seasonSlug: "s1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      refreshContract,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs: [...EIGHT_DUNGEONS],
      candidates: fullSixteenCandidates(),
      scoreModelId: "model-1",
      parentIngestionJobId: null,
      correlationId: null,
      refreshGeneration: 1,
      region: "eu",
      realm: "test",
      characterName: "Target",
      portsOverride: ports,
      skipLegacyShadowPipeline: true,
    });

    expect(diag.skipped).toBe(true);
    expect(diag.orchestration).toBeNull();
    expect(acquire).not.toHaveBeenCalled();
    expect(ports.stats.providerCalls).toBe(0);
  });

  it("3. does not call WCL when ALLOW_LIVE_PROVIDER_CALLS is false", async () => {
    const ports = createMemoryOrchestrationPorts();
    const acquire = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    const container = mockContainer({
      SCORING_V2_ENABLED: true,
      SCORING_V2_SELECTION_ENABLED: true,
      SCORING_V2_EVIDENCE_FETCH_ENABLED: true,
      SCORING_V2_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
    });

    const diag = await maybeStartScoringV2ShadowFromRefresh({
      container,
      characterId: CHAR_ID,
      seasonId: "season-1",
      seasonSlug: "s1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      refreshContract,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs: [...EIGHT_DUNGEONS],
      candidates: fullSixteenCandidates(),
      scoreModelId: "model-1",
      parentIngestionJobId: null,
      correlationId: null,
      refreshGeneration: 1,
      region: "eu",
      realm: "test",
      characterName: "Target",
      portsOverride: ports,
      skipLegacyShadowPipeline: true,
    });

    expect(diag.liveProviderPermission).toBe("FORBIDDEN");
    expect(acquire).not.toHaveBeenCalled();
    expect(diag.providerCalls).toBe(0);
    expect(diag.orchestration!.cacheMisses.length).toBe(16);
  });

  it("4. replays an existing complete manifest with zero provider calls", async () => {
    const ports = createMemoryOrchestrationPorts();
    const first = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: {
        characterId: CHAR_ID,
        seasonId: "season-1",
        seasonSlug: "s1",
        specializationId: null,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        refreshContractHash: "h",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: [...EIGHT_DUNGEONS],
      },
      candidates: fullSixteenCandidates(),
      ports,
    });
    expect(first.incomplete).toBe(false);
    const calls = ports.stats.providerCalls;

    const replay = await replayScoringV2FromPersistedEvidence({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      scope: {
        characterId: CHAR_ID,
        seasonId: "season-1",
        seasonSlug: "s1",
        specializationId: null,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        refreshContractHash: "h",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: [...EIGHT_DUNGEONS],
      },
      existingManifest: first.manifest,
      ports,
    });
    expect(replay.accounting.providerCalls).toBe(0);
    expect(ports.stats.providerCalls).toBe(calls);
  });

  it("5. one missing package + live forbidden → structured cache miss, no acquire", async () => {
    const ports = createMemoryOrchestrationPorts();
    const acquire = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    const result = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "FORBIDDEN",
      scope: {
        characterId: CHAR_ID,
        seasonId: "season-1",
        seasonSlug: "s1",
        specializationId: null,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        refreshContractHash: "h",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: ["skyreach"],
      },
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
      ports,
    });
    expect(result.cacheMisses.length).toBeGreaterThan(0);
    expect(result.cacheMisses[0]!.code).toBe("PROVIDER_EVIDENCE_CACHE_MISS");
    expect(acquire).not.toHaveBeenCalled();
    expect(result.accounting.providerCalls).toBe(0);
  });

  it("6. incomplete 15-slot manifest is diagnostic but not publication-eligible", async () => {
    const ports = createMemoryOrchestrationPorts();
    const candidates = fullSixteenCandidates().slice(0, 15);
    // Force incomplete: drop one dungeon entirely.
    const withoutRookery = fullSixteenCandidates().filter(
      (c) => c.dungeonSlug !== "the-rookery",
    );
    const result = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: {
        characterId: CHAR_ID,
        seasonId: "season-1",
        seasonSlug: "s1",
        specializationId: null,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        refreshContractHash: "h",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: [...EIGHT_DUNGEONS],
      },
      candidates: withoutRookery,
      ports,
    });
    expect(result.incomplete).toBe(true);
    expect(result.selectedSlotCount).toBe(14);
    expect(result.manifest.slots.length).toBe(expectedEvidenceSlotCount(8));
    const eligibility = evaluatePublicationEligibility({
      result,
      scoringModelId: "model-1",
      scoringV2PublicationEnabled: false,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.checks.manifestComplete).toBe(false);
    expect(eligibility.publicScorePointerMutated).toBe(false);
    expect(candidates.length).toBe(15);
  });

  it("7. complete 16-slot + 16 digests reaches publication-eligibility gate", async () => {
    const ports = createMemoryOrchestrationPorts();
    const result = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: {
        characterId: CHAR_ID,
        seasonId: "season-1",
        seasonSlug: "s1",
        specializationId: null,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        refreshContractHash: "h",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: [...EIGHT_DUNGEONS],
      },
      candidates: fullSixteenCandidates(),
      ports,
    });
    expect(result.incomplete).toBe(false);
    expect(result.characterDigests).toHaveLength(16);
    expect(result.publicationAllowed).toBe(true);
    const eligibility = evaluatePublicationEligibility({
      result,
      scoringModelId: "model-1",
      scoringV2PublicationEnabled: false,
    });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.publicationEnabled).toBe(false);
    expect(eligibility.publicScorePointerMutated).toBe(false);
    expect(eligibility.reasons).toContain("publication_eligibility_gate_passed");
  });

  it("8. missing Performance ranking blocks Performance only", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: false });
    const result = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: {
        characterId: CHAR_ID,
        seasonId: "season-1",
        seasonSlug: "s1",
        specializationId: null,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        refreshContractHash: "h",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: ["skyreach"],
      },
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
      ports,
    });
    expect(result.dimensions.performance).toBeNull();
    expect(
      result.dimensions.blocked.some((b) => b.dimension === "PERFORMANCE"),
    ).toBe(true);
    expect(result.dimensions.utility).not.toBeNull();
    expect(result.dimensions.survival).not.toBeNull();
    expect(
      result.characterDigests.every(
        (d) => d.digest.performance.completeness === "UNAVAILABLE",
      ),
    ).toBe(true);
    expect(
      result.characterDigests.every(
        (d) => d.digest.utility.completeness !== "UNAVAILABLE",
      ),
    ).toBe(true);
  });

  it("9. persisted ranking evidence maps into digest for Performance calculator", () => {
    const fact = rankingParseFactFromPersistedEvidence({
      evidence: {
        reportCode: "abc",
        fightId: 1,
        reportRevision: 2,
        dungeonSlug: "skyreach",
        keyLevel: 15,
        bracketPercent: 92,
        rankPercent: null,
        amountPercent: null,
        amount: 250_000,
        partition: 3,
      },
      artifactId: "art-1",
      contentHash: "h".repeat(64),
    });
    expect(fact.parsePercentile).toBe(92);
    expect(fact.parseSemantic).toBe("BRACKET_PERCENT");
    expect(fact.rankingProvenance?.source).toBe("PERSISTED_RANKING_PARSE");

    const digest = withParticipantDigestContentHash({
      schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
      reportCode: "abc",
      fightId: 1,
      reportRevision: 2,
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
        parsePercentile: fact.parsePercentile,
        parseSemantic: fact.parseSemantic,
        partition: fact.partition,
        rawDps: fact.rawDps,
        rankingProvenance: fact.rankingProvenance,
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
        damageTakenTotal: 0,
        damageTakenEventCount: 0,
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
    expect(perf.parsePercentile).toBe(92);
    expect(perf.semantic).toBe("BRACKET_PERCENT");
  });

  it("10. retry after partial failure reuses completed packages and digests", async () => {
    const ports = createMemoryOrchestrationPorts();
    const first = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: {
        characterId: CHAR_ID,
        seasonId: "season-1",
        seasonSlug: "s1",
        specializationId: null,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        refreshContractHash: "h",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: ["skyreach"],
      },
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
      ports,
    });
    const packagesAfterFirst = ports.getPackageCount();
    const digestsAfterFirst = ports.getDigestCount();
    const providerAfterFirst = ports.stats.providerCalls;

    // Simulate retry with one fight missing from cache (deleted package for fight b).
    const ports2 = createMemoryOrchestrationPorts();
    for (const fight of first.uniqueSourceFights) {
      if (fight.reportCode === "b") continue;
      const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: fight });
      ports2.seedPackage(hit!);
      for (const rec of first.allParticipantDigests) {
        if (
          rec.digest.reportCode === fight.reportCode &&
          rec.digest.fightId === fight.fightId
        ) {
          ports2.seedDigest(rec);
        }
      }
    }

    const retry = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: {
        characterId: CHAR_ID,
        seasonId: "season-1",
        seasonSlug: "s1",
        specializationId: null,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        refreshContractHash: "h",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: ["skyreach"],
      },
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
      existingManifest: first.manifest,
      ports: ports2,
    });

    expect(retry.accounting.packagesReused).toBeGreaterThanOrEqual(1);
    expect(retry.accounting.packagesCreated).toBe(1);
    expect(ports2.stats.acquireCalls).toBe(1);
    expect(packagesAfterFirst).toBe(2);
    expect(digestsAfterFirst).toBeGreaterThan(0);
    expect(providerAfterFirst).toBeGreaterThan(0);
  });

  it("11. refresh pipeline reports exact providerCalls from orchestrator", async () => {
    const ports = createMemoryOrchestrationPorts();
    // Seed all packages so orchestrator does zero provider calls under FORBIDDEN.
    const warm = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: {
        characterId: CHAR_ID,
        seasonId: "season-1",
        seasonSlug: "s1",
        specializationId: null,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        refreshContractHash: "h",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: [...EIGHT_DUNGEONS],
      },
      candidates: fullSixteenCandidates(),
      ports,
    });

    const container = mockContainer({
      SCORING_V2_ENABLED: true,
      SCORING_V2_SELECTION_ENABLED: true,
      SCORING_V2_EVIDENCE_FETCH_ENABLED: true,
      SCORING_V2_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
    });

    const diag = await maybeStartScoringV2ShadowFromRefresh({
      container,
      characterId: CHAR_ID,
      seasonId: "season-1",
      seasonSlug: "s1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      refreshContract,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs: [...EIGHT_DUNGEONS],
      candidates: fullSixteenCandidates(),
      scoreModelId: "model-1",
      parentIngestionJobId: null,
      correlationId: null,
      refreshGeneration: 1,
      region: "eu",
      realm: "test",
      characterName: "Target",
      portsOverride: ports,
      skipLegacyShadowPipeline: true,
    });

    expect(diag.providerCalls).toBe(diag.orchestration!.accounting.providerCalls);
    expect(diag.providerCalls).toBe(0);
    expect(warm.accounting.providerCalls).toBeGreaterThan(0);
  });

  it("12. public score pointer remains unchanged", async () => {
    const ports = createMemoryOrchestrationPorts();
    const container = mockContainer({
      SCORING_V2_ENABLED: true,
      SCORING_V2_SELECTION_ENABLED: true,
      SCORING_V2_EVIDENCE_FETCH_ENABLED: true,
      SCORING_V2_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: true,
    });

    const diag = await maybeStartScoringV2ShadowFromRefresh({
      container,
      characterId: CHAR_ID,
      seasonId: "season-1",
      seasonSlug: "s1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      refreshContract,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs: [...EIGHT_DUNGEONS],
      candidates: fullSixteenCandidates(),
      scoreModelId: "model-1",
      parentIngestionJobId: null,
      correlationId: null,
      refreshGeneration: 1,
      region: "eu",
      realm: "test",
      characterName: "Target",
      portsOverride: ports,
      skipLegacyShadowPipeline: true,
    });

    expect(diag.publicScorePointerMutated).toBe(false);
    expect(diag.publicationEligibility?.publicScorePointerMutated).toBe(false);
    expect(diag.publicationEligibility?.publicationEnabled).toBe(false);
  });

  it("incomplete package is never treated as compatible", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: false });
    const fight = { reportCode: "x", fightId: 1, reportRevision: 1 };
    const pkg = buildMinimalCapabilityPackage({
      sourceFight: fight,
      participants: [
        {
          playerActorId: 1,
          characterName: "Target",
          classSlug: "mage",
          specSlug: "fire",
          ownedPetActorIds: [],
          characterId: CHAR_ID,
        },
      ],
    });
    ports.seedPackage({
      package: { ...pkg, complete: false },
      packageArtifactId: "incomplete",
      contentHash: pkg.contentHash,
      providerCalls: 0,
    });

    const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: fight });
    expect(hit).toBeNull();
    expect(sourceFightKey(fight)).toBe("x:1:1");
  });

  it("Performance adapter fails closed when ranking absent", () => {
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
      capabilityPackageArtifactId: "pkg",
      capabilityPackageContentHash: "c".repeat(32),
      catalogVersion: "catalog-test-v1",
      extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
      performance: {
        parsePercentile: null,
        parseSemantic: "UNAVAILABLE",
        partition: null,
        rawDps: null,
        rankingProvenance: {
          providerContractVersion: "wcl-ranking-parse-v1",
          schemaVersion: "1.0.0",
          artifactId: null,
          contentHash: null,
          source: "ABSENT",
        },
        offensiveActivations: [],
        completeness: "UNAVAILABLE",
        limitations: ["ranking_parse_absent"],
      },
      utility: {
        actions: [],
        capabilityCompleteness: [],
        completeness: "COMPLETE",
        limitations: [],
      },
      survival: {
        damageTakenTotal: 1,
        damageTakenEventCount: 1,
        deaths: [],
        personalDefensiveActivations: [],
        recoveryActivations: [],
        externalsReceived: [],
        pressureWindows: [],
        fightDurationMs: 1000,
        activeCombatMs: 1000,
        capabilityCompleteness: [],
        completeness: "COMPLETE",
        limitations: [],
      },
      createdAt: "2026-08-01T12:00:00.000Z",
    });
    expect(() => performanceRunParseFactFromDigest(digest, "s")).toThrow(
      DigestDimensionIncompleteError,
    );
  });
});
