import { describe, expect, it, vi, beforeEach } from "vitest";
import { OWNED_CHARACTER_RELEVANCE_POLICY_V1 } from "@mplus/config";
import { QUEUE_NAMES } from "@mplus/contracts";
import { runDiscoverOwnedCharacters } from "./discover-owned-characters.js";
import {
  loadCharacterRefreshEligibilitySignals,
  runRefreshEligibilityGate,
} from "./refresh-eligibility-gate.js";
import { clearSeasonAuthorityCacheForTests } from "./season-authority.js";
import type { WorkerContainer } from "../container.js";

const EU_REGION = { id: "region-eu", code: "EU" };

function mythicProfile(rating: number, seasonIds: number[] = [17]) {
  return {
    data: {
      currentMythicRating: rating,
      currentSeasonId: 17,
      seasons: seasonIds.map((seasonId) => ({ seasonId })),
    },
    provenance: {},
    metadata: { cacheHit: true },
    freshness: {},
  };
}

function seasonPrismaMocks() {
  const seasonRow = {
    id: "season-1",
    slug: "blizzard-season-17",
    blizzardSeasonId: 17,
    regionId: EU_REGION.id,
    isCurrent: true,
    metadata: {
      blizzardSeasonId: 17,
      source: "blizzard",
    },
  };
  return {
    findFirst: vi.fn(async () => seasonRow),
    updateMany: vi.fn(async () => ({ count: 0 })),
    update: vi.fn(async ({ data }: { data?: Record<string, unknown> } = {}) => ({
      ...seasonRow,
      ...data,
      metadata: {
        ...seasonRow.metadata,
        ...((data?.metadata as Record<string, unknown> | undefined) ?? {}),
      },
    })),
    create: vi.fn(async () => seasonRow),
  };
}

/** Prisma stubs required once discovery persists eligibility evidence. */
function eligibilityPersistPrismaMocks() {
  return {
    character: {
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => null),
    },
    characterSnapshot: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
    metricObservation: {
      findFirst: vi.fn(async () => null),
    },
  };
}

function baseProviders(getMythicKeystoneProfile: ReturnType<typeof vi.fn>) {
  return {
    blizzard: {
      getMythicKeystoneProfile,
      resolveAuthoritativeCurrentSeasonId: vi.fn(async () => ({
        data: {
          seasonId: 17,
          slug: "blizzard-season-17",
          source: "season_index.current_season" as const,
        },
        provenance: {},
        metadata: { cacheHit: true },
        freshness: {},
      })),
    },
    warcraftlogs: { discoverCharacterRuns: vi.fn() },
  };
}

describe("runDiscoverOwnedCharacters", () => {
  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
  });

  it("skips Mythic+ rating for non-max-level and does not call WCL", async () => {
    const getMythicKeystoneProfile = vi.fn();
    const ownerships = [
      {
        id: "o-low",
        status: "CURRENT",
        characterLevel: 80,
        characterName: "Lowbie",
        realmSlug: "tarren-mill",
        playableClassId: 1,
        blizzardCharacterId: 1n,
        isPrimary: false,
        characterId: null,
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: EU_REGION,
      },
      {
        id: "o-max",
        status: "CURRENT",
        characterLevel: OWNED_CHARACTER_RELEVANCE_POLICY_V1.maxCharacterLevel,
        characterName: "Main",
        realmSlug: "tarren-mill",
        playableClassId: 8,
        blizzardCharacterId: 2n,
        isPrimary: false,
        characterId: null,
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: EU_REGION,
      },
      {
        id: "o-89",
        status: "CURRENT",
        characterLevel: 89,
        characterName: "Almost",
        realmSlug: "tarren-mill",
        playableClassId: 3,
        blizzardCharacterId: 3n,
        isPrimary: false,
        characterId: null,
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: EU_REGION,
      },
    ];

    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
        update: vi.fn(async () => ({})),
      },
      season: seasonPrismaMocks(),
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: where.id, data });
          return {};
        }),
      },
      characterPublishedScore: { findFirst: vi.fn(async () => null) },
      ingestionJob: { findFirst: vi.fn(async () => null) },
      ...eligibilityPersistPrismaMocks(),
    };

    const upsertCharacter = vi.fn(async () => ({ id: "char-1" }));
    const enqueueRefreshCharacter = vi.fn(async () => ({
      jobId: "job-1",
      dedupeKey: "d",
      reused: false,
      enqueued: true,
    }));

    const providers = baseProviders(getMythicKeystoneProfile);
    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        PROVIDER_MODE: "fixture",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers,
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1", key: "default", version: 6 })) },
        character: { upsertCharacter },
      },
    } as unknown as WorkerContainer;

    getMythicKeystoneProfile.mockResolvedValue(mythicProfile(1500));

    const result = await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "blizzard-season-17",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    expect(getMythicKeystoneProfile).toHaveBeenCalledTimes(1);
    expect(providers.blizzard.resolveAuthoritativeCurrentSeasonId).toHaveBeenCalled();
    expect(providers.warcraftlogs.discoverCharacterRuns).not.toHaveBeenCalled();
    expect(result.counters.ownershipCount).toBe(3);
    expect(result.counters.maxLevelCount).toBe(1);
    expect(result.counters.ratingCheckedCount).toBe(1);
    expect(result.counters.relevantCount).toBe(1);
    expect(result.counters.irrelevantCount).toBe(2);
    expect(result.counters.autoRefreshEligibleCount).toBe(1);
    expect(result.counters.refreshQueuedCount).toBe(1);
    expect(upsertCharacter).toHaveBeenCalled();
    expect(enqueueRefreshCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Main",
        priority: expect.any(String),
        triggerSource: "ACCOUNT_DISCOVERY",
      }),
    );

    expect(updates.find((u) => u.id === "o-low")?.data.relevanceEligible).toBe(false);
    expect(updates.find((u) => u.id === "o-89")?.data.relevanceEligible).toBe(false);
    expect(updates.find((u) => u.id === "o-max" && u.data.relevanceEligible === true)?.data.relevancePolicyVersion).toBe(
      "v1",
    );
    expect(
      updates.find((u) => u.id === "o-max" && u.data.currentSeasonMythicSeasonId != null)?.data
        .currentSeasonMythicSeasonId,
    ).toBe("season-1");
    expect(prisma.character.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { level: OWNED_CHARACTER_RELEVANCE_POLICY_V1.maxCharacterLevel },
      }),
    );
  });

  it("does not auto-refresh primary or public-score characters below rating threshold", async () => {
    const getMythicKeystoneProfile = vi.fn(async () => mythicProfile(500));
    const ownerships = [
      {
        id: "o-primary-low",
        status: "CURRENT",
        characterLevel: 90,
        characterName: "PrimaryLow",
        realmSlug: "tarren-mill",
        playableClassId: 8,
        blizzardCharacterId: 9n,
        isPrimary: true,
        characterId: "char-primary",
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: EU_REGION,
      },
      {
        id: "o-scored-low",
        status: "CURRENT",
        characterLevel: 90,
        characterName: "ScoredLow",
        realmSlug: "tarren-mill",
        playableClassId: 8,
        blizzardCharacterId: 10n,
        isPrimary: false,
        characterId: "char-scored",
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: EU_REGION,
      },
    ];

    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
        update: vi.fn(async () => ({})),
      },
      season: seasonPrismaMocks(),
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(async () => ({})),
      },
      characterPublishedScore: {
        findFirst: vi.fn(async ({ where }: { where: { characterId: string } }) =>
          where.characterId === "char-scored"
            ? {
                publishedSnapshot: {
                  isPublic: true,
                  calculatedAt: new Date(),
                },
              }
            : null,
        ),
      },
      ingestionJob: { findFirst: vi.fn(async () => null) },
    };

    const enqueueRefreshCharacter = vi.fn();
    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        PROVIDER_MODE: "fixture",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers: baseProviders(getMythicKeystoneProfile),
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1" })) },
        character: { upsertCharacter: vi.fn(async () => ({ id: "char-x" })) },
      },
    } as unknown as WorkerContainer;

    const result = await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "blizzard-season-17",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    // Display relevance may still mark them relevant; auto-refresh must not.
    expect(result.counters.relevantCount).toBeGreaterThanOrEqual(1);
    expect(result.counters.autoRefreshEligibleCount).toBe(0);
    expect(enqueueRefreshCharacter).not.toHaveBeenCalled();
  });

  it("does not enqueue refresh when a fresh score already exists for an eligible character", async () => {
    const getMythicKeystoneProfile = vi.fn(async () => mythicProfile(1500));
    const ownerships = [
      {
        id: "o-scored",
        status: "CURRENT",
        characterLevel: 90,
        characterName: "Scored",
        realmSlug: "tarren-mill",
        playableClassId: 8,
        blizzardCharacterId: 9n,
        isPrimary: false,
        characterId: "char-scored",
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: EU_REGION,
      },
    ];

    const freshCalculatedAt = new Date();
    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
        update: vi.fn(async () => ({})),
      },
      season: seasonPrismaMocks(),
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(async () => ({})),
      },
      characterPublishedScore: {
        findFirst: vi.fn(async () => ({
          publishedSnapshot: {
            isPublic: true,
            calculatedAt: freshCalculatedAt,
          },
        })),
      },
      ingestionJob: { findFirst: vi.fn(async () => null) },
      ...eligibilityPersistPrismaMocks(),
    };

    const enqueueRefreshCharacter = vi.fn();
    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        PROVIDER_MODE: "fixture",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers: baseProviders(getMythicKeystoneProfile),
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1" })) },
        character: { upsertCharacter: vi.fn(async () => ({ id: "char-scored" })) },
      },
    } as unknown as WorkerContainer;

    const result = await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "blizzard-season-17",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    expect(result.counters.autoRefreshEligibleCount).toBe(1);
    expect(result.counters.existingFreshScoreCount).toBe(1);
    expect(enqueueRefreshCharacter).not.toHaveBeenCalled();
    expect(QUEUE_NAMES.discoverOwnedCharacters).toBe("discover-owned-characters");
  });

  it("enqueues refresh when published score calculatedAt is past SCORE_TTL and rating eligible", async () => {
    const getMythicKeystoneProfile = vi.fn(async () => mythicProfile(1500));
    const ownerships = [
      {
        id: "o-stale",
        status: "CURRENT",
        characterLevel: 90,
        characterName: "Stale",
        realmSlug: "tarren-mill",
        playableClassId: 8,
        blizzardCharacterId: 10n,
        isPrimary: false,
        characterId: "char-stale",
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: EU_REGION,
      },
    ];

    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
        update: vi.fn(async () => ({})),
      },
      season: seasonPrismaMocks(),
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(async () => ({})),
      },
      characterPublishedScore: {
        findFirst: vi.fn(async () => ({
          publishedSnapshot: {
            isPublic: true,
            calculatedAt: new Date(Date.now() - 8 * 86_400_000),
          },
        })),
      },
      ingestionJob: { findFirst: vi.fn(async () => null) },
      ...eligibilityPersistPrismaMocks(),
    };

    const enqueueRefreshCharacter = vi.fn(async () => ({
      jobId: "job-stale",
      dedupeKey: "d",
      reused: false,
      enqueued: true,
    }));
    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        PROVIDER_MODE: "fixture",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers: baseProviders(getMythicKeystoneProfile),
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1" })) },
        character: { upsertCharacter: vi.fn(async () => ({ id: "char-stale" })) },
      },
    } as unknown as WorkerContainer;

    const result = await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "blizzard-season-17",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    expect(result.counters.existingFreshScoreCount).toBe(0);
    expect(enqueueRefreshCharacter).toHaveBeenCalledTimes(1);
  });

  it("does not auto-refresh rating 999", async () => {
    const getMythicKeystoneProfile = vi.fn(async () => mythicProfile(999));
    const ownerships = [
      {
        id: "o-999",
        status: "CURRENT",
        characterLevel: 90,
        characterName: "AlmostRated",
        realmSlug: "tarren-mill",
        playableClassId: 8,
        blizzardCharacterId: 11n,
        isPrimary: false,
        characterId: null,
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: EU_REGION,
      },
    ];
    const enqueueRefreshCharacter = vi.fn();
    const container = {
      prisma: {
        battleNetAccount: {
          findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
          update: vi.fn(async () => ({})),
        },
        season: seasonPrismaMocks(),
        verifiedCharacterOwnership: {
          findMany: vi.fn(async () => ownerships),
          update: vi.fn(async () => ({})),
        },
        characterPublishedScore: { findFirst: vi.fn(async () => null) },
        ingestionJob: { findFirst: vi.fn(async () => null) },
      },
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        PROVIDER_MODE: "fixture",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers: baseProviders(getMythicKeystoneProfile),
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1" })) },
        character: { upsertCharacter: vi.fn(async () => ({ id: "c" })) },
      },
    } as unknown as WorkerContainer;

    const result = await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "blizzard-season-17",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    expect(result.counters.autoRefreshEligibleCount).toBe(0);
    expect(enqueueRefreshCharacter).not.toHaveBeenCalled();
  });

  it("continues when one character refresh enqueue fails", async () => {
    const getMythicKeystoneProfile = vi.fn(async ({ name }: { name: string }) =>
      mythicProfile(name === "Failing" ? 1800 : 1900),
    );
    const ownerships = ["Failing", "Ok"].map((name, i) => ({
      id: `o-${i}`,
      status: "CURRENT",
      characterLevel: 90,
      characterName: name,
      realmSlug: "tarren-mill",
      playableClassId: 8,
      blizzardCharacterId: BigInt(100 + i),
      isPrimary: false,
      characterId: null,
      relevanceReasons: null,
      relevanceEligible: null,
      currentSeasonMythicRating: null,
      currentSeasonMythicFetchedAt: null,
      currentSeasonMythicSource: null,
      currentSeasonMythicSeasonId: null,
      region: EU_REGION,
    }));

    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
        update: vi.fn(async () => ({})),
      },
      season: seasonPrismaMocks(),
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(async () => ({})),
      },
      characterPublishedScore: { findFirst: vi.fn(async () => null) },
      ingestionJob: { findFirst: vi.fn(async () => null) },
      ...eligibilityPersistPrismaMocks(),
    };

    const enqueueRefreshCharacter = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue down"))
      .mockResolvedValueOnce({ jobId: "j2", dedupeKey: "d", reused: false, enqueued: true });

    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        PROVIDER_MODE: "fixture",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers: baseProviders(getMythicKeystoneProfile),
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1" })) },
        character: {
          upsertCharacter: vi.fn(async (identity: { name: string }) => ({
            id: identity.name === "Failing" ? "c-fail" : "c-ok",
          })),
        },
      },
    } as unknown as WorkerContainer;

    const result = await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "blizzard-season-17",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    expect(result.counters.autoRefreshEligibleCount).toBe(2);
    expect(result.counters.failedCount).toBeGreaterThanOrEqual(1);
    expect(result.counters.refreshQueuedCount).toBe(1);
  });

  it("resolves EU and US seasons independently and caches per region", async () => {
    const getMythicKeystoneProfile = vi.fn(async () => mythicProfile(2000));
    const resolveAuthoritativeCurrentSeasonId = vi.fn(async (ctx: { region: string }) => ({
      data: {
        seasonId: ctx.region === "us" ? 16 : 17,
        slug: ctx.region === "us" ? "blizzard-season-16" : "blizzard-season-17",
        source: "season_index.current_season" as const,
      },
      provenance: {},
      metadata: { cacheHit: false },
      freshness: {},
    }));

    const seasonsCreated: number[] = [];
    const ownerships = [
      {
        id: "o-eu",
        status: "CURRENT",
        characterLevel: 90,
        characterName: "EuMain",
        realmSlug: "tarren-mill",
        playableClassId: 8,
        blizzardCharacterId: 1n,
        isPrimary: false,
        characterId: null,
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: { id: "region-eu", code: "EU" },
      },
      {
        id: "o-eu-2",
        status: "CURRENT",
        characterLevel: 90,
        characterName: "EuAlt",
        realmSlug: "tarren-mill",
        playableClassId: 8,
        blizzardCharacterId: 2n,
        isPrimary: false,
        characterId: null,
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: { id: "region-eu", code: "EU" },
      },
      {
        id: "o-us",
        status: "CURRENT",
        characterLevel: 90,
        characterName: "UsMain",
        realmSlug: "area-52",
        playableClassId: 8,
        blizzardCharacterId: 3n,
        isPrimary: false,
        characterId: null,
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: { id: "region-us", code: "US" },
      },
    ];

    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
        update: vi.fn(async () => ({})),
      },
      season: {
        findFirst: vi.fn(async ({ where }: { where: { regionId?: string; slug?: string } }) => {
          if (where.slug === "blizzard-season-17") {
            return {
              id: "s-eu",
              slug: "blizzard-season-17",
              blizzardSeasonId: 17,
              regionId: "region-eu",
              isCurrent: true,
              metadata: {},
            };
          }
          if (where.slug === "blizzard-season-16") {
            return {
              id: "s-us",
              slug: "blizzard-season-16",
              blizzardSeasonId: 16,
              regionId: "region-us",
              isCurrent: true,
              metadata: {},
            };
          }
          return null;
        }),
        updateMany: vi.fn(async () => ({ count: 0 })),
        update: vi.fn(async ({ data }: { data: { blizzardSeasonId?: number } }) => {
          if (data.blizzardSeasonId != null) seasonsCreated.push(data.blizzardSeasonId);
          return {
            id: data.blizzardSeasonId === 16 ? "s-us" : "s-eu",
            slug: `blizzard-season-${data.blizzardSeasonId}`,
            blizzardSeasonId: data.blizzardSeasonId,
            isCurrent: true,
            metadata: {},
          };
        }),
        create: vi.fn(async ({ data }: { data: { blizzardSeasonId: number } }) => {
          seasonsCreated.push(data.blizzardSeasonId);
          return {
            id: data.blizzardSeasonId === 16 ? "s-us" : "s-eu",
            slug: `blizzard-season-${data.blizzardSeasonId}`,
            blizzardSeasonId: data.blizzardSeasonId,
            isCurrent: true,
            metadata: {},
          };
        }),
      },
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(async () => ({})),
      },
      characterPublishedScore: { findFirst: vi.fn(async () => null) },
      ingestionJob: { findFirst: vi.fn(async () => null) },
      ...eligibilityPersistPrismaMocks(),
    };

    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        PROVIDER_MODE: "fixture",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers: {
        blizzard: { getMythicKeystoneProfile, resolveAuthoritativeCurrentSeasonId },
        warcraftlogs: {},
      },
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1" })) },
        character: {
          upsertCharacter: vi.fn(async (identity: { name: string }) => ({
            id: `c-${identity.name}`,
          })),
        },
      },
    } as unknown as WorkerContainer;

    await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "current",
        requestedAt: new Date().toISOString(),
      },
      {
        enqueueRefreshCharacter: vi.fn(async () => ({
          jobId: "j",
          dedupeKey: "d",
          reused: false,
          enqueued: true,
        })),
      },
    );

    // One resolve per region despite two EU characters.
    expect(resolveAuthoritativeCurrentSeasonId).toHaveBeenCalledTimes(2);
    const regions = resolveAuthoritativeCurrentSeasonId.mock.calls.map(
      (c: [{ region: string }]) => c[0].region,
    );
    expect(regions.sort()).toEqual(["eu", "us"]);
  });

  it("persists Character.level + season-row rating evidence before enqueue so the gate passes", async () => {
    const getMythicKeystoneProfile = vi.fn(async () => mythicProfile(2100));
    const ownerships = [
      {
        id: "o-evidence",
        status: "CURRENT",
        characterLevel: OWNED_CHARACTER_RELEVANCE_POLICY_V1.maxCharacterLevel,
        characterName: "Evidence",
        realmSlug: "tarren-mill",
        playableClassId: 8,
        blizzardCharacterId: 42n,
        isPrimary: false,
        characterId: null,
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: EU_REGION,
      },
    ];

    const characterState = { id: "char-evidence", level: null as number | null, regionId: EU_REGION.id };
    const ownershipRows: Array<{
      characterId: string | null;
      currentSeasonMythicRating: number | null;
      currentSeasonMythicSeasonId: string | null;
      currentSeasonMythicFetchedAt: Date | null;
    }> = [];
    const snapshots: Array<{ mythicRating: number | null; rawSummary: unknown }> = [];
    const callOrder: string[] = [];

    const characterUpdate = vi.fn(async ({ data }: { data: { level?: number } }) => {
      callOrder.push("persist.level");
      if (data.level != null) characterState.level = data.level;
      return characterState;
    });
    const snapshotCreate = vi.fn(async ({ data }: { data: { mythicRating: number; rawSummary: unknown } }) => {
      callOrder.push("persist.snapshot");
      snapshots.push({ mythicRating: data.mythicRating, rawSummary: data.rawSummary });
      return data;
    });
    const enqueueRefreshCharacter = vi.fn(async () => {
      callOrder.push("enqueue");
      return { jobId: "job-evidence", dedupeKey: "d", reused: false, enqueued: true };
    });

    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
        update: vi.fn(async () => ({})),
      },
      season: seasonPrismaMocks(),
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(
          async ({
            data,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            if (data.currentSeasonMythicSeasonId != null || data.currentSeasonMythicRating != null) {
              ownershipRows.push({
                characterId: (data.characterId as string | null | undefined) ?? null,
                currentSeasonMythicRating: (data.currentSeasonMythicRating as number | null) ?? null,
                currentSeasonMythicSeasonId: (data.currentSeasonMythicSeasonId as string | null) ?? null,
                currentSeasonMythicFetchedAt: (data.currentSeasonMythicFetchedAt as Date | null) ?? null,
              });
            }
            if (data.characterId != null) {
              ownerships[0].characterId = data.characterId as string;
            }
            return {};
          },
        ),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const seasonId = where.currentSeasonMythicSeasonId;
          const match = ownershipRows.find(
            (row) =>
              row.currentSeasonMythicSeasonId === seasonId &&
              row.currentSeasonMythicRating != null,
          );
          return match
            ? {
                currentSeasonMythicRating: match.currentSeasonMythicRating,
                currentSeasonMythicSeasonId: match.currentSeasonMythicSeasonId,
              }
            : null;
        }),
      },
      characterPublishedScore: { findFirst: vi.fn(async () => null) },
      ingestionJob: { findFirst: vi.fn(async () => null) },
      character: {
        update: characterUpdate,
        findUnique: vi.fn(async () => ({
          id: characterState.id,
          level: characterState.level,
          regionId: characterState.regionId,
        })),
      },
      characterSnapshot: {
        create: snapshotCreate,
        findMany: vi.fn(async () => snapshots),
      },
      metricObservation: { findFirst: vi.fn(async () => null) },
    };

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        PROVIDER_MODE: "fixture",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
      },
      logger,
      providers: baseProviders(getMythicKeystoneProfile),
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1", key: "default", version: 6 })) },
        character: {
          upsertCharacter: vi.fn(async () => ({ id: characterState.id })),
        },
      },
    } as unknown as WorkerContainer;

    const result = await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "blizzard-season-17",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    expect(result.counters.refreshQueuedCount).toBe(1);
    expect(characterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: characterState.id },
        data: { level: OWNED_CHARACTER_RELEVANCE_POLICY_V1.maxCharacterLevel },
      }),
    );
    expect(ownershipRows.some((row) => row.currentSeasonMythicSeasonId === "season-1")).toBe(true);
    expect(ownershipRows.some((row) => row.currentSeasonMythicSeasonId === "blizzard-season-17")).toBe(
      false,
    );
    expect(snapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          characterId: characterState.id,
          mythicRating: 2100,
          rawSummary: {
            eligibility: { authoritativeSeasonId: "season-1" },
          },
        }),
      }),
    );
    expect(callOrder.indexOf("persist.level")).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf("persist.snapshot")).toBeGreaterThan(callOrder.indexOf("persist.level"));
    expect(callOrder.indexOf("enqueue")).toBeGreaterThan(callOrder.indexOf("persist.snapshot"));

    const authority = {
      regionCode: "EU",
      regionId: EU_REGION.id,
      seasonRowId: "season-1",
      blizzardSeasonId: 17,
      slug: "blizzard-season-17",
      authoritySource: "season_index.current_season" as const,
      authorityVerifiedAt: new Date(),
      resolution: "memory" as const,
    };

    // Link ownership characterId for gate ownership lookup (discovery already did).
    prisma.verifiedCharacterOwnership.findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.characterId !== characterState.id) return null;
      if (where.currentSeasonMythicSeasonId !== "season-1") return null;
      return {
        currentSeasonMythicRating: 2100,
        currentSeasonMythicSeasonId: "season-1",
      };
    });

    const signals = await loadCharacterRefreshEligibilitySignals(prisma as never, {
      characterId: characterState.id,
      authority,
    });
    expect(signals.characterLevel).toBe(OWNED_CHARACTER_RELEVANCE_POLICY_V1.maxCharacterLevel);
    expect(signals.currentSeasonMythicScore).toBe(2100);
    expect(signals.evidenceSource).toBe("ownership");

    const gate = await runRefreshEligibilityGate(
      { prisma: prisma as never, logger },
      {
        characterId: characterState.id,
        authority,
        jobId: "job-evidence",
        triggerSource: "ACCOUNT_DISCOVERY",
      },
    );
    expect(gate.eligible).toBe(true);
  });

  it("does not enqueue when eligibility persistence fails", async () => {
    const getMythicKeystoneProfile = vi.fn(async () => mythicProfile(2100));
    const ownerships = [
      {
        id: "o-persist-fail",
        status: "CURRENT",
        characterLevel: 90,
        characterName: "PersistFail",
        realmSlug: "tarren-mill",
        playableClassId: 8,
        blizzardCharacterId: 7n,
        isPrimary: false,
        characterId: null,
        relevanceReasons: null,
        relevanceEligible: null,
        currentSeasonMythicRating: null,
        currentSeasonMythicFetchedAt: null,
        currentSeasonMythicSource: null,
        currentSeasonMythicSeasonId: null,
        region: EU_REGION,
      },
    ];

    const enqueueRefreshCharacter = vi.fn();
    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
        update: vi.fn(async () => ({})),
      },
      season: seasonPrismaMocks(),
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(async () => ({})),
      },
      characterPublishedScore: { findFirst: vi.fn(async () => null) },
      ingestionJob: { findFirst: vi.fn(async () => null) },
      character: {
        update: vi.fn(async () => {
          throw new Error("level persist failed");
        }),
      },
      characterSnapshot: { create: vi.fn(async () => ({})) },
    };

    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        PROVIDER_MODE: "fixture",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers: baseProviders(getMythicKeystoneProfile),
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1", key: "default", version: 6 })) },
        character: { upsertCharacter: vi.fn(async () => ({ id: "char-persist-fail" })) },
      },
    } as unknown as WorkerContainer;

    const result = await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "blizzard-season-17",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    expect(enqueueRefreshCharacter).not.toHaveBeenCalled();
    expect(result.counters.refreshQueuedCount).toBe(0);
    expect(result.counters.failedCount).toBeGreaterThanOrEqual(1);
  });
});
