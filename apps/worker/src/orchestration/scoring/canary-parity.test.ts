/**
 * Agent 03 — canary parity: authoritative scoring authority, cold→replay,
 * Experience first-class, persistence/publication safety.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceCandidateMetadataV2,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
  productDimensionExplainabilityFields,
  type ExperiencePhase1Result,
} from "@mplus/scoring";
import type { AppEnv } from "@mplus/config";
import { MIDNIGHT_SEASON_1_DUNGEON_SLUGS } from "./canary/canary-catalog.js";
import { runScoringCanaryLive } from "./canary/canary-live.js";
import { runScoringCanaryReplay } from "./canary/canary-replay.js";
import type { CanarySeasonResolution } from "./canary/canary-season.js";
import { createMemoryOrchestrationPorts } from "./run-orchestration/index.js";
import { buildTestPerformanceAggregateDbRow } from "./run-orchestration/test-fixtures.js";
import { runAuthoritativeScoring } from "./refresh-bridge.js";

const CHAR_ID = "11111111-1111-4111-8111-111111111111";
const MANIFEST_ID = "e65b46ec-aee6-4862-af31-6ae87a01daa9";
const POOL_HASH = "pool-hash-midnight";

const liveEnv = {
  PROVIDER_MODE: "live" as const,
  WCL_ENABLED: true,
  ALLOW_LIVE_PROVIDER_CALLS: true,
  SCORING_ENABLED: true,
  SCORING_PUBLICATION_ENABLED: false,
  WCL_CLIENT_ID: "id",
  WCL_CLIENT_SECRET: "secret",
  WCL_CANARY_RATE_SNAPSHOT_TTL_SECONDS: 60,
  WCL_RATE_WARN_PERCENT: 70,
  WCL_RATE_DEFER_PERCENT: 80,
  WCL_RATE_STOP_PERCENT: 90,
} as unknown as AppEnv;

const seasonResolutionOk: CanarySeasonResolution = {
  configuredZoneId: 47,
  resolutionMode: "AUTO",
  seasonId: "season-row-1",
  seasonSlug: "blizzard-season-17",
  seasonName: "Midnight Season 1",
  blizzardSeasonId: 17,
  expansion: "Midnight",
  productSeasonSlug: "midnight-season-1",
  catalogSource: "season_dungeon_bindings",
  catalogVersion: "test-catalog",
  dungeonCount: 8,
  dungeons: MIDNIGHT_SEASON_1_DUNGEON_SLUGS.map((slug, i) => ({
    slug,
    dungeonId: `d-${i}`,
    journalInstanceId: null,
    wclZoneOrEncounterId: null,
    sortOrder: i,
  })),
  activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
  dungeonPoolHash: POOL_HASH,
  expectedSlotCount: 16,
  validationStatus: "OK",
  validationReasons: [],
  isCurrent: true,
  startsAt: null,
  endsAt: null,
  authority: null,
  warnings: [],
};

function candidate(
  dungeonSlug: string,
  fightId: number,
  slotHint = 0,
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode: `R${fightId}`, fightId },
    reportRevision: 1,
    dungeonSlug,
    keyLevel: 10 + slotHint,
    timed: true,
    runScore: 200 + slotHint * 10,
    evidenceCompleteness: 1,
    completedAt: "2026-01-01T00:00:00.000Z",
    fightDurationMs: 1_800_000,
    actorId: 1,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
    discoverySource: "test",
  };
}

function fullCandidates(
  slugs = MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
): EvidenceCandidateMetadataV2[] {
  const out: EvidenceCandidateMetadataV2[] = [];
  let fight = 1;
  for (const slug of slugs) {
    out.push(candidate(slug, fight++, 0));
    out.push(candidate(slug, fight++, 1));
  }
  return out;
}

function buildManifest(
  candidates: EvidenceCandidateMetadataV2[],
  dungeonSlugs: readonly string[],
): CharacterSeasonEvidenceManifestV2 {
  const scope = {
    characterId: CHAR_ID,
    seasonId: "season-row-1",
    seasonSlug: "blizzard-season-17",
    specializationId: null,
    classSlug: "mage",
    specSlug: "arcane",
    role: "DPS" as const,
    refreshContractHash: "rh",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
    highKeyPolicyId: "canary-live-v1",
    activeDungeonSlugs: [...dungeonSlugs],
  };
  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope,
    candidates,
    plannedAt: new Date().toISOString(),
  });
  const { manifest } = finalizeEvidenceManifestV2({
    plan,
    acquisitionResults: candidates.map((meta) => ({
      discoveryIdentity: { ...meta.discoveryIdentity },
      acquisitionStatus: "ACQUIRED" as const,
      reportRevision: meta.reportRevision,
      rejectionReason: null,
      rejectionDetail: null,
      datasetHashes: [],
      factSetHash: `facts-${meta.discoveryIdentity.reportCode}:${meta.discoveryIdentity.fightId}`,
      dimensionValidity: {
        performance: "VALID" as const,
        survival: "VALID" as const,
        utility: "VALID" as const,
        reasons: [],
      },
      keyLevel: meta.keyLevel,
      timed: meta.timed,
      runScore: meta.runScore,
      completedAt: meta.completedAt,
      actorId: meta.actorId,
      evidenceCompleteness: meta.evidenceCompleteness,
    })),
    selectedAt: new Date().toISOString(),
  });
  return {
    ...manifest,
    dungeonPoolHash: POOL_HASH,
  } as CharacterSeasonEvidenceManifestV2;
}

function confirmedNoActivityExperience(): ExperiencePhase1Result {
  return {
    score: 0,
    available: true,
    previousStandingScore: 0,
    classRankFloor: null,
    classRankFloorApplied: false,
    eliteFloorApplied: false,
    confirmedEliteTitleCount: 0,
    confidence: 1,
    confidenceCauses: [],
    reason: null,
  };
}

function okBootstrap(spent = 100) {
  return async () => ({
    succeeded: true as const,
    snapshotSource: "PERSISTED" as const,
    providerCalls: 0,
    measuredPoints: 0,
    estimatedPoints: 0,
    snapshotAgeMs: 0,
    failureReason: null,
    snapshot: {
      // Large headroom so 16×45pt cold acquisitions clear reserve/defer floors.
      limitPerHour: 10_000,
      pointsSpentThisHour: spent,
      pointsRemaining: 10_000 - spent,
      resetAt: null,
      fetchedAt: new Date().toISOString(),
    },
    persistedPath: null,
  });
}

function mockContainer(manifestDoc: CharacterSeasonEvidenceManifestV2 | null) {
  const aggregateRow = buildTestPerformanceAggregateDbRow({
    characterId: CHAR_ID,
    characterName: "Target",
    seasonId: "season-row-1",
    dungeonSlugs: MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
    role: "DPS",
    targetSpecSlug: "fire",
  });
  const characterScoreUpsert = vi.fn(async () => {
    throw new Error("character_score_write_forbidden");
  });
  return {
    prisma: {
      evidenceManifest: {
        findFirst: vi.fn(async () =>
          manifestDoc
            ? { id: MANIFEST_ID, document: manifestDoc, frozenAt: new Date() }
            : null,
        ),
      },
      scoreModel: {
        findUnique: vi.fn(async () => ({ config: {} })),
      },
      season: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
      characterScore: {
        findUnique: vi.fn(async () => null),
        upsert: characterScoreUpsert,
      },
      characterExperienceEvidence: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: "exp-1" })),
        upsert: vi.fn(async () => ({ id: "exp-1" })),
      },
      characterPerformanceAggregate: {
        findUnique: vi.fn(async () => aggregateRow),
      },
      $disconnect: vi.fn(async () => undefined),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    providers: {},
    disabledProviders: new Set(),
    repositories: {
      artifacts: {},
      evidence: {},
      wclSource: {},
      capabilityEvidencePackages: {
        findCompleteBySourceFight: vi.fn(async () => null),
      },
      score: {
        getActiveModel: vi.fn(async () => ({
          id: "model-1",
          key: "model-1",
          version: 1,
        })),
      },
    },
    createRedisConnection: vi.fn(() => ({
      quit: vi.fn(async () => undefined),
    })),
    env: liveEnv,
    _characterScoreUpsert: characterScoreUpsert,
  };
}

describe("Agent 03 canary authoritative parity", () => {
  it("A/B/C/D/E: live uses runAuthoritativeScoring with Experience + public projector", async () => {
    const ports = createMemoryOrchestrationPorts();
    const manifest = buildManifest(
      fullCandidates(),
      MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
    );
    const container = mockContainer(manifest);
    const experience = confirmedNoActivityExperience();
    const outDir = await mkdtemp(join(tmpdir(), "canary-parity-"));
    try {
      const { report, scoreResult } = await runScoringCanaryLive({
        prisma: container.prisma as never,
        container: container as never,
        characterId: CHAR_ID,
        characterName: "Target",
        region: "EU",
        realm: "archimonde",
        characterResolution: {
          characterResolutionSource: "test.injected",
          characterId: CHAR_ID,
          characterCanonicalIdentity: {
            region: "EU",
            realmSlug: "archimonde",
            name: "Target",
          },
          repositoryMode: "PRODUCTION",
        },
        seasonResolution: seasonResolutionOk,
        role: "DPS",
        classSlug: "mage",
        specSlug: "arcane",
        rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
        env: liveEnv,
        ports,
        ensureRateLimitSnapshot: okBootstrap(100),
        outputDir: outDir,
        useRedisLock: false,
        scoringModelId: "model-1",
        experienceOverride: experience,
      });

      expect(report.scoringAuthority).toBe("runAuthoritativeScoring");
      expect(report.schemaVersion).toBe("scoring-canary-live-v2");
      expect(report.dimensions.experience.score).toBe(0);
      expect(report.dimensions.experience.confidence).toBe(1);
      expect(report.dimensions.experience.confidenceReasons).toEqual([]);

      const expPublic = productDimensionExplainabilityFields(
        scoreResult.explainability,
        "EXPERIENCE",
      );
      expect(report.dimensions.experience.scoreDrivers).toEqual(
        expPublic.explainability.scoreDrivers,
      );
      expect(report.dimensions.experience.confidenceReasons).toEqual(
        expPublic.explainability.confidenceReasons,
      );

      for (const key of [
        "PERFORMANCE",
        "SURVIVAL",
        "UTILITY",
        "EXPERIENCE",
      ] as const) {
        const lower = key.toLowerCase() as
          | "performance"
          | "survival"
          | "utility"
          | "experience";
        expect(report.dimensions[lower].confidence).toBe(
          scoreResult.explainability.dimensions[key].confidenceStory.value,
        );
      }

      expect(report.composite.score).toBe(
        scoreResult.explainability.composite.score,
      );
      expect(report.composite.confidence).toBe(
        scoreResult.explainability.composite.confidence,
      );
      expect(report.composite.tier).toBe(
        scoreResult.explainability.composite.grade,
      );

      // No simple P/U/S average authority in report artifact.
      const artifact = await readFile(
        join(outDir, "live-canary-report.json"),
        "utf8",
      );
      expect(artifact).not.toContain("overallConfidenceFromDimensions");
      expect(report.persistCharacterScore).toBe(false);
      expect(report.characterScoreWrites).toBe(0);
      expect(container._characterScoreUpsert).not.toHaveBeenCalled();
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("F/G/H/I/J/K: true provider-enabled cold → forceProviderFree replay equality", async () => {
    const ports = createMemoryOrchestrationPorts();
    const acquireSpy = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    const manifest = buildManifest(
      fullCandidates(),
      MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
    );
    const container = mockContainer(manifest);
    const experience = confirmedNoActivityExperience();
    const outDir = await mkdtemp(join(tmpdir(), "canary-cold-replay-"));
    try {
      const { report, authoritative } = await runScoringCanaryLive({
        prisma: container.prisma as never,
        container: container as never,
        characterId: CHAR_ID,
        characterName: "Target",
        region: "EU",
        realm: "archimonde",
        characterResolution: {
          characterResolutionSource: "test.injected",
          characterId: CHAR_ID,
          characterCanonicalIdentity: {
            region: "EU",
            realmSlug: "archimonde",
            name: "Target",
          },
          repositoryMode: "PRODUCTION",
        },
        seasonResolution: seasonResolutionOk,
        role: "DPS",
        classSlug: "mage",
        specSlug: "arcane",
        rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
        env: liveEnv,
        ports,
        ensureRateLimitSnapshot: okBootstrap(100),
        outputDir: outDir,
        useRedisLock: false,
        scoringModelId: "model-1",
        experienceOverride: experience,
      });

      // Cold path actually exercised provider-enabled acquisition.
      expect(acquireSpy).toHaveBeenCalled();
      expect(ports.stats.providerCalls).toBeGreaterThan(0);
      expect(authoritative.providerCalls).toBeGreaterThan(0);

      expect(report.authoritativeReplay.providerCalls).toBe(0);
      expect(report.authoritativeReplay.characterScoreWrites).toBe(0);
      expect(report.authoritativeReplay.scoresEqual).toBe(true);
      expect(report.authoritativeReplay.confidenceEqual).toBe(true);
      expect(report.authoritativeReplay.compositeEqual).toBe(true);
      expect(report.authoritativeReplay.tierEqual).toBe(true);
      expect(report.authoritativeReplay.explainabilityFingerprintEqual).toBe(
        true,
      );
      expect(report.authoritativeReplay.publicProjectionEqual).toBe(true);
      expect(report.publicScorePointerMutated).toBe(false);
      expect(report.publicationEnabled).toBe(false);
      expect(container._characterScoreUpsert).not.toHaveBeenCalled();
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("forceProviderFree cannot override env denial", async () => {
    const ports = createMemoryOrchestrationPorts();
    const manifest = buildManifest(
      fullCandidates(),
      MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
    );
    // Seed packages so provider-free scoring can proceed.
    await runAuthoritativeScoring({
      container: {
        ...mockContainer(manifest),
        env: liveEnv,
      } as never,
      characterId: CHAR_ID,
      seasonId: "season-row-1",
      seasonSlug: "blizzard-season-17",
      role: "DPS",
      classSlug: "mage",
      specSlug: "arcane",
      refreshContract: {
        scoringModelKey: "model-1",
        scoringModelVersion: 1,
        observationSchemaVersion: "observations-v2",
        wclAdapterVersion: "points-and-damage-v1",
        blizzardAdapterVersion: "blizzard-v1",
        raiderIoAdapterVersion: "raiderio-v1",
        runSelectionVersion: "active-season-eight-v1",
        abilityCatalogVersion: "abilities-v1",
        mechanicCatalogVersion: "mechanics-v1",
        activeSeasonId: "blizzard-season-17",
        zoneId: 47,
        partition: null,
      },
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "canary-live-v1",
      activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
      candidates: fullCandidates(),
      scoreModelKey: "model-1",
      scoreModelVersion: 1,
      scoreModelId: "model-1",
      calculatedAt: "2026-01-01T00:00:00.000Z",
      region: "EU",
      realm: "archimonde",
      characterName: "Target",
      persistCharacterScore: false,
      existingManifest: manifest,
      portsOverride: ports,
      experienceOverride: confirmedNoActivityExperience(),
    });

    const deniedEnv = {
      ...liveEnv,
      ALLOW_LIVE_PROVIDER_CALLS: false,
      PROVIDER_MODE: "fixture" as const,
      WCL_ENABLED: false,
    };
    const acquire = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    acquire.mockClear();
    const deniedContainer = {
      ...mockContainer(manifest),
      env: deniedEnv,
    };
    // forceProviderFree=false must still remain provider-free when env denies.
    const result = await runAuthoritativeScoring({
      container: deniedContainer as never,
      characterId: CHAR_ID,
      seasonId: "season-row-1",
      seasonSlug: "blizzard-season-17",
      role: "DPS",
      classSlug: "mage",
      specSlug: "arcane",
      refreshContract: {
        scoringModelKey: "model-1",
        scoringModelVersion: 1,
        observationSchemaVersion: "observations-v2",
        wclAdapterVersion: "points-and-damage-v1",
        blizzardAdapterVersion: "blizzard-v1",
        raiderIoAdapterVersion: "raiderio-v1",
        runSelectionVersion: "active-season-eight-v1",
        abilityCatalogVersion: "abilities-v1",
        mechanicCatalogVersion: "mechanics-v1",
        activeSeasonId: "blizzard-season-17",
        zoneId: 47,
        partition: null,
      },
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "canary-live-v1",
      activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
      candidates: fullCandidates(),
      scoreModelKey: "model-1",
      scoreModelVersion: 1,
      scoreModelId: "model-1",
      calculatedAt: "2026-01-01T00:00:00.000Z",
      region: "EU",
      realm: "archimonde",
      characterName: "Target",
      persistCharacterScore: false,
      forceProviderFree: false,
      existingManifest: manifest,
      portsOverride: ports,
      experienceOverride: confirmedNoActivityExperience(),
    });
    expect(acquire).not.toHaveBeenCalled();
    expect(result.providerCalls).toBe(0);
  });

  it("standalone replay report includes Experience and zero writes", async () => {
    const ports = createMemoryOrchestrationPorts();
    const manifest = buildManifest(
      fullCandidates(),
      MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
    );
    const container = mockContainer(manifest);
    const experience = confirmedNoActivityExperience();
    const outDir = await mkdtemp(join(tmpdir(), "canary-replay-only-"));

    // Warm packages via live canary first.
    await runScoringCanaryLive({
      prisma: container.prisma as never,
      container: container as never,
      characterId: CHAR_ID,
      characterName: "Target",
      region: "EU",
      realm: "archimonde",
      characterResolution: {
        characterResolutionSource: "test.injected",
        characterId: CHAR_ID,
        characterCanonicalIdentity: {
          region: "EU",
          realmSlug: "archimonde",
          name: "Target",
        },
        repositoryMode: "PRODUCTION",
      },
      seasonResolution: seasonResolutionOk,
      role: "DPS",
      classSlug: "mage",
      specSlug: "arcane",
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      env: liveEnv,
      ports,
      ensureRateLimitSnapshot: okBootstrap(100),
      outputDir: outDir,
      useRedisLock: false,
      scoringModelId: "model-1",
      experienceOverride: experience,
    });

    const { report } = await runScoringCanaryReplay({
      env: liveEnv,
      prisma: container.prisma as never,
      container: container as never,
      characterId: CHAR_ID,
      characterName: "Target",
      region: "EU",
      realm: "archimonde",
      classSlug: "mage",
      specSlug: "arcane",
      role: "DPS",
      season: seasonResolutionOk,
      repositoryMode: "MEMORY",
      portsOverride: ports,
      outputDir: outDir,
      scoringModelId: "model-1",
      experienceOverride: experience,
    });

    expect(report.scoringAuthority).toBe("runAuthoritativeScoring");
    expect(report.forceProviderFree).toBe(true);
    expect(report.providerCalls).toBe(0);
    expect(report.characterScoreWrites).toBe(0);
    expect(report.dimensions.experience.score).toBe(0);
    expect(report.dimensions.experience.confidence).toBe(1);
    expect(report.composite.tier).toBeTruthy();
    await rm(outDir, { recursive: true, force: true });
  });

  it("Redis lock stays open across cold+replay; quit only after replay", async () => {
    const lifecycle: string[] = [];
    let closed = false;
    const fakeRedis = {
      assertOpen() {
        if (closed) {
          throw new Error("redis_already_quit");
        }
      },
      async quit() {
        lifecycle.push("quit");
        closed = true;
      },
    };

    const ports = createMemoryOrchestrationPorts();
    const baseLock = ports.withSourceFightLock.bind(ports);
    ports.withSourceFightLock = async (sourceFight, work) => {
      fakeRedis.assertOpen();
      lifecycle.push("lock");
      return baseLock(sourceFight, work);
    };

    const manifest = buildManifest(
      fullCandidates(),
      MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
    );
    const container = mockContainer(manifest);
    container.createRedisConnection = vi.fn(() => fakeRedis);
    const experience = confirmedNoActivityExperience();
    const outDir = await mkdtemp(join(tmpdir(), "canary-redis-lifecycle-"));
    try {
      const { report } = await runScoringCanaryLive({
        prisma: container.prisma as never,
        container: container as never,
        characterId: CHAR_ID,
        characterName: "Target",
        region: "EU",
        realm: "archimonde",
        characterResolution: {
          characterResolutionSource: "test.injected",
          characterId: CHAR_ID,
          characterCanonicalIdentity: {
            region: "EU",
            realmSlug: "archimonde",
            name: "Target",
          },
          repositoryMode: "PRODUCTION",
        },
        seasonResolution: seasonResolutionOk,
        role: "DPS",
        classSlug: "mage",
        specSlug: "arcane",
        rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
        env: liveEnv,
        ports,
        ensureRateLimitSnapshot: okBootstrap(100),
        outputDir: outDir,
        // Default useRedisLock (enabled) — must keep Redis across cold+replay.
        scoringModelId: "model-1",
        experienceOverride: experience,
      });

      expect(container.createRedisConnection).toHaveBeenCalled();
      expect(lifecycle.filter((e) => e === "lock").length).toBeGreaterThan(0);
      expect(lifecycle.at(-1)).toBe("quit");
      const lastLock = lifecycle.lastIndexOf("lock");
      const quitIdx = lifecycle.indexOf("quit");
      expect(quitIdx).toBeGreaterThan(lastLock);
      // Never quit before the first lock, and never lock after quit.
      expect(lifecycle.indexOf("quit")).toBe(lifecycle.length - 1);
      expect(report.authoritativeReplay.explainabilityFingerprintEqual).toBe(
        true,
      );
      expect(report.capabilityLiveProviderPermission).toBe("ALLOWED");
      expect(report.authoritativeProviderPermission).toBe("ALLOWED");
      expect(report.forceProviderFreeReplay).toBe(true);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("quits owned Redis when validation fails after create (early-failure cleanup)", async () => {
    let quitCount = 0;
    const fakeRedis = {
      async quit() {
        quitCount += 1;
      },
    };
    const ports = createMemoryOrchestrationPorts();
    const manifest = buildManifest(
      fullCandidates(),
      MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
    );
    const container = mockContainer(manifest);
    container.createRedisConnection = vi.fn(() => fakeRedis);
    const outDir = await mkdtemp(join(tmpdir(), "canary-redis-early-fail-"));
    const badSeason: CanarySeasonResolution = {
      ...seasonResolutionOk,
      configuredZoneId: null,
    };
    try {
      await expect(
        runScoringCanaryLive({
          prisma: container.prisma as never,
          container: container as never,
          characterId: CHAR_ID,
          characterName: "Target",
          region: "EU",
          realm: "archimonde",
          characterResolution: {
            characterResolutionSource: "test.injected",
            characterId: CHAR_ID,
            characterCanonicalIdentity: {
              region: "EU",
              realmSlug: "archimonde",
              name: "Target",
            },
            repositoryMode: "PRODUCTION",
          },
          seasonResolution: badSeason,
          role: "DPS",
          classSlug: "mage",
          specSlug: "arcane",
          rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
          env: liveEnv,
          ports,
          ensureRateLimitSnapshot: okBootstrap(100),
          outputDir: outDir,
          scoringModelId: "model-1",
          experienceOverride: confirmedNoActivityExperience(),
        }),
      ).rejects.toMatchObject({ code: "CANARY_ZONE_ID_REQUIRED" });
      expect(container.createRedisConnection).toHaveBeenCalled();
      expect(quitCount).toBe(1);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("standalone replay does not mutate caller-owned ports.acquire", async () => {
    const ports = createMemoryOrchestrationPorts();
    const originalAcquire = ports.acquireAndPersistCapabilityPackage;
    const manifest = buildManifest(
      fullCandidates(),
      MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
    );
    const container = mockContainer(manifest);
    const experience = confirmedNoActivityExperience();
    const outDir = await mkdtemp(join(tmpdir(), "canary-replay-ports-"));

    await runScoringCanaryLive({
      prisma: container.prisma as never,
      container: container as never,
      characterId: CHAR_ID,
      characterName: "Target",
      region: "EU",
      realm: "archimonde",
      characterResolution: {
        characterResolutionSource: "test.injected",
        characterId: CHAR_ID,
        characterCanonicalIdentity: {
          region: "EU",
          realmSlug: "archimonde",
          name: "Target",
        },
        repositoryMode: "PRODUCTION",
      },
      seasonResolution: seasonResolutionOk,
      role: "DPS",
      classSlug: "mage",
      specSlug: "arcane",
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      env: liveEnv,
      ports,
      ensureRateLimitSnapshot: okBootstrap(100),
      outputDir: outDir,
      useRedisLock: false,
      scoringModelId: "model-1",
      experienceOverride: experience,
    });

    await runScoringCanaryReplay({
      env: liveEnv,
      prisma: container.prisma as never,
      container: container as never,
      characterId: CHAR_ID,
      characterName: "Target",
      region: "EU",
      realm: "archimonde",
      classSlug: "mage",
      specSlug: "arcane",
      role: "DPS",
      season: seasonResolutionOk,
      repositoryMode: "MEMORY",
      portsOverride: ports,
      outputDir: outDir,
      scoringModelId: "model-1",
      experienceOverride: experience,
    });

    expect(ports.acquireAndPersistCapabilityPackage).toBe(originalAcquire);
    await rm(outDir, { recursive: true, force: true });
  });
});
