/**
 * Agent 03 — immutable Experience evidence persistence / warm / replay.
 * Acquisition via acquireBlizzardSeasonHistory; scoring via Phase1 store reuse.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  BlizzardCharacterAchievementsDTO,
  CharacterIdentityInput,
  ProviderFetchContext,
  ProviderResult,
  RaiderIoCutoffThreshold,
  RaiderIoSeasonCutoffs,
} from "@mplus/contracts";
import { buildSeasonPopulationPolicy } from "@mplus/scoring";
import {
  EXPERIENCE_EVIDENCE_KIND,
  EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
  buildEliteCutoffHistoryPersistInput,
  buildPreviousSeasonRatingPersistInput,
  createInMemoryExperienceEvidenceStore,
} from "./experience-evidence-persist.js";
import {
  acquireBlizzardSeasonHistory,
  listHistoricalSeasonRatingsFromStore,
} from "./experience-blizzard-season-history.js";
import {
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  hashSeasonPopulationPolicyContent,
  type PersistedExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";
import { buildExperiencePhase1Result } from "./experience-phase1.js";

const identity: CharacterIdentityInput = {
  region: "EU",
  realmSlug: "archimonde",
  name: "Tester",
};

const ctx: ProviderFetchContext = {
  region: "EU",
  requestId: "exp-persist-test",
  correlationId: null,
  forceRefresh: false,
  now: "2026-08-09T00:00:00.000Z",
};

const CHAR_ID = "char-persist-1";
const CURRENT_ID = "season-current";
const PREV_ID = "season-prev-n";
const REGION_ID = "region-eu";
const PREV_RIO = "season-tww-3";

function threshold(
  score: number,
  quantile: RaiderIoCutoffThreshold["quantile"],
  label: RaiderIoCutoffThreshold["label"],
): RaiderIoCutoffThreshold {
  return { score, quantile, label };
}

function policyDoc(seasonSlug: string): PersistedExperiencePopulationPolicyMetadata {
  const cutoffs: RaiderIoSeasonCutoffs = {
    region: "EU",
    seasonSlug,
    updatedAt: "2026-01-01T00:00:00.000Z",
    top0_1Percent: threshold(3400, "p999", "top_0_1_percent"),
    top1Percent: threshold(3000, "p990", "top_1_percent"),
    top10Percent: threshold(2800, "p900", "top_10_percent"),
    top25Percent: threshold(2500, "p750", "top_25_percent"),
    top40Percent: threshold(2200, "p600", "top_40_percent"),
    attribution: {
      provider: "raiderio",
      displayText: "Data from Raider.IO",
      homepageUrl: "https://raider.io",
      profileUrl: null,
      sourceUrl: null,
    },
  };
  const built = buildSeasonPopulationPolicy(cutoffs, { seasonSlug });
  if (!built.ok) throw new Error("expected policy");
  return {
    schemaVersion: "experience-population-policy-store-v2",
    policy: built.policy,
    raiderIoSeasonSlug: seasonSlug,
    policyContentHash: hashSeasonPopulationPolicyContent(built.policy),
    sourceRequestFingerprint: "fp",
    sourcePayloadId: "payload",
    sourceFetchedAt: "2026-01-01T00:00:00.000Z",
    synchronizedAt: "2026-01-01T00:00:01.000Z",
    lastKnownGood: true,
  };
}

function seasonRows() {
  return [
    {
      id: CURRENT_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-15",
      blizzardSeasonId: 15,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: null,
      isCurrent: true,
      metadata: {},
      providerSeasonId: "season-mn-1",
    },
    {
      id: PREV_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-14",
      blizzardSeasonId: 14,
      startsAt: new Date("2025-06-01T00:00:00.000Z"),
      endsAt: new Date("2025-12-01T00:00:00.000Z"),
      isCurrent: false,
      metadata: {
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc(PREV_RIO),
      },
      providerSeasonId: PREV_RIO,
    },
  ];
}

function createPrismaFake(rows: ReturnType<typeof seasonRows>) {
  return {
    season: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return null;
        const { metadata: _m, ...rest } = row;
        return rest;
      }),
      findMany: vi.fn(async ({ where } = {}) => {
        if (where && "id" in where && where.id?.in) {
          return rows.filter((r) => where.id.in.includes(r.id));
        }
        if (where && "blizzardSeasonId" in where && where.blizzardSeasonId?.in) {
          return rows.filter(
            (r) =>
              (!where.regionId || r.regionId === where.regionId) &&
              where.blizzardSeasonId.in.includes(r.blizzardSeasonId),
          );
        }
        return rows;
      }),
    },
  };
}

function providerResult<T>(data: T, fingerprint: string): ProviderResult<T> {
  return {
    data,
    provenance: {
      provider: "blizzard",
      externalRequestId: "ext",
      sourcePayloadId: null,
      sourceUrl: "https://eu.api.blizzard.com/example",
      fetchedAt: "2026-08-09T00:00:01.000Z",
      schemaVersion: "blizzard-test",
    },
    freshness: {
      fetchedAt: "2026-08-09T00:00:01.000Z",
      expiresAt: null,
      stale: false,
    },
    metadata: {
      provider: "blizzard",
      endpointKey: "test",
      requestFingerprint: fingerprint,
      requestedAt: "2026-08-09T00:00:00.000Z",
      completedAt: "2026-08-09T00:00:01.000Z",
      statusCode: 200,
      cacheHit: false,
      retryCount: 0,
      costUnits: 1,
      etag: null,
      expiresAt: null,
    },
  };
}

function seasonProfile(rating: number | null, runs: unknown[] = []) {
  return providerResult(
    {
      profile: {
        currentMythicRating: rating,
        currentSeasonId: 14,
        seasons: [{ seasonId: 14 }],
        character: identity,
      },
      runs: runs as never[],
    },
    "fp-season",
  );
}

function profileIndex(seasonIds: number[], currentSeasonId = 15) {
  return providerResult(
    {
      currentMythicRating: 4000,
      currentSeasonId,
      seasons: seasonIds.map((seasonId) => ({ seasonId })),
      character: identity,
    },
    "fp-index",
  );
}

function achievementsDto(
  rows: Array<{ achievementId: number; completedAt: string | null }> = [],
): ProviderResult<BlizzardCharacterAchievementsDTO> {
  return providerResult({ achievements: rows }, "fp-achievements");
}

async function seedEliteAbsent(
  store: ReturnType<typeof createInMemoryExperienceEvidenceStore>,
  characterId: string,
  currentSeasonId: string,
) {
  await store.upsertImmutable(
    buildEliteCutoffHistoryPersistInput({
      characterId,
      currentSeasonId,
      confirmedCount: 0,
      confirmed: [],
      fetchedAt: ctx.now,
    }),
  );
}

describe("immutable Experience evidence persistence", () => {
  it("cold acquire Season Details = 1; warm acquire = 0; Phase1 scores identically", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getMythicKeystoneProfile = vi.fn(async () => profileIndex([14, 15]));
    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfile(2900));
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));
    const persistProviderResult = vi.fn(async () => "payload");

    const coldAcquire = await acquireBlizzardSeasonHistory({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult,
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date(ctx.now),
    });
    expect(coldAcquire.profileIndexCalls).toBe(1);
    expect(coldAcquire.seasonDetailsCalls).toBe(1);
    expect(coldAcquire.persistedCount).toBe(1);

    const cold = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult,
      allowProviderCalls: true,
      evidenceStore: store,
    });

    expect(cold.previousSeasonProfileCalls).toBe(0);
    expect(cold.achievementsCalls).toBe(1);
    expect(cold.previousSeasonRatingFromCache).toBe(true);
    expect(cold.eliteFromCache).toBe(false);
    expect(cold.experience.available).toBe(true);
    expect(cold.experience.score).toBe(75);
    expect(cold.diagnostics.ratingSource).toBe("PERSISTED");

    const warmAcquire = await acquireBlizzardSeasonHistory({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult,
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date(ctx.now),
    });
    expect(warmAcquire.seasonDetailsCalls).toBe(0);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);

    const warm = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult,
      allowProviderCalls: true,
      evidenceStore: store,
    });

    expect(warm.previousSeasonProfileCalls).toBe(0);
    expect(warm.achievementsCalls).toBe(0);
    expect(warm.raiderIoHistoricalRatingCalls).toBe(0);
    expect(warm.previousSeasonRatingFromCache).toBe(true);
    expect(warm.eliteFromCache).toBe(true);
    expect(warm.experience).toEqual(cold.experience);
    expect(getCharacterAchievements).toHaveBeenCalledTimes(1);

    const replay = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult,
      allowProviderCalls: false,
      evidenceStore: store,
    });

    expect(replay.previousSeasonProfileCalls).toBe(0);
    expect(replay.achievementsCalls).toBe(0);
    expect(replay.raiderIoHistoricalRatingCalls).toBe(0);
    expect(replay.experience).toEqual(cold.experience);
    expect(replay.diagnostics.ratingSource).toBe("PERSISTED");
  });

  it("persists confirmed-no-activity and reuses it without refetch; Phase1 does not yield E0", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getMythicKeystoneProfile = vi.fn(async () => profileIndex([14, 15]));
    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfile(null, []));
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));

    await acquireBlizzardSeasonHistory({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date(ctx.now),
    });
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);

    const listed = await listHistoricalSeasonRatingsFromStore(store, CHAR_ID, {
      prisma: prisma as never,
    });
    expect(listed).toEqual([
      expect.objectContaining({
        seasonId: PREV_ID,
        state: "CONFIRMED_NO_ACTIVITY",
        rating: null,
        source: "BLIZZARD",
      }),
    ]);

    await seedEliteAbsent(store, CHAR_ID, CURRENT_ID);

    const cold = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: false,
      evidenceStore: store,
    });
    // Season-level absence alone ≠ whole-history E=0.
    expect(cold.experience.available).toBe(false);
    expect(cold.experience.score).toBeNull();

    const warmAcquire = await acquireBlizzardSeasonHistory({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date(ctx.now),
    });
    expect(warmAcquire.seasonDetailsCalls).toBe(0);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);

    const warm = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: false,
      evidenceStore: store,
    });
    expect(warm.experience).toEqual(cold.experience);
  });

  it("RAIDERIO_FALLBACK rows are not accepted as 03C Blizzard historical standing", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    await store.upsertImmutable(
      buildPreviousSeasonRatingPersistInput({
        characterId: CHAR_ID,
        evidence: {
          state: "HAS_VALUE",
          rating: 2900,
          ratingSource: "RAIDERIO_FALLBACK",
          internalSeasonId: PREV_ID,
          seasonSlug: "blizzard-season-14",
          blizzardSeasonId: 14,
          fetchedAt: ctx.now,
          providerPayloadId: "p",
        },
        raiderIoSeasonSlug: PREV_RIO,
      })!,
    );
    await seedEliteAbsent(store, CHAR_ID, CURRENT_ID);

    const listed = await listHistoricalSeasonRatingsFromStore(store, CHAR_ID, {
      prisma: prisma as never,
    });
    expect(listed).toEqual([]);

    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("Phase1 must not acquire");
        }),
        getCharacterAchievements: vi.fn(async () => {
          throw new Error("elite seeded");
        }),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: false,
      evidenceStore: store,
      rioExactSeasonFallback: {
        profileFetched: true,
        exactSeasonSlug: PREV_RIO,
        exactSeasonScore: 2900,
        activityProof: "UNKNOWN",
      },
    });
    expect(result.raiderIoHistoricalRatingCalls).toBe(0);
    expect(result.diagnostics.ratingSource).not.toBe("RAIDERIO_FALLBACK");
    expect(result.experience.available).toBe(false);
    expect(result.experience.score).toBeNull();
  });

  it("transient Season Details failure is not persisted and remains retryable", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getMythicKeystoneProfile = vi.fn(async () => profileIndex([14, 15]));
    const getMythicKeystoneSeasonProfile = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { statusCode: 503 }))
      .mockResolvedValueOnce(seasonProfile(2900));
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));

    const failed = await acquireBlizzardSeasonHistory({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date(ctx.now),
    });
    expect(failed.failedSeasonIds).toContain(14);
    expect(
      await store.find({
        characterId: CHAR_ID,
        seasonId: PREV_ID,
        evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
        compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
      }),
    ).toBeNull();

    const retry = await acquireBlizzardSeasonHistory({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date(ctx.now),
    });
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(2);
    expect(retry.persistedCount).toBe(1);

    const scored = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
    });
    expect(scored.experience.available).toBe(true);
    expect(scored.diagnostics.ratingSource).toBe("PERSISTED");
  });

  it("previous season N evidence cannot satisfy N+1; old N remains under its identity", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prismaN = createPrismaFake(seasonRows());
    const getMythicKeystoneProfile = vi.fn(async () => profileIndex([14, 15]));
    const getMythicKeystoneSeasonProfile = vi.fn(async (_i, seasonId: number) => {
      if (seasonId === 14) return seasonProfile(2900);
      return providerResult(
        {
          profile: {
            currentMythicRating: 3100,
            currentSeasonId: seasonId,
            seasons: [{ seasonId }],
            character: identity,
          },
          runs: [] as never[],
        },
        `fp-season-${seasonId}`,
      );
    });
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));

    await acquireBlizzardSeasonHistory({
      prisma: prismaN as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date(ctx.now),
    });
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);

    // Simulate rollover: current becomes season 16; previous becomes season 15.
    const rolledRows = [
      {
        id: "season-future-current",
        regionId: REGION_ID,
        slug: "blizzard-season-16",
        blizzardSeasonId: 16,
        startsAt: new Date("2026-08-01T00:00:00.000Z"),
        endsAt: null,
        isCurrent: true,
        metadata: {},
        providerSeasonId: "season-mn-2",
      },
      {
        id: CURRENT_ID,
        regionId: REGION_ID,
        slug: "blizzard-season-15",
        blizzardSeasonId: 15,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-08-01T00:00:00.000Z"),
        isCurrent: false,
        metadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc("season-mn-1"),
        },
        providerSeasonId: "season-mn-1",
      },
      {
        id: PREV_ID,
        regionId: REGION_ID,
        slug: "blizzard-season-14",
        blizzardSeasonId: 14,
        startsAt: new Date("2025-06-01T00:00:00.000Z"),
        endsAt: new Date("2025-12-01T00:00:00.000Z"),
        isCurrent: false,
        metadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc(PREV_RIO),
        },
        providerSeasonId: PREV_RIO,
      },
    ];
    const prismaRolled = createPrismaFake(rolledRows);
    getMythicKeystoneProfile.mockImplementation(async () =>
      profileIndex([14, 15, 16], 16),
    );

    const afterRollover = await acquireBlizzardSeasonHistory({
      prisma: prismaRolled as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: "season-future-current",
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date("2026-08-09T00:00:00.000Z"),
    });

    // New previous (CURRENT_ID / blizzard 15) is a miss → one Season Details call.
    expect(afterRollover.seasonDetailsCalls).toBe(1);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(2);

    const old = await store.find({
      characterId: CHAR_ID,
      seasonId: PREV_ID,
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
      compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
    });
    expect(old).not.toBeNull();
    expect(old?.blizzardSeasonId).toBe(14);

    const neu = await store.find({
      characterId: CHAR_ID,
      seasonId: CURRENT_ID,
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
      compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
    });
    expect(neu).not.toBeNull();
    expect(neu?.blizzardSeasonId).toBe(15);

    void getCharacterAchievements;
  });

  it("does not apply ambiguous class-rank floor", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    await store.upsertImmutable(
      buildPreviousSeasonRatingPersistInput({
        characterId: CHAR_ID,
        evidence: {
          state: "HAS_VALUE",
          rating: 2900,
          ratingSource: "BLIZZARD",
          internalSeasonId: PREV_ID,
          seasonSlug: "blizzard-season-14",
          blizzardSeasonId: 14,
          fetchedAt: ctx.now,
          providerPayloadId: "p",
        },
        raiderIoSeasonSlug: PREV_RIO,
      })!,
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("Phase1 must not acquire");
        }),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
      previousRegionalClassRank: null,
    });
    expect(result.experience.classRankFloorApplied).toBe(false);
    expect(result.experience.classRankFloor).toBeNull();
  });

  it("Phase1 never calls dedicated RIO historical endpoint", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getCharacterExactSeasonHistoricalRating = vi.fn(async () => {
      throw new Error("should not be called");
    });

    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("Phase1 must not acquire");
        }),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
      boundPreviousRaiderIoSlug: PREV_RIO,
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
      rioExactSeasonFallback: {
        profileFetched: true,
        exactSeasonSlug: PREV_RIO,
        exactSeasonScore: 2900,
        activityProof: "UNKNOWN",
      },
    });

    expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(result.raiderIoHistoricalRatingCalls).toBe(0);
    expect(result.previousSeasonProfileCalls).toBe(0);
    expect(result.diagnostics.ratingSource).not.toBe("RAIDERIO_FALLBACK");
    expect(result.experience.available).toBe(false);
  });

  it("Blizzard acquire succeeds → Phase1 scores without RIO historical", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getCharacterExactSeasonHistoricalRating = vi.fn(async () => {
      throw new Error("should not be called");
    });
    const getMythicKeystoneProfile = vi.fn(async () => profileIndex([14, 15]));
    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfile(2900));

    await acquireBlizzardSeasonHistory({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date(ctx.now),
    });

    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile,
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
      boundPreviousRaiderIoSlug: PREV_RIO,
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });

    expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(result.raiderIoHistoricalRatingCalls).toBe(0);
    expect(result.diagnostics.ratingSource).toBe("PERSISTED");
    expect(result.experience.available).toBe(true);
    expect(result.experience.score).toBe(75);
  });

  it("persisted Blizzard evidence: second Phase1 RIO calls = 0", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    await store.upsertImmutable(
      buildPreviousSeasonRatingPersistInput({
        characterId: CHAR_ID,
        evidence: {
          state: "HAS_VALUE",
          rating: 2900,
          ratingSource: "BLIZZARD",
          internalSeasonId: PREV_ID,
          seasonSlug: "blizzard-season-14",
          blizzardSeasonId: 14,
          fetchedAt: ctx.now,
          providerPayloadId: "p",
        },
        raiderIoSeasonSlug: PREV_RIO,
      })!,
    );
    await seedEliteAbsent(store, CHAR_ID, CURRENT_ID);
    const getCharacterExactSeasonHistoricalRating = vi.fn(async () => {
      throw new Error("should not be called");
    });

    const warm = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("Phase1 must not acquire");
        }),
        getCharacterAchievements: vi.fn(async () => {
          throw new Error("elite seeded");
        }),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: false,
      evidenceStore: store,
      boundPreviousRaiderIoSlug: PREV_RIO,
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });

    expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(warm.raiderIoHistoricalRatingCalls).toBe(0);
    expect(warm.previousSeasonProfileCalls).toBe(0);
    expect(warm.achievementsCalls).toBe(0);
    expect(warm.experience.available).toBe(true);
    expect(warm.experience.score).toBe(75);
  });

  it("legacy rioExactSeasonFallback is ignored by Phase1 (including zero-score cases)", async () => {
    const prisma = createPrismaFake(seasonRows());
    const blizzardFail = {
      getMythicKeystoneSeasonProfile: vi.fn(async () => {
        throw Object.assign(new Error("not found"), { statusCode: 404, code: "NOT_FOUND" });
      }),
      getCharacterAchievements: vi.fn(async () => achievementsDto([])),
    };

    for (const activityProof of ["PROVEN_NONE", "PROVEN_ACTIVITY", "UNKNOWN"] as const) {
      const result = await buildExperiencePhase1Result({
        prisma: prisma as never,
        characterId: `c-${activityProof}`,
        identity,
        currentSeasonId: CURRENT_ID,
        regionCode: "EU",
        blizzard: blizzardFail,
        ctx,
        persistProviderResult: vi.fn(async () => "p"),
        allowProviderCalls: true,
        evidenceStore: createInMemoryExperienceEvidenceStore(),
        boundPreviousRaiderIoSlug: PREV_RIO,
        rioExactSeasonFallback: {
          profileFetched: true,
          exactSeasonSlug: PREV_RIO,
          exactSeasonScore: 0,
          activityProof,
        },
      });
      expect(result.raiderIoHistoricalRatingCalls).toBe(0);
      expect(result.previousSeasonProfileCalls).toBe(0);
      expect(result.experience.available).toBe(false);
      expect(result.experience.score).toBeNull();
      expect(result.experience.score).not.toBe(0);
    }
  });

  it("Phase1 ignores RIO exact-season port even when seasonFound is false", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getCharacterExactSeasonHistoricalRating = vi.fn(async () =>
      providerResult(
        {
          requestedSeasonSlug: PREV_RIO,
          seasonFound: false,
          scoreAll: null,
          activityProof: "UNKNOWN",
          totalSeasonRuns: null,
        },
        "fp-wrong",
      ),
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw Object.assign(new Error("not found"), { statusCode: 404, code: "NOT_FOUND" });
        }),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
      boundPreviousRaiderIoSlug: PREV_RIO,
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });
    expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(result.raiderIoHistoricalRatingCalls).toBe(0);
    expect(result.experience.available).toBe(false);
  });
});
