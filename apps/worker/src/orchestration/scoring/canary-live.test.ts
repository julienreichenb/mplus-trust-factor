/**
 * Live capability canary — gates, orchestrator wiring, acquisition, replay.
 * No real WCL calls.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  expectedEvidenceSlotCount,
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceCandidateMetadataV2,
} from "@mplus/contracts";
import { buildEvidenceAcquisitionPlanV2, finalizeEvidenceManifestV2 } from "@mplus/scoring";
import { MIDNIGHT_SEASON_1_DUNGEON_SLUGS } from "./canary/canary-catalog.js";
import {
  candidatesFromFrozenManifest,
  loadCompatibleFrozenManifest,
  runScoringCanaryLive,
} from "./canary/canary-live.js";
import { evaluateCanaryLiveGates, parseCanaryCliArgs } from "./canary/cli.js";
import type { CanarySeasonResolution } from "./canary/canary-season.js";
import {
  createMemoryOrchestrationPorts,
  orchestrateScoringRuns,
} from "./run-orchestration/index.js";
import { buildTestPerformanceAggregateDbRow } from "./run-orchestration/test-fixtures.js";
import type { AppEnv } from "@mplus/config";

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

function fullCandidates(slugs = MIDNIGHT_SEASON_1_DUNGEON_SLUGS): EvidenceCandidateMetadataV2[] {
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
  } as CharacterSeasonEvidenceManifestV2 & { dungeonPoolHash: string };
}

function okBootstrap(spent = 100) {
  return async () => ({
    snapshotSource: "PERSISTED" as const,
    snapshotAgeMs: 0,
    providerCalls: 0,
    measuredPoints: 0,
    estimatedPoints: 0,
    succeeded: true,
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

function deferBootstrap() {
  return async () => ({
    snapshotSource: "PERSISTED" as const,
    snapshotAgeMs: 0,
    providerCalls: 0,
    measuredPoints: 0,
    estimatedPoints: 0,
    succeeded: true,
    failureReason: null,
    snapshot: {
      limitPerHour: 1000,
      pointsSpentThisHour: 850,
      pointsRemaining: 150,
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
        upsert: vi.fn(async () => {
          throw new Error("character_score_write_forbidden_in_canary_test");
        }),
      },
      characterExperienceEvidence: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: "exp-1" })),
        upsert: vi.fn(async () => ({ id: "exp-1" })),
      },
      characterPerformanceAggregate: {
        // Warm HIT: skip live WCL aggregate fetch in unit tests.
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
  };
}

describe("reserved stub removal", () => {
  it("literal reserved stub no longer exists in production canary code", async () => {
    const cliSrc = await readFile(
      new URL("./canary/cli.ts", import.meta.url),
      "utf8",
    );
    const liveSrc = await readFile(
      new URL("./canary/canary-live.ts", import.meta.url),
      "utf8",
    );
    expect(cliSrc).not.toContain("canary_live_execute_path_reserved_for_human_approval");
    expect(liveSrc).not.toContain("canary_live_execute_path_reserved_for_human_approval");
    expect(cliSrc).toContain("runScoringCanaryLive");
    expect(liveSrc).toContain("runAuthoritativeScoring");
    expect(liveSrc).not.toMatch(/\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\+\s*[A-Za-z_][A-Za-z0-9_]*\s*\+\s*[A-Za-z_][A-Za-z0-9_]*\s*\)\s*\/\s*3/);
    expect(liveSrc).not.toContain("overallConfidenceFromDimensions");
    expect(liveSrc).not.toContain("replayScoringFromPersistedEvidence");
  });
});

describe("canary live gates", () => {
  it("missing confirmation causes refusal", () => {
    const gate = evaluateCanaryLiveGates({
      env: liveEnv,
      confirmLive: false,
      characterCount: 1,
    });
    expect(gate.allowed).toBe(false);
  });

  it("publication enabled causes refusal", () => {
    const gate = evaluateCanaryLiveGates({
      env: { ...liveEnv, SCORING_PUBLICATION_ENABLED: true },
      confirmLive: true,
      characterCount: 1,
    });
    expect(gate.allowed).toBe(false);
  });

  it("CLI requires --confirm-live for live mode", () => {
    const args = parseCanaryCliArgs([
      "live",
      "--region",
      "EU",
      "--realm",
      "archimonde",
      "--character",
      "Wallidrixe",
    ]);
    expect(args.confirmLive).toBe(false);
  });
});

describe("runScoringCanaryLive", () => {
  it("no manifest means zero provider calls", async () => {
    const ports = createMemoryOrchestrationPorts();
    const container = mockContainer(null);
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
        seasonResolution: seasonResolutionOk,
        role: "DPS",
        classSlug: "mage",
        specSlug: "arcane",
        rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
        env: liveEnv,
        ports,
        ensureRateLimitSnapshot: okBootstrap(),
        useRedisLock: false,
        scoringModelId: "model-1",
      }),
    ).rejects.toMatchObject({ code: "CANARY_LIVE_MANIFEST_NOT_AVAILABLE" });
    expect(ports.stats.acquireCalls).toBe(0);
    expect(ports.stats.providerCalls).toBe(0);
  });

  it("DEFER causes zero capability acquisitions", async () => {
    const ports = createMemoryOrchestrationPorts();
    const manifest = buildManifest(fullCandidates(), MIDNIGHT_SEASON_1_DUNGEON_SLUGS);
    const container = mockContainer(manifest);
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
        seasonResolution: seasonResolutionOk,
        role: "DPS",
        classSlug: "mage",
        specSlug: "arcane",
        rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
        env: liveEnv,
        ports,
        ensureRateLimitSnapshot: deferBootstrap(),
        useRedisLock: false,
        scoringModelId: "model-1",
      }),
    ).rejects.toMatchObject({ code: "CANARY_COST_ADMISSION_REFUSED" });
    expect(ports.stats.acquireCalls).toBe(0);
  });

  it("live invokes the real orchestrator for a complete 16-run manifest", async () => {
    const ports = createMemoryOrchestrationPorts();
    const candidates = fullCandidates();
    const manifest = buildManifest(candidates, MIDNIGHT_SEASON_1_DUNGEON_SLUGS);
    expect(manifest.selectedSlotCount).toBe(16);
    const container = mockContainer(manifest);
    const outDir = await mkdtemp(join(tmpdir(), "canary-live-"));
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
        useRedisLock: false,
        scoringModelId: "model-1",
      });

      expect(report.orchestratorExecuted).toBe(true);
      expect(report.scoringAuthority).toBe("runAuthoritativeScoring");
      expect(report.manifestId).toBe(MANIFEST_ID);
      expect(report.selectedSlotCount).toBe(16);
      expect(report.expectedSlotCount).toBe(16);
      expect(report.capabilityAcquisitionsAttempted).toBeLessThanOrEqual(16);
      expect(report.packagesCreated).toBe(16);
      expect(report.packagesCreated).toBeLessThanOrEqual(16);
      expect(report.participantDigestsCreated).toBeGreaterThan(0);
      expect(report.wallidrixeDigestCount).toBe(16);
      expect(report.dimensions.performance).toBeDefined();
      expect(report.dimensions.utility).toBeDefined();
      expect(report.dimensions.survival).toBeDefined();
      expect(report.dimensions.experience).toBeDefined();
      expect(report.persistCharacterScore).toBe(false);
      expect(report.characterScoreWrites).toBe(0);
      expect(report.evidenceCoverageDiagnostic.confidenceScore).toBe(100);
      expect(report.publicationEnabled).toBe(false);
      expect(report.publicScorePointerMutated).toBe(false);
      expect(report.charactersProcessed).toBe(1);
      expect(report.authoritativeReplay.providerCalls).toBe(0);
      expect(report.authoritativeReplay.explainabilityFingerprintEqual).toBe(
        true,
      );
      expect(report.authoritativeReplay.scoresEqual).toBe(true);
      expect(report.authoritativeReplay.publicProjectionEqual).toBe(true);
      expect(ports.stats.acquireCalls).toBe(16);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("one missing fight causes exactly one acquisition; cache hits cause zero", async () => {
    const ports = createMemoryOrchestrationPorts();
    const candidates = fullCandidates();
    const manifest = buildManifest(candidates, MIDNIGHT_SEASON_1_DUNGEON_SLUGS);
    // Warm all but one fight.
    const first = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "EU",
      realm: "archimonde",
      characterName: "Target",
      seasonId: "season-row-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: {
        characterId: CHAR_ID,
        seasonId: "season-row-1",
        seasonSlug: "blizzard-season-17",
        specializationId: null,
        classSlug: "mage",
        specSlug: "arcane",
        role: "DPS",
        refreshContractHash: "warm",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
        highKeyPolicyId: "h",
        activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
      },
      candidates,
      existingManifest: manifest,
      ports,
    });
    expect(ports.stats.acquireCalls).toBe(16);

    // Drop one package to simulate a single miss.
    const missFight = first.uniqueSourceFights[0]!;
    const ports2 = createMemoryOrchestrationPorts();
    for (const fight of first.uniqueSourceFights) {
      if (
        fight.reportCode === missFight.reportCode &&
        fight.fightId === missFight.fightId
      ) {
        continue;
      }
      const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: fight });
      ports2.seedPackage(hit!);
      ports2.setParticipants(
        fight,
        await ports.resolveParticipantsForFight({ sourceFight: fight }),
      );
    }
    // Seed digests for warmed fights so only miss needs work.
    for (const rec of first.allParticipantDigests) {
      if (
        rec.digest.reportCode === missFight.reportCode &&
        rec.digest.fightId === missFight.fightId
      ) {
        continue;
      }
      ports2.seedDigest(rec);
    }

    const container = mockContainer(manifest);
    const before = ports2.stats.acquireCalls;
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
      ports: ports2,
      ensureRateLimitSnapshot: okBootstrap(100),
      useRedisLock: false,
      scoringModelId: "model-1",
      outputDir: await mkdtemp(join(tmpdir(), "canary-live-miss-")),
    });
    expect(ports2.stats.acquireCalls - before).toBe(1);
    expect(report.packageCacheMisses).toBe(1);
    expect(report.packagesCreated).toBe(1);
  });

  it("retry is idempotent with full cache", async () => {
    const ports = createMemoryOrchestrationPorts();
    const candidates = fullCandidates();
    const manifest = buildManifest(candidates, MIDNIGHT_SEASON_1_DUNGEON_SLUGS);
    const container = mockContainer(manifest);
    const outDir = await mkdtemp(join(tmpdir(), "canary-live-retry-"));
    const input = {
      prisma: container.prisma as never,
      container: container as never,
      characterId: CHAR_ID,
      characterName: "Target",
      region: "EU",
      realm: "archimonde",
      characterResolution: {
        characterResolutionSource: "test.injected" as const,
        characterId: CHAR_ID,
        characterCanonicalIdentity: {
          region: "EU",
          realmSlug: "archimonde",
          name: "Target",
        },
        repositoryMode: "PRODUCTION" as const,
      },
      seasonResolution: seasonResolutionOk,
      role: "DPS" as const,
      classSlug: "mage",
      specSlug: "arcane",
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      env: liveEnv,
      ports,
      ensureRateLimitSnapshot: okBootstrap(100),
      useRedisLock: false,
      scoringModelId: "model-1",
      outputDir: outDir,
    };
    const first = await runScoringCanaryLive(input);
    const acquiresAfterFirst = ports.stats.acquireCalls;
    const second = await runScoringCanaryLive(input);
    expect(ports.stats.acquireCalls).toBe(acquiresAfterFirst);
    expect(second.report.packagesCreated).toBe(0);
    expect(second.report.packagesReused).toBe(16);
    expect(second.report.authoritativeReplay.explainabilityFingerprintEqual).toBe(
      true,
    );
    expect(first.report.explainabilityFingerprint).toBe(
      second.report.explainabilityFingerprint,
    );
    expect(first.report.confidence).toBe(second.report.confidence);
    await rm(outDir, { recursive: true, force: true });
  });

  it("partial manifest still calculates with reduced confidence", async () => {
    const slugs = MIDNIGHT_SEASON_1_DUNGEON_SLUGS.slice(0, 4);
    const candidates = fullCandidates(slugs);
    // Build against 4 dungeons then evaluate under 8-dungeon season → incomplete relative to expected.
    const partialManifest = buildManifest(candidates, slugs);
    expect(partialManifest.selectedSlotCount).toBe(8);

    // Persist as compatible with full season pool by expanding activeDungeonSlugs on document.
    const doc = {
      ...partialManifest,
      activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
      expectedSlotCount: 16,
      dungeonPoolHash: POOL_HASH,
    } as CharacterSeasonEvidenceManifestV2;

    const ports = createMemoryOrchestrationPorts();
    const container = mockContainer(doc);
    const outDir = await mkdtemp(join(tmpdir(), "canary-live-partial-"));
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
        useRedisLock: false,
        scoringModelId: "model-1",
      });
      expect(report.selectedSlotCount).toBe(8);
      expect(report.expectedSlotCount).toBe(16);
      expect(report.analysisStatus).toBe("PARTIAL");
      expect(report.evidenceCoverageDiagnostic.confidenceScore).toBeLessThan(100);
      expect(report.publicationEnabled).toBe(false);
      expect(report.dimensions.experience).toBeDefined();
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("structured fight failures with zero digests produce FAILURE", async () => {
    const ports = createMemoryOrchestrationPorts();
    ports.acquireAndPersistCapabilityPackage = vi.fn(async () => {
      throw Object.assign(new Error("boom"), { code: "FIGHT_METADATA_ABSENT" });
    });
    const manifest = buildManifest(fullCandidates(), MIDNIGHT_SEASON_1_DUNGEON_SLUGS);
    const container = mockContainer(manifest);
    const outDir = await mkdtemp(join(tmpdir(), "canary-live-fail-"));
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
        }),
      ).rejects.toMatchObject({ code: "CANARY_LIVE_FIGHT_FAILURES" });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("isolated fight failures still calculate partial dimensions (PARTIAL_SUCCESS)", async () => {
    const ports = createMemoryOrchestrationPorts();
    let call = 0;
    const baseAcquire = ports.acquireAndPersistCapabilityPackage.bind(ports);
    ports.acquireAndPersistCapabilityPackage = vi.fn(async (args) => {
      call += 1;
      // Fail 9 of 16 — leave 7 successful.
      if (call > 7) {
        throw Object.assign(new Error("revision mismatch"), {
          code: "FIGHT_REVISION_MISMATCH",
        });
      }
      return baseAcquire(args);
    });
    const manifest = buildManifest(fullCandidates(), MIDNIGHT_SEASON_1_DUNGEON_SLUGS);
    const container = mockContainer(manifest);
    const outDir = await mkdtemp(join(tmpdir(), "canary-live-partial-fail-"));
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
        useRedisLock: false,
        scoringModelId: "model-1",
      });
      expect(report.commandOutcome).toBe("PARTIAL_SUCCESS");
      expect(report.fightFailures.length).toBeGreaterThan(0);
      expect(report.wallidrixeDigestCount).toBe(7);
      expect(report.analysisStatus).toBe("PARTIAL");
      expect(report.dimensions.performance.state).toMatch(/AVAILABLE|PARTIAL/);
      expect(report.dimensions.utility.state).toMatch(/AVAILABLE|PARTIAL/);
      expect(report.dimensions.survival.state).toMatch(/AVAILABLE|PARTIAL/);
      expect(report.dimensions.experience).toBeDefined();
      expect(report.composite.score).not.toBeNull();
      expect(report.confidence).toBeGreaterThan(0);
      expect(
        report.evidenceCoverageDiagnostic.missingDungeons.length,
      ).toBeGreaterThan(0);
      expect(report.publicationEnabled).toBe(false);
      expect(report.authoritativeReplay.providerCalls).toBe(0);
      expect(report.scoringAuthority).toBe("runAuthoritativeScoring");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("candidatesFromFrozenManifest does not invent fights", () => {
    const manifest = buildManifest(fullCandidates(), MIDNIGHT_SEASON_1_DUNGEON_SLUGS);
    const fromManifest = candidatesFromFrozenManifest(manifest);
    expect(fromManifest).toHaveLength(16);
    expect(new Set(fromManifest.map((c) => c.discoverySource))).toEqual(
      new Set(["frozen_manifest"]),
    );
  });

  it("loadCompatibleFrozenManifest returns null when absent", async () => {
    const prisma = {
      evidenceManifest: { findFirst: vi.fn(async () => null) },
    };
    const hit = await loadCompatibleFrozenManifest({
      prisma: prisma as never,
      characterId: CHAR_ID,
      seasonId: "season-row-1",
      expectedDungeonSlugs: MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
      dungeonPoolHash: POOL_HASH,
    });
    expect(hit).toBeNull();
  });
});

describe("expected slot helper", () => {
  it("sixteen slots for eight dungeons", () => {
    expect(expectedEvidenceSlotCount(8)).toBe(16);
  });
});
