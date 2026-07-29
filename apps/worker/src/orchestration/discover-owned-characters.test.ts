import { describe, expect, it, vi } from "vitest";
import { OWNED_CHARACTER_RELEVANCE_POLICY_V1 } from "@mplus/config";
import { QUEUE_NAMES } from "@mplus/contracts";
import { runDiscoverOwnedCharacters } from "./discover-owned-characters.js";
import type { WorkerContainer } from "../container.js";

describe("runDiscoverOwnedCharacters", () => {
  it("skips Mythic+ rating for non-max-level and does not call WCL", async () => {
    const getMythicKeystoneProfile = vi.fn();
    const discoverWcl = vi.fn();
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
        region: { code: "EU" },
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
        region: { code: "EU" },
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
        region: { code: "EU" },
      },
    ];

    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({
          id: "bnet-1",
          unlinkedAt: null,
        })),
        update: vi.fn(async () => ({})),
      },
      season: { findFirst: vi.fn(async () => ({ id: "season-1", slug: "season-tww-3" })) },
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: where.id, data });
          return {};
        }),
      },
      characterPublishedScore: { findFirst: vi.fn(async () => null) },
      ingestionJob: { findFirst: vi.fn(async () => null) },
    };

    const upsertCharacter = vi.fn(async () => ({ id: "char-1" }));
    const enqueueRefreshCharacter = vi.fn(async () => ({
      jobId: "job-1",
      dedupeKey: "d",
      reused: false,
      enqueued: true,
    }));

    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers: {
        blizzard: { getMythicKeystoneProfile },
        warcraftlogs: { discoverCharacterRuns: discoverWcl },
      },
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1", key: "default", version: 6 })) },
        character: { upsertCharacter },
      },
    } as unknown as WorkerContainer;

    getMythicKeystoneProfile.mockResolvedValue({
      data: { currentMythicRating: 1500 },
      provenance: {},
      metadata: {},
      freshness: {},
    });

    const result = await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "season-tww-3",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    expect(getMythicKeystoneProfile).toHaveBeenCalledTimes(1);
    expect(getMythicKeystoneProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Main" }),
      expect.anything(),
    );
    expect(discoverWcl).not.toHaveBeenCalled();
    expect(result.counters.ownershipCount).toBe(3);
    expect(result.counters.maxLevelCount).toBe(1);
    expect(result.counters.ratingCheckedCount).toBe(1);
    expect(result.counters.relevantCount).toBe(1);
    expect(result.counters.irrelevantCount).toBe(2);
    expect(result.counters.refreshQueuedCount).toBe(1);
    expect(upsertCharacter).toHaveBeenCalled();
    expect(enqueueRefreshCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Main",
        priority: expect.any(String),
      }),
    );

    const lowUpdate = updates.find((u) => u.id === "o-low");
    expect(lowUpdate?.data.relevanceEligible).toBe(false);

    const almostUpdate = updates.find((u) => u.id === "o-89");
    expect(almostUpdate?.data.relevanceEligible).toBe(false);

    const maxEligible = updates.find((u) => u.id === "o-max" && u.data.relevanceEligible === true);
    expect(maxEligible?.data.relevancePolicyVersion).toBe("v1");
  });

  it("does not enqueue refresh when a fresh score already exists", async () => {
    const getMythicKeystoneProfile = vi.fn(async () => ({
      data: { currentMythicRating: 500 },
      provenance: {},
      metadata: {},
      freshness: {},
    }));
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
        region: { code: "EU" },
      },
    ];

    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
        update: vi.fn(async () => ({})),
      },
      season: { findFirst: vi.fn(async () => ({ id: "season-1", slug: "season-tww-3" })) },
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(async () => ({})),
      },
      characterPublishedScore: {
        findFirst: vi.fn(async () => ({
          publishedSnapshot: {
            isPublic: true,
            calculatedAt: new Date(),
          },
        })),
      },
      ingestionJob: { findFirst: vi.fn(async () => null) },
    };

    const enqueueRefreshCharacter = vi.fn();
    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers: { blizzard: { getMythicKeystoneProfile }, warcraftlogs: {} },
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
        seasonKey: "season-tww-3",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    expect(result.counters.relevantCount).toBe(1);
    expect(result.counters.existingFreshScoreCount).toBe(1);
    expect(enqueueRefreshCharacter).not.toHaveBeenCalled();
    expect(QUEUE_NAMES.discoverOwnedCharacters).toBe("discover-owned-characters");
  });

  it("continues when one character refresh enqueue fails", async () => {
    const getMythicKeystoneProfile = vi.fn(async ({ name }: { name: string }) => ({
      data: { currentMythicRating: name === "Failing" ? 1800 : 1900 },
      provenance: {},
      metadata: {},
      freshness: {},
    }));
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
      region: { code: "EU" },
    }));

    const prisma = {
      battleNetAccount: {
        findUnique: vi.fn(async () => ({ id: "bnet-1", unlinkedAt: null })),
        update: vi.fn(async () => ({})),
      },
      season: { findFirst: vi.fn(async () => ({ id: "season-1", slug: "season-tww-3" })) },
      verifiedCharacterOwnership: {
        findMany: vi.fn(async () => ownerships),
        update: vi.fn(async () => ({})),
      },
      characterPublishedScore: { findFirst: vi.fn(async () => null) },
      ingestionJob: { findFirst: vi.fn(async () => null) },
    };

    const enqueueRefreshCharacter = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue down"))
      .mockResolvedValueOnce({ jobId: "j2", dedupeKey: "d", reused: false, enqueued: true });

    const container = {
      prisma,
      env: {
        ACTIVE_SCORE_MODEL_KEY: "default",
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
        RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      providers: { blizzard: { getMythicKeystoneProfile }, warcraftlogs: {} },
      repositories: {
        score: { getActiveModel: vi.fn(async () => ({ id: "model-1" })) },
        character: {
          upsertCharacter: vi.fn(async (_id, patch) => ({
            id: patch?.displayName === "Failing" ? "c-fail" : "c-ok",
          })),
        },
      },
    } as unknown as WorkerContainer;

    // Fix upsertCharacter signature used by discovery
    (container.repositories.character.upsertCharacter as ReturnType<typeof vi.fn>).mockImplementation(
      async (identity: { name: string }) => ({
        id: identity.name === "Failing" ? "c-fail" : "c-ok",
      }),
    );

    const result = await runDiscoverOwnedCharacters(
      container,
      {
        battleNetAccountId: "bnet-1",
        userId: "user-1",
        ownershipSyncAt: new Date().toISOString(),
        seasonKey: "season-tww-3",
        requestedAt: new Date().toISOString(),
      },
      { enqueueRefreshCharacter },
    );

    expect(result.counters.relevantCount).toBe(2);
    expect(result.counters.failedCount).toBeGreaterThanOrEqual(1);
    expect(result.counters.refreshQueuedCount).toBe(1);
  });
});
