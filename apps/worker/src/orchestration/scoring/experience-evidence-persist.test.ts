/**
 * Agent 03 — immutable Experience evidence persistence / warm / replay call counts.
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
  createInMemoryExperienceEvidenceStore,
} from "./experience-evidence-persist.js";
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
const PREV_NEXT_ID = "season-prev-n-plus-1";
const REGION_ID = "region-eu";

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

function seasonRows(opts?: { includeNext?: boolean }) {
  const rows = [
    {
      id: CURRENT_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-15",
      blizzardSeasonId: 15,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: null,
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
      metadata: {
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc("season-tww-3"),
      },
      providerSeasonId: "season-tww-3",
    },
  ];
  if (opts?.includeNext) {
    rows.unshift({
      id: "season-future-current",
      regionId: REGION_ID,
      slug: "blizzard-season-16",
      blizzardSeasonId: 16,
      startsAt: new Date("2026-08-01T00:00:00.000Z"),
      endsAt: null,
      metadata: {},
      providerSeasonId: "season-mn-2",
    });
    rows.push({
      id: PREV_NEXT_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-15-as-prev",
      blizzardSeasonId: 15,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-08-01T00:00:00.000Z"),
      metadata: {
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc("season-mn-1"),
      },
      providerSeasonId: "season-mn-1",
    });
  }
  return rows;
}

function createPrismaFake(rows: ReturnType<typeof seasonRows>) {
  return {
    season: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return null;
        const { metadata: _m, providerSeasonId: _p, ...rest } = row;
        return rest;
      }),
      findMany: vi.fn(async () => rows),
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

function achievementsDto(
  rows: Array<{ achievementId: number; completedAt: string | null }> = [],
): ProviderResult<BlizzardCharacterAchievementsDTO> {
  return providerResult({ achievements: rows }, "fp-achievements");
}

describe("immutable Experience evidence persistence", () => {
  it("cold Blizzard rating call = 1; warm/replay = 0 and identical Experience", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfile(2900));
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));
    const persistProviderResult = vi.fn(async () => "payload");

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
      boundPreviousRaiderIoSlug: "season-tww-3",
    });

    expect(cold.previousSeasonProfileCalls).toBe(1);
    expect(cold.achievementsCalls).toBe(1);
    expect(cold.previousSeasonRatingFromCache).toBe(false);
    expect(cold.eliteFromCache).toBe(false);
    expect(cold.experience.available).toBe(true);
    expect(cold.diagnostics.ratingSource).toBe("BLIZZARD");

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
      boundPreviousRaiderIoSlug: "season-tww-3",
    });

    expect(warm.previousSeasonProfileCalls).toBe(0);
    expect(warm.achievementsCalls).toBe(0);
    expect(warm.raiderIoHistoricalRatingCalls).toBe(0);
    expect(warm.previousSeasonRatingFromCache).toBe(true);
    expect(warm.eliteFromCache).toBe(true);
    expect(warm.experience).toEqual(cold.experience);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(getCharacterAchievements).toHaveBeenCalledTimes(1);

    // Process restart simulation: new store instance is separate; use same durable store.
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
      boundPreviousRaiderIoSlug: "season-tww-3",
    });

    expect(replay.previousSeasonProfileCalls).toBe(0);
    expect(replay.achievementsCalls).toBe(0);
    expect(replay.raiderIoHistoricalRatingCalls).toBe(0);
    expect(replay.experience).toEqual(cold.experience);
    expect(replay.diagnostics.ratingSource).toBe("PERSISTED");
  });

  it("persists confirmed-no-activity and reuses it without refetch", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfile(null, []));
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));

    const cold = await buildExperiencePhase1Result({
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
    expect(cold.experience.available).toBe(true);
    expect(cold.experience.score).toBe(0);

    const warm = await buildExperiencePhase1Result({
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
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(warm.previousSeasonProfileCalls).toBe(0);
    expect(warm.experience).toEqual(cold.experience);
  });

  it("Blizzard failure + exact RIO fallback persists and warms with 0 provider calls", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getMythicKeystoneSeasonProfile = vi.fn(async () => {
      const err = Object.assign(new Error("not found"), { statusCode: 404, code: "NOT_FOUND" });
      throw err;
    });
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));

    const cold = await buildExperiencePhase1Result({
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
      boundPreviousRaiderIoSlug: "season-tww-3",
      rioExactSeasonFallback: {
        profileFetched: true,
        exactSeasonSlug: "season-tww-3",
        exactSeasonScore: 2900,
        activityProof: "UNKNOWN",
      },
    });

    expect(cold.previousSeasonProfileCalls).toBe(1);
    expect(cold.diagnostics.ratingSource).toBe("RAIDERIO_FALLBACK");
    expect(cold.experience.available).toBe(true);
    expect(cold.experience.score).toBe(75);

    const warm = await buildExperiencePhase1Result({
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
      rioExactSeasonFallback: {
        profileFetched: true,
        exactSeasonSlug: "season-tww-3",
        exactSeasonScore: 2900,
        activityProof: "UNKNOWN",
      },
    });

    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(warm.previousSeasonProfileCalls).toBe(0);
    expect(warm.achievementsCalls).toBe(0);
    expect(warm.experience).toEqual(cold.experience);
    expect(warm.diagnostics.ratingSource).toBe("PERSISTED");
  });

  it("transient provider failure is not persisted and remains retryable", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getMythicKeystoneSeasonProfile = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { statusCode: 503 }))
      .mockResolvedValueOnce(seasonProfile(2900));
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));

    const failed = await buildExperiencePhase1Result({
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
    expect(failed.experience.available).toBe(false);
    expect(
      await store.find({
        characterId: CHAR_ID,
        seasonId: PREV_ID,
        evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
        compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
      }),
    ).toBeNull();

    const retry = await buildExperiencePhase1Result({
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
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(2);
    expect(retry.experience.available).toBe(true);
    expect(retry.diagnostics.ratingSource).toBe("BLIZZARD");
  });

  it("previous season N evidence cannot satisfy N+1; old N remains under its identity", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prismaN = createPrismaFake(seasonRows());
    const getMythicKeystoneSeasonProfile = vi.fn(async (_i, seasonId: number) => {
      if (seasonId === 14) return seasonProfile(2900);
      return seasonProfile(3100);
    });
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));

    const first = await buildExperiencePhase1Result({
      prisma: prismaN as never,
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
    expect(first.previousSeasonProfileCalls).toBe(1);

    // Simulate rollover: current becomes future; previous becomes season 15 row.
    const rolledRows = [
      {
        id: "season-future-current",
        regionId: REGION_ID,
        slug: "blizzard-season-16",
        blizzardSeasonId: 16,
        startsAt: new Date("2026-08-01T00:00:00.000Z"),
        endsAt: null,
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
        metadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc("season-tww-3"),
        },
        providerSeasonId: "season-tww-3",
      },
    ];
    const prismaRolled = createPrismaFake(rolledRows);

    const afterRollover = await buildExperiencePhase1Result({
      prisma: prismaRolled as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: "season-future-current",
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
    });

    // New previous (CURRENT_ID / blizzard 15) is a miss → one rating call.
    expect(afterRollover.previousSeasonProfileCalls).toBe(1);
    expect(afterRollover.previousSeasonRatingFromCache).toBe(false);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(2);

    // Old season N evidence still addressable under PREV_ID.
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
  });

  it("does not apply ambiguous class-rank floor", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(2900)),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
      // Caller incorrectly supplies a rank without exactSeasonProven — still null here.
      previousRegionalClassRank: null,
    });
    expect(result.experience.classRankFloorApplied).toBe(false);
    expect(result.experience.classRankFloor).toBeNull();
  });

  it("no preloaded profile: Blizzard fails → dedicated exact-season RIO fallback", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getMythicKeystoneSeasonProfile = vi.fn(async () => {
      throw Object.assign(new Error("not found"), { statusCode: 404, code: "NOT_FOUND" });
    });
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));
    const getCharacterExactSeasonHistoricalRating = vi.fn(async () =>
      providerResult(
        {
          requestedSeasonSlug: "season-tww-3",
          seasonFound: true,
          scoreAll: 2900,
          activityProof: "PROVEN_NONE" as const,
          totalSeasonRuns: 0,
        },
        "fp-rio-exact",
      ),
    );

    const cold = await buildExperiencePhase1Result({
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
      boundPreviousRaiderIoSlug: "season-tww-3",
      // No rioExactSeasonFallback / no preloaded corroboration.
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });

    expect(getCharacterExactSeasonHistoricalRating).toHaveBeenCalledTimes(1);
    expect(getCharacterExactSeasonHistoricalRating).toHaveBeenCalledWith(
      identity,
      "season-tww-3",
      ctx,
    );
    expect(cold.raiderIoHistoricalRatingCalls).toBe(1);
    expect(cold.diagnostics.ratingSource).toBe("RAIDERIO_FALLBACK");
    expect(cold.experience.available).toBe(true);
  });

  it("Blizzard succeeds → dedicated RIO fallback calls = 0", async () => {
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
        getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(2900)),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
      boundPreviousRaiderIoSlug: "season-tww-3",
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });

    expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(result.raiderIoHistoricalRatingCalls).toBe(0);
    expect(result.diagnostics.ratingSource).toBe("BLIZZARD");
  });

  it("persisted RIO fallback: second recalc RIO calls = 0", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
    const getMythicKeystoneSeasonProfile = vi.fn(async () => {
      throw Object.assign(new Error("not found"), { statusCode: 404, code: "NOT_FOUND" });
    });
    const getCharacterExactSeasonHistoricalRating = vi.fn(async () =>
      providerResult(
        {
          requestedSeasonSlug: "season-tww-3",
          seasonFound: true,
          scoreAll: 2900,
          activityProof: "PROVEN_NONE" as const,
          totalSeasonRuns: 0,
        },
        "fp-rio-exact",
      ),
    );
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));

    await buildExperiencePhase1Result({
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
      boundPreviousRaiderIoSlug: "season-tww-3",
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });

    const warm = await buildExperiencePhase1Result({
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
      boundPreviousRaiderIoSlug: "season-tww-3",
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });

    expect(getCharacterExactSeasonHistoricalRating).toHaveBeenCalledTimes(1);
    expect(warm.raiderIoHistoricalRatingCalls).toBe(0);
    expect(warm.previousSeasonProfileCalls).toBe(0);
  });

  it("RIO zero + proven none → CONFIRMED_NO_ACTIVITY; zero + activity → unavailable; zero + unknown → unavailable", async () => {
    const prisma = createPrismaFake(seasonRows());
    const blizzardFail = {
      getMythicKeystoneSeasonProfile: vi.fn(async () => {
        throw Object.assign(new Error("not found"), { statusCode: 404, code: "NOT_FOUND" });
      }),
      getCharacterAchievements: vi.fn(async () => achievementsDto([])),
    };

    const none = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: "c-none",
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: blizzardFail,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: createInMemoryExperienceEvidenceStore(),
      boundPreviousRaiderIoSlug: "season-tww-3",
      rioExactSeasonFallback: {
        profileFetched: true,
        exactSeasonSlug: "season-tww-3",
        exactSeasonScore: 0,
        activityProof: "PROVEN_NONE",
      },
    });
    expect(none.experience.available).toBe(true);
    expect(none.experience.score).toBe(0);

    const activity = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: "c-act",
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: blizzardFail,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: createInMemoryExperienceEvidenceStore(),
      boundPreviousRaiderIoSlug: "season-tww-3",
      rioExactSeasonFallback: {
        profileFetched: true,
        exactSeasonSlug: "season-tww-3",
        exactSeasonScore: 0,
        activityProof: "PROVEN_ACTIVITY",
      },
    });
    expect(activity.experience.available).toBe(false);

    const unknown = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: "c-unk",
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: blizzardFail,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: createInMemoryExperienceEvidenceStore(),
      boundPreviousRaiderIoSlug: "season-tww-3",
      rioExactSeasonFallback: {
        profileFetched: true,
        exactSeasonSlug: "season-tww-3",
        exactSeasonScore: 0,
        activityProof: "UNKNOWN",
      },
    });
    expect(unknown.experience.available).toBe(false);
    expect(unknown.experience.score).not.toBe(0);
  });

  it("wrong-season RIO response is rejected", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonRows());
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
      boundPreviousRaiderIoSlug: "season-tww-3",
      raiderIoExactSeason: {
        getCharacterExactSeasonHistoricalRating: vi.fn(async () =>
          providerResult(
            {
              requestedSeasonSlug: "season-tww-3",
              seasonFound: false,
              scoreAll: null,
              activityProof: "UNKNOWN",
              totalSeasonRuns: null,
            },
            "fp-wrong",
          ),
        ),
      },
    });
    expect(result.experience.available).toBe(false);
    expect(result.raiderIoHistoricalRatingCalls).toBe(1);
  });
});
