/**
 * Product-boundary: runAuthoritativeScoring supplies zoneId and aggregate provider.
 * Cold then warm → exactly one aggregate provider call.
 */
import { describe, expect, it, vi } from "vitest";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerContainer } from "../../container.js";
import { runAuthoritativeScoring } from "./refresh-bridge.js";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import {
  adaptPointsAndDamagePerformance,
  toPersistedPerformanceAggregate,
} from "@mplus/provider-warcraftlogs";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  hashPerformanceAggregateContent,
  toPerformanceAggregatePartitionKey,
} from "@mplus/contracts";
import type { CharacterPerformanceAggregateDTO } from "@mplus/database";
import { ScoringZoneConfigurationError } from "./scoring-zone.js";

const CHAR_ID = "22222222-2222-4222-8222-222222222222";
const SEASON_ID = "33333333-3333-4333-8333-333333333333";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const padPath = resolve(
  root,
  "tools/fixtures/warcraftlogs/wallidrixe-points-and-damage.json",
);

const refreshContract = {
  scoringModelKey: "test",
  scoringModelVersion: 1,
  observationSchemaVersion: "observations-v2",
  wclAdapterVersion: "points-and-damage-v1",
  blizzardAdapterVersion: "blizzard-v1",
  raiderIoAdapterVersion: "raiderio-v1",
  runSelectionVersion: "active-season-eight-v1",
  abilityCatalogVersion: "abilities-v1",
  mechanicCatalogVersion: "mechanics-v1",
  activeSeasonId: "midnight-season-1",
  zoneId: 47 as number | null,
  partition: null as number | null,
};

function candidates(): EvidenceCandidateMetadataV2[] {
  const dungeons = [
    "ara-kara",
    "city-of-threads",
    "the-dawnbreaker",
    "the-stonevault",
    "mists-of-tirna-scithe",
    "the-necrotic-wake",
    "siege-of-boralus",
    "grim-batol",
  ];
  return dungeons.flatMap((slug, i) => [
    {
      discoveryIdentity: { reportCode: `R${i}A`, fightId: 1 },
      reportRevision: 1,
      dungeonSlug: slug,
      keyLevel: 12,
      timed: true,
      runScore: 200,
      evidenceCompleteness: 1,
      completedAt: "2026-01-01T00:00:00.000Z",
      fightDurationMs: 1_800_000,
      actorId: 1,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: "test",
    },
    {
      discoveryIdentity: { reportCode: `R${i}B`, fightId: 2 },
      reportRevision: 1,
      dungeonSlug: slug,
      keyLevel: 12,
      timed: true,
      runScore: 190,
      evidenceCompleteness: 1,
      completedAt: "2026-01-01T00:00:00.000Z",
      fightDurationMs: 1_800_000,
      actorId: 1,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: "test",
    },
  ]);
}

describe("runAuthoritativeScoring performance aggregate product boundary", () => {
  it("rejects missing zoneId as configuration failure", async () => {
    const ports = createMemoryOrchestrationPorts();
    const container = {
      env: {
        SCORING_ENABLED: true,
        SCORING_PUBLICATION_ENABLED: false,
        ALLOW_LIVE_PROVIDER_CALLS: false,
        PROVIDER_MODE: "fixture",
        WCL_ENABLED: false,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      prisma: {
        scoreModel: {
          findUnique: vi.fn(async () => ({ config: {} })),
        },
        characterScore: {
          upsert: vi.fn(async ({ create }) => ({ id: "score-1", ...create })),
        },
      },
      providers: {},
      repositories: { artifacts: {}, evidence: {} },
      createRedisConnection: vi.fn(),
    } as unknown as WorkerContainer;

    await expect(
      runAuthoritativeScoring({
        container,
        characterId: CHAR_ID,
        seasonId: SEASON_ID,
        seasonSlug: "midnight-season-1",
        role: "DPS",
        classSlug: "mage",
        specSlug: "fire",
        refreshContract: { ...refreshContract, zoneId: null },
        evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
        highKeyPolicyId: "policy-1",
        activeDungeonSlugs: candidates().map((c) => c.dungeonSlug),
        candidates: candidates(),
        scoreModelKey: "test",
        scoreModelVersion: 1,
        scoreModelId: "model-1",
        calculatedAt: "2026-01-01T00:00:00.000Z",
        region: "EU",
        realm: "archimonde",
        characterName: "Tester",
        portsOverride: ports,
      }),
    ).rejects.toBeInstanceOf(ScoringZoneConfigurationError);
  });

  it("cold then warm live scoring: exactly one aggregate provider call", async () => {
    const fixture = JSON.parse(readFileSync(padPath, "utf8")) as {
      rawZoneRankingsPointsAndDamage: unknown;
    };
    const adapted = adaptPointsAndDamagePerformance({
      raw: fixture.rawZoneRankingsPointsAndDamage,
    });
    expect(adapted.state).toBe("OK");
    const compact = toPersistedPerformanceAggregate({
      record: adapted,
      zoneId: 47,
      partition: null,
    });
    const fingerprint = "fp-product-boundary";
    const contentHash = hashPerformanceAggregateContent({
      rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: "points_and_damage",
      zoneId: 47,
      partitionKey: toPerformanceAggregatePartitionKey(null),
      rawPayload: fixture.rawZoneRankingsPointsAndDamage,
      dungeonAggregates: compact.dungeonAggregates,
      global: compact.global,
      diagnostics: compact.diagnostics,
      sourceRequestFingerprint: fingerprint,
    });

    let stored: CharacterPerformanceAggregateDTO | null = null;
    const providerCalls = vi.fn(async () => {
      const now = new Date();
      stored = {
        id: "agg-product",
        characterId: CHAR_ID,
        seasonId: SEASON_ID,
        zoneId: 47,
        partitionKey: "current",
        rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
        metric: "points_and_damage",
        state: "OK",
        rawPayload: fixture.rawZoneRankingsPointsAndDamage,
        dungeonAggregates: compact.dungeonAggregates,
        globalSummary: compact.global,
        diagnostics: compact.diagnostics,
        contentHash,
        sourceRequestFingerprint: fingerprint,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + 43_200_000),
        compact,
      };
      return {
        record: adapted,
        rawPayload: fixture.rawZoneRankingsPointsAndDamage,
        sourceRequestFingerprint: fingerprint,
        providerCalls: 1,
      };
    });

    const ensure = vi.fn(async (input: { liveProviderPermission: string }) => {
      if (input.liveProviderPermission === "FORBIDDEN") {
        throw new Error("live path expected");
      }
      if (stored && stored.expiresAt.getTime() > Date.now()) {
        return {
          state: "AVAILABLE" as const,
          data: stored,
          reason: null,
          cache: "HIT" as const,
          providerCalls: 0,
          created: false,
          updated: false,
          aggregateRowId: stored.id,
          contentHash: stored.contentHash,
        };
      }
      const fetched = await providerCalls();
      return {
        state: "AVAILABLE" as const,
        data: stored!,
        reason: null,
        cache: "MISS" as const,
        providerCalls: fetched.providerCalls,
        created: true,
        updated: false,
        aggregateRowId: stored!.id,
        contentHash: stored!.contentHash,
      };
    });

    const ports = createMemoryOrchestrationPorts();
    const container = {
      env: {
        SCORING_ENABLED: true,
        SCORING_PUBLICATION_ENABLED: false,
        ALLOW_LIVE_PROVIDER_CALLS: true,
        PROVIDER_MODE: "live",
        WCL_ENABLED: true,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        WCL_CLIENT_ID: "x",
        WCL_CLIENT_SECRET: "y",
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      prisma: {
        scoreModel: {
          findUnique: vi.fn(async () => ({ config: {} })),
        },
        characterScore: {
          upsert: vi.fn(async ({ create }) => ({ id: "score-1", ...create })),
        },
      },
      providers: {
        warcraftlogs: {
          fetchCharacterPerformanceAggregate: providerCalls,
        },
      },
      repositories: { artifacts: {}, evidence: {}, wclSource: {} },
      createRedisConnection: vi.fn(),
    } as unknown as WorkerContainer;

    const base = {
      container,
      characterId: CHAR_ID,
      seasonId: SEASON_ID,
      seasonSlug: "midnight-season-1",
      role: "DPS" as const,
      classSlug: "mage",
      specSlug: "fire",
      refreshContract,
      evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
      highKeyPolicyId: "policy-1",
      activeDungeonSlugs: [...new Set(candidates().map((c) => c.dungeonSlug))],
      candidates: candidates(),
      scoreModelKey: "test",
      scoreModelVersion: 1,
      scoreModelId: "model-1",
      calculatedAt: "2026-01-01T00:00:00.000Z",
      region: "EU",
      realm: "archimonde",
      characterName: "Tester",
      portsOverride: ports,
      performanceAggregateProviderOverride: {
        fetchCharacterPerformanceAggregate: providerCalls,
      },
    };

    // Inject ensure via scoreCharacter by wrapping — use provider override path
    // through a custom ensure on the first call is hard; call scoreCharacter ensure
    // via performanceAggregateProvider + real ensure needs DB.
    // Use ensure override by calling scoreCharacter through a patched path:
    const { scoreCharacter } = await import("./score-character.js");
    const coldScore = await scoreCharacter({
      identity: {
        characterId: CHAR_ID,
        region: "EU",
        realm: "archimonde",
        characterName: "Tester",
      },
      seasonId: SEASON_ID,
      seasonSlug: "midnight-season-1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      activeDungeonSlugs: base.activeDungeonSlugs,
      candidates: base.candidates,
      evidenceCutoffAt: base.evidenceCutoffAt,
      highKeyPolicyId: base.highKeyPolicyId,
      scoringModelId: base.scoreModelId,
      allowProviderCalls: true,
      zoneId: 47,
      ports,
      prisma: container.prisma as never,
      artifacts: {} as never,
      evidence: {} as never,
      ensurePerformanceAggregate: ensure as never,
      performanceAggregateProvider: {
        fetchCharacterPerformanceAggregate: providerCalls,
      },
    });
    const warmScore = await scoreCharacter({
      identity: {
        characterId: CHAR_ID,
        region: "EU",
        realm: "archimonde",
        characterName: "Tester",
      },
      seasonId: SEASON_ID,
      seasonSlug: "midnight-season-1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      activeDungeonSlugs: base.activeDungeonSlugs,
      candidates: base.candidates,
      evidenceCutoffAt: base.evidenceCutoffAt,
      highKeyPolicyId: base.highKeyPolicyId,
      scoringModelId: base.scoreModelId,
      allowProviderCalls: true,
      zoneId: 47,
      ports,
      prisma: container.prisma as never,
      artifacts: {} as never,
      evidence: {} as never,
      ensurePerformanceAggregate: ensure as never,
      performanceAggregateProvider: {
        fetchCharacterPerformanceAggregate: async () => {
          throw new Error("warm must not call provider");
        },
      },
    });

    expect(providerCalls).toHaveBeenCalledTimes(1);
    expect(coldScore.performanceAggregate.cache).toBe("MISS");
    expect(warmScore.performanceAggregate.cache).toBe("HIT");
    expect(warmScore.performanceAggregate.providerCalls).toBe(0);
    expect(coldScore.orchestration.dimensions.performance?.score).toBe(
      warmScore.orchestration.dimensions.performance?.score,
    );
  });
});

describe("runAuthoritativeScoring Experience Phase 1 passthrough", () => {
  it("passes experienceOverride through to scoreCharacter persistence", async () => {
    const ports = createMemoryOrchestrationPorts();
    const saved: Array<Record<string, unknown>> = [];
    const getMythicKeystoneSeasonProfile = vi.fn(async () => {
      throw new Error("Experience override must skip Blizzard acquisition");
    });
    const getCharacterAchievements = vi.fn(async () => {
      throw new Error("Experience override must skip Blizzard acquisition");
    });
    const container = {
      env: {
        SCORING_ENABLED: true,
        SCORING_PUBLICATION_ENABLED: false,
        ALLOW_LIVE_PROVIDER_CALLS: false,
        PROVIDER_MODE: "fixture",
        WCL_ENABLED: false,
        BLIZZARD_ENABLED: true,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      prisma: {
        scoreModel: {
          findUnique: vi.fn(async () => ({ config: {} })),
        },
        characterScore: {
          upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
            saved.push(create);
            return { id: "score-exp-1", ...create };
          }),
        },
        characterPerformanceAggregate: {
          findUnique: vi.fn(async () => null),
        },
        season: {
          findUnique: vi.fn(async () => null),
          findMany: vi.fn(async () => []),
        },
      },
      providers: {
        blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
        warcraftlogs: {},
        raiderio: {},
      },
      disabledProviders: new Set(),
      repositories: { artifacts: {}, evidence: {}, externalRequest: {} },
      createRedisConnection: vi.fn(),
    } as unknown as WorkerContainer;

    const experience = {
      score: 90,
      available: true,
      previousStandingScore: 55,
      eliteFloorApplied: true,
      confirmedEliteTitleCount: 1,
      reason: null,
    };

    const result = await runAuthoritativeScoring({
      container,
      characterId: CHAR_ID,
      seasonId: SEASON_ID,
      seasonSlug: "midnight-season-1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      refreshContract,
      evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
      highKeyPolicyId: "policy-1",
      activeDungeonSlugs: candidates().map((c) => c.dungeonSlug),
      candidates: candidates(),
      scoreModelKey: "test",
      scoreModelVersion: 1,
      scoreModelId: "model-1",
      calculatedAt: "2026-01-01T00:00:00.000Z",
      region: "EU",
      realm: "archimonde",
      characterName: "Tester",
      portsOverride: ports,
      performanceAggregateProviderOverride: null,
      experienceOverride: experience,
    });

    expect(getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(getCharacterAchievements).not.toHaveBeenCalled();
    expect(result.scoreResult?.characterScoreId).toBe("score-exp-1");
    expect(saved[0]!.experience).toBe(90);
    const details = saved[0]!.dimensionDetails as { experience: typeof experience };
    expect(details.experience).toEqual(experience);
  });
});
