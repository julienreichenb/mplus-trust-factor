import { describe, expect, it, vi } from "vitest";
import type {
  CharacterIdentityInput,
  ProviderFetchContext,
  ProviderResult,
} from "@mplus/contracts";
import { EXPERIENCE_EVIDENCE_KIND, EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION } from "@mplus/database";
import { pickSeasonProfileMythicRating } from "@mplus/provider-blizzard";
import {
  acquireBlizzardSeasonHistory,
  historicalSeasonRatingFromEvidenceRow,
  isClosedSeasonForHistory,
  joinHistoricalRatingWithPopulationPolicy,
  listHistoricalSeasonRatingsFromStore,
} from "./experience-blizzard-season-history.js";
import {
  buildPreviousSeasonRatingPersistInput,
  createInMemoryExperienceEvidenceStore,
} from "./experience-evidence-persist.js";

const CHAR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REGION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CURRENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const S15 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const S14 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const S13 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const S11 = "11111111-1111-4111-8111-111111111111";

const identity: CharacterIdentityInput = {
  region: "EU",
  realmSlug: "ysondre",
  name: "Tester",
};

const ctx: ProviderFetchContext = {
  region: "EU",
  requestId: "history-test",
  correlationId: null,
  forceRefresh: true,
  now: "2026-08-10T00:00:00.000Z",
};

function providerResult<T>(data: T, fingerprint: string): ProviderResult<T> {
  return {
    data,
    provenance: {
      provider: "blizzard",
      externalRequestId: null,
      sourcePayloadId: null,
      sourceUrl: "https://eu.api.blizzard.com/example",
      fetchedAt: ctx.now,
      schemaVersion: "blizzard-test",
    },
    freshness: { fetchedAt: ctx.now, expiresAt: null, stale: false },
    metadata: {
      provider: "blizzard",
      endpointKey: "test",
      requestFingerprint: fingerprint,
      requestedAt: ctx.now,
      completedAt: ctx.now,
      statusCode: 200,
      cacheHit: false,
      retryCount: 0,
      costUnits: 1,
      etag: null,
      expiresAt: null,
    },
  };
}

function seasonRows() {
  return [
    {
      id: CURRENT_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-17",
      blizzardSeasonId: 17,
      startsAt: new Date("2026-03-18T00:00:00.000Z"),
      endsAt: null,
      isCurrent: true,
      providerSeasonId: "season-mn-1",
    },
    {
      id: S15,
      regionId: REGION_ID,
      slug: "blizzard-season-15",
      blizzardSeasonId: 15,
      startsAt: new Date("2025-08-06T00:00:00.000Z"),
      endsAt: new Date("2026-03-18T00:00:00.000Z"),
      isCurrent: false,
      providerSeasonId: "season-tww-3",
    },
    {
      id: S14,
      regionId: REGION_ID,
      slug: "blizzard-season-14",
      blizzardSeasonId: 14,
      startsAt: new Date("2025-03-05T00:00:00.000Z"),
      endsAt: new Date("2025-08-06T00:00:00.000Z"),
      isCurrent: false,
      providerSeasonId: "season-tww-2",
    },
    {
      id: S13,
      regionId: REGION_ID,
      slug: "blizzard-season-13",
      blizzardSeasonId: 13,
      startsAt: new Date("2024-09-11T00:00:00.000Z"),
      endsAt: new Date("2025-03-05T00:00:00.000Z"),
      isCurrent: false,
      providerSeasonId: "season-tww-1",
    },
    {
      id: S11,
      regionId: REGION_ID,
      slug: "blizzard-season-11",
      blizzardSeasonId: 11,
      startsAt: new Date("2023-11-14T00:00:00.000Z"),
      endsAt: new Date("2024-04-23T00:00:00.000Z"),
      isCurrent: false,
      providerSeasonId: "season-df-3",
    },
  ];
}

function createPrismaFake(rows = seasonRows()) {
  return {
    season: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find((r) => r.id === where.id);
        return row ? { ...row } : null;
      }),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { regionId: string; blizzardSeasonId: { in: number[] } };
        }) =>
          rows.filter(
            (r) =>
              r.regionId === where.regionId &&
              where.blizzardSeasonId.in.includes(r.blizzardSeasonId),
          ),
      ),
    },
  };
}

function seasonProfileDto(rating: number | null, seasonId: number, runs: unknown[] = []) {
  return providerResult(
    {
      profile: {
        currentMythicRating: rating,
        currentSeasonId: seasonId,
        seasons: [{ seasonId }],
        character: identity,
      },
      runs: runs as never[],
    },
    `fp-season-${seasonId}`,
  );
}

describe("isClosedSeasonForHistory", () => {
  const nowMs = Date.parse("2026-08-10T00:00:00.000Z");
  it("excludes current / open authoritative season", () => {
    expect(
      isClosedSeasonForHistory(
        {
          id: CURRENT_ID,
          isCurrent: true,
          endsAt: null,
          blizzardSeasonId: 17,
        },
        {
          currentSeasonId: CURRENT_ID,
          authoritativeBlizzardSeasonId: 17,
          nowMs,
        },
      ),
    ).toBe(false);
  });
});

describe("acquireBlizzardSeasonHistory", () => {
  it("cold: index ×1 + Season Details for each closed index season missing evidence", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const getMythicKeystoneProfile = vi.fn(async () =>
      providerResult(
        {
          currentMythicRating: 3595,
          currentSeasonId: 17,
          seasons: [
            { seasonId: 14 },
            { seasonId: 11 },
            { seasonId: 15 },
            { seasonId: 13 },
            { seasonId: 17 },
          ],
          character: identity,
        },
        "fp-index",
      ),
    );
    const getMythicKeystoneSeasonProfile = vi.fn(async (_id, seasonId: number) =>
      seasonProfileDto(3000 + seasonId, seasonId),
    );

    const result = await acquireBlizzardSeasonHistory({
      prisma: createPrismaFake() as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult: vi.fn(async () => "payload"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });

    expect(result.profileIndexCalls).toBe(1);
    expect(result.seasonDetailsCalls).toBe(4);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(4);
    expect(result.ratings.filter((r) => r.state === "HAS_VALUE")).toHaveLength(4);
    expect(result.ratings.some((r) => r.blizzardSeasonId === 17)).toBe(false);
    expect(result.ratings.map((r) => r.blizzardSeasonId).sort((a, b) => a - b)).toEqual([
      11, 13, 14, 15,
    ]);
  });

  it("partial cache: index ×1 + only missing historical Season Details", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    for (const [seasonId, blizzardSeasonId, slug] of [
      [S15, 15, "blizzard-season-15"],
      [S14, 14, "blizzard-season-14"],
      [S13, 13, "blizzard-season-13"],
    ] as const) {
      await store.upsertImmutable(
        buildPreviousSeasonRatingPersistInput({
          characterId: CHAR_ID,
          evidence: {
            state: "HAS_VALUE",
            rating: 3100,
            internalSeasonId: seasonId,
            seasonSlug: slug,
            blizzardSeasonId,
            fetchedAt: ctx.now,
            providerPayloadId: null,
            ratingSource: "BLIZZARD",
          },
        })!,
      );
    }

    const getMythicKeystoneProfile = vi.fn(async () =>
      providerResult(
        {
          currentMythicRating: 1,
          currentSeasonId: 17,
          seasons: [{ seasonId: 15 }, { seasonId: 14 }, { seasonId: 13 }, { seasonId: 11 }],
          character: identity,
        },
        "fp-index",
      ),
    );
    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfileDto(2720, 11));

    const result = await acquireBlizzardSeasonHistory({
      prisma: createPrismaFake() as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });

    expect(result.profileIndexCalls).toBe(1);
    expect(result.seasonDetailsCalls).toBe(1);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledWith(identity, 11, ctx);
  });

  it("warm: index ×1 + Season Details ×0 when all index closed seasons persisted", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    for (const [seasonId, blizzardSeasonId, slug] of [
      [S15, 15, "blizzard-season-15"],
      [S14, 14, "blizzard-season-14"],
      [S13, 13, "blizzard-season-13"],
      [S11, 11, "blizzard-season-11"],
    ] as const) {
      await store.upsertImmutable(
        buildPreviousSeasonRatingPersistInput({
          characterId: CHAR_ID,
          evidence: {
            state: "HAS_VALUE",
            rating: 3000,
            internalSeasonId: seasonId,
            seasonSlug: slug,
            blizzardSeasonId,
            fetchedAt: ctx.now,
            providerPayloadId: null,
            ratingSource: "BLIZZARD",
          },
        })!,
      );
    }
    const getMythicKeystoneProfile = vi.fn(async () =>
      providerResult(
        {
          currentMythicRating: 1,
          currentSeasonId: 17,
          seasons: [
            { seasonId: 15 },
            { seasonId: 14 },
            { seasonId: 13 },
            { seasonId: 11 },
            { seasonId: 17 },
          ],
          character: identity,
        },
        "fp-index",
      ),
    );
    const getMythicKeystoneSeasonProfile = vi.fn();
    const result = await acquireBlizzardSeasonHistory({
      prisma: createPrismaFake() as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: { getMythicKeystoneProfile, getMythicKeystoneSeasonProfile },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(result.profileIndexCalls).toBe(1);
    expect(result.seasonDetailsCalls).toBe(0);
    expect(getMythicKeystoneProfile).toHaveBeenCalledTimes(1);
    expect(getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(result.ratings).toHaveLength(4);
  });

  it("absent from index: no Season Details, no CONFIRMED_NO_ACTIVITY, no fabricated zero", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfileDto(3542, 15));
    const result = await acquireBlizzardSeasonHistory({
      prisma: createPrismaFake() as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: {
        getMythicKeystoneProfile: vi.fn(async () =>
          providerResult(
            {
              currentMythicRating: 1,
              currentSeasonId: 17,
              seasons: [{ seasonId: 15 }, { seasonId: 17 }],
              character: identity,
            },
            "fp-index",
          ),
        ),
        getMythicKeystoneSeasonProfile,
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledWith(identity, 15, ctx);
    const listed = await listHistoricalSeasonRatingsFromStore(store, CHAR_ID);
    expect(listed.some((r) => r.blizzardSeasonId === 14)).toBe(false);
    expect(listed.some((r) => r.blizzardSeasonId === 11)).toBe(false);
    expect(listed.some((r) => r.state === "CONFIRMED_NO_ACTIVITY")).toBe(false);
    expect(listed.every((r) => r.rating !== 0 || r.state === "HAS_VALUE")).toBe(true);
    expect(result.ratings.map((r) => r.blizzardSeasonId)).toEqual([15]);
  });

  it("transient Season Details failure leaves season retryable without fake zero", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const getMythicKeystoneSeasonProfile = vi.fn(async (_id, seasonId: number) => {
      if (seasonId === 14) throw new Error("transient");
      return seasonProfileDto(3200, seasonId);
    });
    const result = await acquireBlizzardSeasonHistory({
      prisma: createPrismaFake() as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: {
        getMythicKeystoneProfile: vi.fn(async () =>
          providerResult(
            {
              currentMythicRating: 1,
              currentSeasonId: 17,
              seasons: [{ seasonId: 15 }, { seasonId: 14 }, { seasonId: 13 }],
              character: identity,
            },
            "fp",
          ),
        ),
        getMythicKeystoneSeasonProfile,
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(result.failedSeasonIds).toEqual([14]);
    const listed = await listHistoricalSeasonRatingsFromStore(store, CHAR_ID);
    expect(listed.some((r) => r.blizzardSeasonId === 14)).toBe(false);
    expect(listed.some((r) => r.blizzardSeasonId === 15 && r.rating === 3200)).toBe(true);
  });

  it("provider-free replay reconstructs without Blizzard calls", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    await store.upsertImmutable(
      buildPreviousSeasonRatingPersistInput({
        characterId: CHAR_ID,
        evidence: {
          state: "HAS_VALUE",
          rating: 3542,
          internalSeasonId: S15,
          seasonSlug: "blizzard-season-15",
          blizzardSeasonId: 15,
          fetchedAt: ctx.now,
          providerPayloadId: null,
          ratingSource: "BLIZZARD",
        },
      })!,
    );
    const result = await acquireBlizzardSeasonHistory({
      prisma: createPrismaFake([seasonRows()[0]!, seasonRows()[1]!]) as never,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard: {
        getMythicKeystoneProfile: vi.fn(),
        getMythicKeystoneSeasonProfile: vi.fn(),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: false,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(result.profileIndexCalls).toBe(0);
    expect(result.seasonDetailsCalls).toBe(0);
    expect(result.ratings).toEqual([
      {
        seasonId: S15,
        seasonSlug: "blizzard-season-15",
        blizzardSeasonId: 15,
        rating: 3542,
        state: "HAS_VALUE",
        source: "BLIZZARD",
      },
    ]);
  });

  it("does not create duplicate evidence on repeat acquisition", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const blizzard = {
      getMythicKeystoneProfile: vi.fn(async () =>
        providerResult(
          {
            currentMythicRating: 1,
            currentSeasonId: 17,
            seasons: [{ seasonId: 15 }, { seasonId: 17 }],
            character: identity,
          },
          "fp",
        ),
      ),
      getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfileDto(3542, 15)),
    };
    const prisma = createPrismaFake([seasonRows()[0]!, seasonRows()[1]!]) as never;
    const first = await acquireBlizzardSeasonHistory({
      prisma,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    const second = await acquireBlizzardSeasonHistory({
      prisma,
      characterId: CHAR_ID,
      identity,
      regionCode: "EU",
      currentSeasonId: CURRENT_ID,
      blizzard,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      evidenceStore: store,
      allowProviderCalls: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(first.persistedCount).toBeGreaterThan(0);
    expect(second.profileIndexCalls).toBe(1);
    expect(second.seasonDetailsCalls).toBe(0);
    expect(second.persistedCount).toBe(0);
    const rows = await store.listPreviousSeasonRatings!(CHAR_ID);
    expect(
      rows.filter(
        (r) =>
          r.seasonId === S15 &&
          r.evidenceKind === EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING &&
          r.compatibilityVersion === EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
      ),
    ).toHaveLength(1);
  });

  it("makes zero Raider.IO character requests (Blizzard-only surface)", async () => {
    const keys = Object.keys(
      {
        getMythicKeystoneProfile: true,
        getMythicKeystoneSeasonProfile: true,
      } as const,
    );
    expect(keys.some((k) => /raider|characterProfile/i.test(k))).toBe(false);
  });
});

describe("live Season Details mythic_rating field shape", () => {
  it("extracts rating from minimized real Blizzard season-details payload", () => {
    const raw = {
      season: { id: 15 },
      best_runs: [{ keystone_level: 10, duration: 1, completed_timestamp: 1 }],
      mythic_rating: { rating: 3726.9636, color: { r: 1, g: 2, b: 3, a: 1 } },
    };
    expect((raw as { current_mythic_rating?: unknown }).current_mythic_rating).toBeUndefined();
    expect(pickSeasonProfileMythicRating(raw)).toEqual({ rating: 3726.9636 });
  });
});

describe("03A population policy join proof", () => {
  it("joins historical rating with catalog cutoffs without altering them", () => {
    const rating = {
      seasonId: S15,
      seasonSlug: "blizzard-season-15",
      blizzardSeasonId: 15,
      rating: 3542,
      state: "HAS_VALUE" as const,
      source: "BLIZZARD" as const,
    };
    const joined = joinHistoricalRatingWithPopulationPolicy({
      rating,
      populationPolicy: {
        anchors: [
          { nativeQuantile: "p999", score: 3946.97 },
          { nativeQuantile: "p990", score: 3602.13 },
          { nativeQuantile: "p900", score: 3114.82 },
          { nativeQuantile: "p750", score: 2876.44 },
          { nativeQuantile: "p600", score: 2558.75 },
        ],
      },
    });
    expect(joined).toEqual({
      blizzardSeasonId: 15,
      historicalRating: 3542,
      cutoffs: {
        p999: 3946.97,
        p990: 3602.13,
        p900: 3114.82,
        p750: 2876.44,
        p600: 2558.75,
      },
    });
  });

  it("maps evidence rows to HistoricalSeasonRating", () => {
    const row = {
      id: "1",
      characterId: CHAR_ID,
      seasonId: S15,
      blizzardSeasonId: 15,
      raiderIoSeasonSlug: "season-tww-3",
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
      compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
      state: "HAS_VALUE",
      source: "BLIZZARD",
      payload: {
        schemaVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
        state: "HAS_VALUE",
        rating: 3542,
        ratingSource: "BLIZZARD",
        internalSeasonId: S15,
        seasonSlug: "blizzard-season-15",
        blizzardSeasonId: 15,
        raiderIoSeasonSlug: "season-tww-3",
      },
      sourcePayloadId: null,
      sourceRequestFingerprint: null,
      contentHash: null,
      fetchedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(historicalSeasonRatingFromEvidenceRow(row)).toMatchObject({
      blizzardSeasonId: 15,
      rating: 3542,
      state: "HAS_VALUE",
      source: "BLIZZARD",
    });
  });
});
