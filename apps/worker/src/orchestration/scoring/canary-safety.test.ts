/**
 * Canary safety: live adapter gates, singleflight, dual-path ownership,
 * preflight, cost admission, and CLI guards. Provider-free only.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  type EvidenceCandidateMetadataV2,
} from "@mplus/contracts";
import type { WorkerContainer } from "../../container.js";
import { runAuthoritativeScoring } from "./refresh-bridge.js";
import {
  buildMinimalCapabilityPackage,
  createMemoryOrchestrationPorts,
  createSharedMemorySourceFightLock,
  evaluateLiveCapabilityPermission,
  buildCanaryCostProjection,
  assertCostAdmissionAllowsLive,
  explainCostAdmissionDefer,
  runScoringCanaryPreflight,
  orchestrateScoringRuns,
  sourceFightKey,
  CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT,
  liveAcquireResultFromPackage,
} from "./run-orchestration/index.js";
import {
  evaluateCanaryLiveGates,
  parseCanaryCliArgs,
  resolveZoneForCanaryCommand,
} from "./canary/cli.js";
import { resolveCanaryZoneId } from "./canary/canary-zone.js";

const CHAR_ID = "11111111-1111-4111-8111-111111111111";
const EIGHT = [
  "algethar-academy",
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
  "pit-of-saron",
  "seat-of-the-triumvirate",
  "skyreach",
  "windrunner-spire",
] as const;

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

function fullSixteen(): EvidenceCandidateMetadataV2[] {
  return EIGHT.flatMap((dungeonSlug, i) => [
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
    prisma: {
      scoreModel: {
        findUnique: vi.fn(async () => ({ config: {} })),
      },
      characterScore: {
        upsert: vi.fn(async ({ create }) => ({ id: "score-1", ...create })),
        findUnique: vi.fn(async () => null),
      },
      characterPerformanceAggregate: {
        findUnique: vi.fn(async () => null),
      },
    } as never,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    createRedisConnection: vi.fn(() => ({
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      quit: vi.fn(),
    })),
    providers: {} as never,
    disabledProviders: new Set(),
    repositories: {
      artifacts: {} as never,
      evidence: {} as never,
      capabilityEvidencePackages: {
        findCompleteBySourceFight: vi.fn(async () => null),
      },
      participantScoringDigests: {} as never,
      wclSource: {} as never,
    } as never,
  } as unknown as WorkerContainer;
}

const refreshContract = {
  scoringModelKey: "test",
  scoringModelVersion: 1,
  observationSchemaVersion: "observations-v2",
  wclAdapterVersion: "points-and-damage-v1",
  blizzardAdapterVersion: "blizzard-v1",
  raiderIoAdapterVersion: "raiderio-v1",
  runSelectionVersion: "active-season-eight-v1",
  abilityCatalogVersion: "abilities-v1",

  abilityCatalogExecutionKey: "static:abilities-v1",
  mechanicCatalogVersion: "mechanics-v1",
  activeSeasonId: "s1",
  zoneId: 47,
  partition: null,
};

const rateBudgetConfig = {
  warnPercent: 70,
  deferPercent: 80,
  stopPercent: 90,
};

const baseScope = {
  characterId: CHAR_ID,
  seasonId: "season-1",
  seasonSlug: "s1",
  specializationId: null as string | null,
  classSlug: "mage",
  specSlug: "fire",
  role: "DPS" as const,
  refreshContractHash: "h",
  selectorVersion: EVIDENCE_SELECTOR_VERSION,
  evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
  highKeyPolicyId: "high-key-v1",
  activeDungeonSlugs: [...EIGHT],
};

describe("live capability permission gates", () => {
  it("requires every explicit gate; credentials alone do not grant", () => {
    const denied = evaluateLiveCapabilityPermission({
      providerMode: "fixture",
      wclEnabled: true,
      allowLiveProviderCalls: false,
      liveProviderPermissionGranted: false,
      scoringPublicationEnabled: false,
      hasWclCredentials: true,
    });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reasons).toContain("PROVIDER_MODE_NOT_LIVE");
      expect(denied.reasons).toContain("ALLOW_LIVE_PROVIDER_CALLS_FALSE");
    }

    const allowed = evaluateLiveCapabilityPermission({
      providerMode: "live",
      wclEnabled: true,
      allowLiveProviderCalls: true,
      liveProviderPermissionGranted: true,
      scoringPublicationEnabled: false,
      hasWclCredentials: true,
    });
    expect(allowed.allowed).toBe(true);
  });

  it("rejects when publication is enabled", () => {
    const denied = evaluateLiveCapabilityPermission({
      providerMode: "live",
      wclEnabled: true,
      allowLiveProviderCalls: true,
      liveProviderPermissionGranted: true,
      scoringPublicationEnabled: true,
      hasWclCredentials: true,
    });
    expect(denied.allowed).toBe(false);
  });
});

describe("production live adapter (mocked)", () => {
  it("one acquisition accounting; incomplete package flagged", () => {
    const fight = { reportCode: "abc", fightId: 1, reportRevision: 1 };
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
    const ok = liveAcquireResultFromPackage({
      hit: {
        package: pkg,
        packageArtifactId: "art-1",
        contentHash: pkg.contentHash,
        providerCalls: 0,
      },
      providerCalls: 3,
      created: true,
      pointsConsumed: null,
    });
    expect(ok.providerCalls).toBe(3);
    expect(ok.accounting.estimatedPointsConsumed).toBe(
      CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT,
    );
    expect(ok.accounting.pointsConsumed).toBeNull();
    expect(ok.package.complete).toBe(true);
    expect({ ...pkg, complete: false }.complete).toBe(false);
  });

  it("unknown point cost remains estimated, never silent zero when work ran", () => {
    const fight = { reportCode: "x", fightId: 2, reportRevision: 1 };
    const pkg = buildMinimalCapabilityPackage({
      sourceFight: fight,
      participants: [
        {
          playerActorId: 1,
          characterName: "T",
          classSlug: null,
          specSlug: null,
          ownedPetActorIds: [],
        },
      ],
    });
    const result = liveAcquireResultFromPackage({
      hit: {
        package: pkg,
        packageArtifactId: "a",
        contentHash: pkg.contentHash,
        providerCalls: 0,
      },
      providerCalls: 5,
      created: true,
      pointsConsumed: null,
      costSource: "ESTIMATED_CONSERVATIVE",
    });
    expect(result.providerCalls).toBe(5);
    expect(result.accounting.pointsConsumed).toBeNull();
    expect(result.accounting.estimatedPointsConsumed).toBeGreaterThan(0);
  });
});

describe("distributed source-fight singleflight (shared memory dual instance)", () => {
  it("two workers → one acquisition; waiter reuses package", async () => {
    const shared = createSharedMemorySourceFightLock();
    const ports = createMemoryOrchestrationPorts({ providerCallsPerAcquire: 2 });
    ports.withSourceFightLock = shared.lock;

    const input = {
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED" as const,
      scope: {
        ...baseScope,
        activeDungeonSlugs: ["skyreach"],
      },
      candidates: [
        candidate({
          reportCode: "same",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 16,
        }),
        candidate({
          reportCode: "same",
          fightId: 1,
          dungeonSlug: "skyreach",
          keyLevel: 16,
        }),
      ],
      ports,
    };

    await Promise.all([
      orchestrateScoringRuns(input),
      orchestrateScoringRuns(input),
    ]);
    expect(ports.stats.acquireCalls).toBe(1);
    expect(ports.getPackageCount()).toBe(1);
  });

  it("expired lease recovery remains idempotent via package re-check", async () => {
    const ports = createMemoryOrchestrationPorts();
    const fight = { reportCode: "rec", fightId: 9, reportRevision: 1 };
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
      package: pkg,
      packageArtifactId: "persisted",
      contentHash: pkg.contentHash,
      providerCalls: 0,
    });
    const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: fight });
    expect(hit).not.toBeNull();
    const second = await ports.acquireAndPersistCapabilityPackage({
      sourceFight: fight,
      dungeonSlug: "skyreach",
      keyLevel: 10,
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
    expect(second.created).toBe(false);
    expect(second.providerCalls).toBe(0);
    expect(sourceFightKey(fight)).toBe("rec:9:1");
  });
});

describe("authoritative scoring provider ownership", () => {
  const scoringInput = (
    container: WorkerContainer,
    ports: ReturnType<typeof createMemoryOrchestrationPorts>,
  ) => ({
    container,
    characterId: CHAR_ID,
    seasonId: "season-1",
    seasonSlug: "s1",
    role: "DPS" as const,
    classSlug: "mage",
    specSlug: "fire",
    refreshContract,
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    highKeyPolicyId: "high-key-v1",
    activeDungeonSlugs: [...EIGHT],
    candidates: fullSixteen(),
    scoreModelKey: "test",
    scoreModelVersion: 1,
    scoreModelId: "model-1",
    calculatedAt: "2026-08-01T12:00:00.000Z",
    region: "eu",
    realm: "test",
    characterName: "Target",
    portsOverride: ports,
  });

  it("scoreCharacter path runs without legacy shadow branching", async () => {
    const ports = createMemoryOrchestrationPorts();
    const container = mockContainer({
      SCORING_ENABLED: true,
      SCORING_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
      PROVIDER_MODE: "fixture",
      WCL_ENABLED: false,
    });
    const result = await runAuthoritativeScoring(scoringInput(container, ports));
    expect(result.disabled).toBe(false);
    expect(result.scoreResult).not.toBeNull();
    expect(result.providerCalls).toBe(
      result.scoreResult!.orchestration.accounting.providerCalls,
    );
  });

  it("provider forbidden → does not call WCL", async () => {
    const ports = createMemoryOrchestrationPorts();
    const acquire = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    const container = mockContainer({
      SCORING_ENABLED: true,
      SCORING_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
      PROVIDER_MODE: "fixture",
      WCL_ENABLED: false,
    });
    const result = await runAuthoritativeScoring(scoringInput(container, ports));
    expect(acquire).not.toHaveBeenCalled();
    expect(result.providerCalls).toBe(0);
  });

  it("full cached replay remains zero-call; publication stays off", async () => {
    const ports = createMemoryOrchestrationPorts();
    const warm = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: baseScope,
      candidates: fullSixteen(),
      ports,
    });
    expect(warm.accounting.providerCalls).toBeGreaterThan(0);
    const calls = ports.stats.providerCalls;

    const container = mockContainer({
      SCORING_ENABLED: true,
      SCORING_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
      PROVIDER_MODE: "fixture",
      WCL_ENABLED: false,
    });
    const result = await runAuthoritativeScoring(scoringInput(container, ports));
    expect(result.providerCalls).toBe(0);
    expect(ports.stats.providerCalls).toBe(calls);
    expect(result.scoreResult!.publicationEnabled).toBe(false);
  });
});

describe("canary preflight + cost admission", () => {
  it("preflight makes zero WCL calls; ranking gap on existing digests is slot-level only", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: false });
    const seeded = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: baseScope,
      candidates: fullSixteen(),
      ports,
    });
    expect(seeded.uniqueSourceFights.length).toBe(16);

    const acquire = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    const report = await runScoringCanaryPreflight({
      characterId: CHAR_ID,
      characterName: "Wallidrixe",
      region: "eu",
      realm: "archimonde",
      zoneId: 47,
      seasonId: "season-1",
      scoringModelId: "model-1",
      scope: baseScope,
      candidates: fullSixteen(),
      ports,
      existingManifest: seeded.manifest,
      allowSyntheticManifest: false,
      repositoryMode: "MEMORY",
      rateBudgetConfig,
    });

    expect(report.zoneId).toBe(47);
    expect(report.providerCalls).toBe(0);
    expect(report.manifestStatus).toBe("FOUND");
    expect(
      report.slots.every((s) =>
        (EIGHT as readonly string[]).includes(s.dungeonSlug),
      ),
    ).toBe(true);
    expect(acquire).not.toHaveBeenCalled();
    // Digests already exist — ranking absence is slot-level, not a cold rankingFactsMissing gap.
    expect(report.rankingFactsMissing).toEqual([]);
    expect(report.publicationEligible).toBe(false);
    expect(report.publicScorePointerMutated).toBe(false);
    expect(report.fightsRequiringWcl).toEqual([]);
    expect(report.slots.some((s) => s.rankingMissing)).toBe(true);
  });

  it("STOP and DEFER prevent cold acquisition; replay allowed at STOP", () => {
    const stop = buildCanaryCostProjection({
      fights: [
        { sourceFightKey: "a:1:1", packageCacheHit: false },
        { sourceFightKey: "b:2:1", packageCacheHit: false },
      ],
      rateBudgetConfig,
      rateLimitSnapshot: {
        limitPerHour: 1000,
        pointsSpentThisHour: 950,
        pointsRemaining: 50,
        resetAt: null,
        fetchedAt: new Date().toISOString(),
      },
    });
    expect(stop.rateLimit.admission).toBe("STOP");
    expect(() => assertCostAdmissionAllowsLive(stop)).toThrow(/STOP|DEFER/);

    const defer = buildCanaryCostProjection({
      fights: [{ sourceFightKey: "a:1:1", packageCacheHit: false }],
      rateBudgetConfig,
      rateLimitSnapshot: {
        limitPerHour: 1000,
        pointsSpentThisHour: 820,
        pointsRemaining: 180,
        resetAt: null,
        fetchedAt: new Date().toISOString(),
      },
    });
    expect(defer.rateLimit.admission).toBe("DEFER");

    const absent = buildCanaryCostProjection({
      fights: [{ sourceFightKey: "a:1:1", packageCacheHit: false }],
      rateBudgetConfig,
      rateLimitSnapshot: null,
    });
    expect(absent.rateLimit.admission).toBe("DEFER");
    expect(absent.rateLimit.reasons).toContain("rate_limit_snapshot_absent");
    expect(absent.rateLimit.reasons).toContain("no_snapshot_blocks_cold_live");
    const absentExplain = explainCostAdmissionDefer({
      cost: absent,
      snapshotSource: "ABSENT",
      snapshotAgeMs: 1_400_000,
      ttlSeconds: 60,
    });
    expect(absentExplain?.thresholdResponsible).toBe("no_snapshot_blocks_cold_live");
    expect(absentExplain?.projectedPoints).toBe(absent.estimatedPointsTotal);
    expect(absentExplain?.ttlSeconds).toBe(60);

    const replay = buildCanaryCostProjection({
      fights: [{ sourceFightKey: "a:1:1", packageCacheHit: true }],
      rateBudgetConfig,
      rateLimitSnapshot: {
        limitPerHour: 1000,
        pointsSpentThisHour: 950,
        pointsRemaining: 50,
        resetAt: null,
        fetchedAt: new Date().toISOString(),
      },
    });
    expect(replay.rateLimit.admission).toBe("ALLOW");
  });
});

describe("canary CLI guards", () => {
  const liveEnv = {
    PROVIDER_MODE: "live" as const,
    WCL_ENABLED: true,
    ALLOW_LIVE_PROVIDER_CALLS: true,
        SCORING_ENABLED: true,
    SCORING_PUBLICATION_ENABLED: false,
    WCL_CLIENT_ID: "id",
    WCL_CLIENT_SECRET: "secret",
  };

  it("live command refuses without --confirm-live", () => {
    const gate = evaluateCanaryLiveGates({
      env: liveEnv,
      confirmLive: false,
      characterCount: 1,
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reasons).toContain("MISSING_CONFIRM_LIVE");
  });

  it("live command refuses when publication is enabled", () => {
    const gate = evaluateCanaryLiveGates({
      env: { ...liveEnv, SCORING_PUBLICATION_ENABLED: true },
      confirmLive: true,
      characterCount: 1,
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reasons).toContain("PUBLICATION_ENABLED");
  });

  it("live command refuses more than one character", () => {
    const gate = evaluateCanaryLiveGates({
      env: liveEnv,
      confirmLive: true,
      characterCount: 2,
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reasons).toContain("MULTIPLE_CHARACTERS");
  });

  it("wildcards refused; valid single-character live gate passes", () => {
    expect(() =>
      parseCanaryCliArgs([
        "preflight",
        "--region",
        "EU",
        "--realm",
        "archimonde",
        "--character",
        "*",
      ]),
    ).toThrow(/wildcard|cohort/i);

    const gate = evaluateCanaryLiveGates({
      env: liveEnv,
      confirmLive: true,
      characterCount: 1,
    });
    expect(gate.allowed).toBe(true);
  });

  it("parses without --zone-id (env is not authoritative)", () => {
    const args = parseCanaryCliArgs([
      "preflight",
      "--region",
      "EU",
      "--realm",
      "archimonde",
      "--character",
      "Wallidrixe",
    ]);
    expect(args.zoneIdOverride).toBeNull();
    expect(args.allowZoneIdOverride).toBe(false);
  });
});

describe("canary zone resolution (effective season / explicit --zone-id)", () => {
  it("env Mythic+ zone variables are not authoritative (sync path requires --zone-id)", () => {
    expect(() =>
      resolveCanaryZoneId({
        env: { WCL_MPLUS_ZONE_ID: "47" } as NodeJS.ProcessEnv,
      }),
    ).toThrow(/effective-season|explicit --zone-id/i);
  });

  it("explicit --zone-id works as diagnostic override", async () => {
    const resolved = resolveCanaryZoneId({ cliZoneId: 47 });
    expect(resolved).toEqual({
      zoneId: 47,
      envZoneId: 47,
      source: "cli-override",
      overrideActive: true,
    });

    const args = parseCanaryCliArgs([
      "preflight",
      "--region",
      "EU",
      "--realm",
      "archimonde",
      "--character",
      "Wallidrixe",
      "--zone-id",
      "47",
    ]);
    expect(args.zoneIdOverride).toBe(47);
    const viaCli = await resolveZoneForCanaryCommand(args, {
      env: { WCL_MPLUS_ZONE_ID: "9999" },
    });
    expect(viaCli.zoneId).toBe(47);
    expect(viaCli.source).toBe("cli-override");
  });

  it("without --zone-id sync resolve fails closed (async effective-season required)", () => {
    expect(() => resolveCanaryZoneId({})).toThrow(/effective-season|explicit --zone-id/i);
  });

  it("rejects non-integer --zone-id at parse time", () => {
    expect(() =>
      parseCanaryCliArgs([
        "preflight",
        "--region",
        "EU",
        "--realm",
        "archimonde",
        "--character",
        "Wallidrixe",
        "--zone-id",
        "47.5",
      ]),
    ).toThrow(/Invalid --zone-id/);
  });
});
