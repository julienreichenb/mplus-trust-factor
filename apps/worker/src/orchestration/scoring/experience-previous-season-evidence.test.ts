import { describe, expect, it, vi } from "vitest";
import type {
  BlizzardMythicKeystoneProfileDTO,
  CharacterIdentityInput,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderResult,
} from "@mplus/contracts";
import {
  acquirePreviousSeasonRatingEvidence,
  corroboratePreviousSeasonBlizzardNotFound,
  isAmbiguousBlizzardSeasonProfileNotFound,
  mapSeasonProfileToPreviousSeasonRatingEvidence,
  resolvePreviousMythicSeason,
  type ExperienceSeasonBindingCandidate,
  type PreviousSeasonBlizzardPort,
} from "./experience-previous-season-evidence.js";

const regionA = "region-a";
const regionB = "region-b";

function season(partial: Partial<ExperienceSeasonBindingCandidate> & Pick<
  ExperienceSeasonBindingCandidate,
  "id" | "slug"
>): ExperienceSeasonBindingCandidate {
  return {
    regionId: regionA,
    blizzardSeasonId: 10,
    startsAt: new Date("2025-01-01T00:00:00.000Z"),
    endsAt: new Date("2025-06-01T00:00:00.000Z"),
    ...partial,
  };
}

const identity: CharacterIdentityInput = {
  region: "EU",
  realmSlug: "tarren-mill",
  name: "Example",
};

const ctx: ProviderFetchContext = {
  region: "EU",
  requestId: "test-req",
  correlationId: null,
  forceRefresh: false,
  now: "2026-08-08T00:00:00.000Z",
};

function providerResult(input: {
  rating: number | null;
  runs?: MythicRunDTO[];
}): ProviderResult<{ profile: BlizzardMythicKeystoneProfileDTO; runs: MythicRunDTO[] }> {
  return {
    data: {
      profile: {
        currentMythicRating: input.rating,
        currentSeasonId: 12,
        seasons: [{ seasonId: 12 }],
        character: identity,
      },
      runs: input.runs ?? [],
    },
    provenance: {
      provider: "blizzard",
      externalRequestId: "ext",
      sourcePayloadId: null,
      sourceUrl: "https://eu.api.blizzard.com/example",
      fetchedAt: "2026-08-08T00:00:01.000Z",
      schemaVersion: "blizzard-wow-profile-2026-07",
    },
    freshness: {
      fetchedAt: "2026-08-08T00:00:01.000Z",
      expiresAt: null,
      stale: false,
    },
    metadata: {
      provider: "blizzard",
      endpointKey: "character.mplus.season",
      requestFingerprint: "fp-test",
      requestedAt: "2026-08-08T00:00:00.000Z",
      completedAt: "2026-08-08T00:00:01.000Z",
      statusCode: 200,
      cacheHit: false,
      retryCount: 0,
      costUnits: 1,
      etag: null,
      expiresAt: null,
    },
  };
}

describe("resolvePreviousMythicSeason", () => {
  const seasonA = season({
    id: "a",
    slug: "season-a",
    blizzardSeasonId: 10,
    startsAt: new Date("2024-01-01T00:00:00.000Z"),
    endsAt: new Date("2024-06-01T00:00:00.000Z"),
  });
  const seasonB = season({
    id: "b",
    slug: "season-b",
    blizzardSeasonId: 11,
    startsAt: new Date("2024-07-01T00:00:00.000Z"),
    endsAt: new Date("2024-12-01T00:00:00.000Z"),
  });
  const seasonC = season({
    id: "c",
    slug: "season-c",
    blizzardSeasonId: 12,
    startsAt: new Date("2025-01-01T00:00:00.000Z"),
    endsAt: new Date("2025-06-01T00:00:00.000Z"),
  });

  it("selects the immediately previous season (B when A < B < C)", () => {
    const result = resolvePreviousMythicSeason(seasonC, [seasonA, seasonB, seasonC]);
    expect(result).toEqual({ ok: true, season: seasonB });
  });

  it("is independent of candidate input order", () => {
    const shuffled = [seasonC, seasonA, seasonB];
    const again = [seasonB, seasonC, seasonA];
    expect(resolvePreviousMythicSeason(seasonC, shuffled)).toEqual({
      ok: true,
      season: seasonB,
    });
    expect(resolvePreviousMythicSeason(seasonC, again)).toEqual({
      ok: true,
      season: seasonB,
    });
  });

  it("never selects a more recent season from another region", () => {
    const otherRegionLater = season({
      id: "other",
      slug: "season-other",
      regionId: regionB,
      blizzardSeasonId: 99,
      startsAt: new Date("2024-11-01T00:00:00.000Z"),
      endsAt: new Date("2025-02-01T00:00:00.000Z"),
    });
    const result = resolvePreviousMythicSeason(seasonC, [
      seasonA,
      otherRegionLater,
      seasonC,
    ]);
    expect(result).toEqual({ ok: true, season: seasonA });
  });

  it("excludes candidates without blizzardSeasonId", () => {
    const noBlizzard = season({
      id: "b-no-blizz",
      slug: "season-b-no-blizz",
      blizzardSeasonId: null,
      startsAt: new Date("2024-07-01T00:00:00.000Z"),
      endsAt: new Date("2024-12-01T00:00:00.000Z"),
    });
    const result = resolvePreviousMythicSeason(seasonC, [seasonA, noBlizzard, seasonC]);
    expect(result).toEqual({ ok: true, season: seasonA });
  });

  it("returns CURRENT_REGION_MISSING when current regionId is null", () => {
    const current = season({
      id: "c",
      slug: "season-c",
      regionId: null,
      startsAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    expect(resolvePreviousMythicSeason(current, [seasonA, seasonB])).toEqual({
      ok: false,
      reason: "CURRENT_REGION_MISSING",
    });
  });

  it("returns CURRENT_START_MISSING when current startsAt is null", () => {
    const current = season({
      id: "c",
      slug: "season-c",
      startsAt: null,
    });
    expect(resolvePreviousMythicSeason(current, [seasonA, seasonB])).toEqual({
      ok: false,
      reason: "CURRENT_START_MISSING",
    });
  });

  it("does not guess previous season from Blizzard ID arithmetic when starts are missing", () => {
    const current = season({
      id: "c",
      slug: "season-c",
      blizzardSeasonId: 12,
      startsAt: null,
    });
    const priorByIdOnly = season({
      id: "b",
      slug: "season-b",
      blizzardSeasonId: 11,
      startsAt: null,
    });
    expect(resolvePreviousMythicSeason(current, [priorByIdOnly])).toEqual({
      ok: false,
      reason: "CURRENT_START_MISSING",
    });
  });

  it("returns NO_PREVIOUS_SEASON when no historical candidate exists", () => {
    expect(resolvePreviousMythicSeason(seasonC, [seasonC])).toEqual({
      ok: false,
      reason: "NO_PREVIOUS_SEASON",
    });
  });

  it("applies deterministic tie-break on duplicate startsAt", () => {
    const twinEarlyEnd = season({
      id: "twin-z",
      slug: "season-twin-z",
      blizzardSeasonId: 11,
      startsAt: new Date("2024-07-01T00:00:00.000Z"),
      endsAt: new Date("2024-10-01T00:00:00.000Z"),
    });
    const twinLateEnd = season({
      id: "twin-a",
      slug: "season-twin-a",
      blizzardSeasonId: 110,
      startsAt: new Date("2024-07-01T00:00:00.000Z"),
      endsAt: new Date("2024-12-01T00:00:00.000Z"),
    });
    const result = resolvePreviousMythicSeason(seasonC, [
      twinEarlyEnd,
      twinLateEnd,
      seasonC,
    ]);
    // Later endsAt wins when startsAt equal.
    expect(result).toEqual({ ok: true, season: twinLateEnd });

    const sameEnds = [
      season({
        id: "id-b",
        slug: "slug-b",
        blizzardSeasonId: 1,
        startsAt: new Date("2024-07-01T00:00:00.000Z"),
        endsAt: new Date("2024-12-01T00:00:00.000Z"),
      }),
      season({
        id: "id-a",
        slug: "slug-a",
        blizzardSeasonId: 2,
        startsAt: new Date("2024-07-01T00:00:00.000Z"),
        endsAt: new Date("2024-12-01T00:00:00.000Z"),
      }),
    ];
    const tied = resolvePreviousMythicSeason(seasonC, [...sameEnds, seasonC]);
    // slug ascending then id — slug-a wins.
    expect(tied.ok && tied.season.id).toBe("id-a");
  });
});

describe("mapSeasonProfileToPreviousSeasonRatingEvidence", () => {
  const binding = season({
    id: "prev",
    slug: "season-prev",
    blizzardSeasonId: 11,
  });

  it("maps finite rating to HAS_VALUE", () => {
    const evidence = mapSeasonProfileToPreviousSeasonRatingEvidence({
      binding,
      result: providerResult({ rating: 2845.5 }),
      providerPayloadId: "payload-1",
    });
    expect(evidence).toMatchObject({
      state: "HAS_VALUE",
      rating: 2845.5,
      blizzardSeasonId: 11,
      internalSeasonId: "prev",
      providerPayloadId: "payload-1",
    });
  });

  it("maps null rating with empty runs to CONFIRMED_NO_ACTIVITY", () => {
    const evidence = mapSeasonProfileToPreviousSeasonRatingEvidence({
      binding,
      result: providerResult({ rating: null, runs: [] }),
      providerPayloadId: null,
    });
    expect(evidence).toMatchObject({
      state: "CONFIRMED_NO_ACTIVITY",
      rating: null,
      blizzardSeasonId: 11,
    });
  });

  it("does not treat null rating with runs as inactivity", () => {
    const run = {
      id: "run-1",
      region: "EU" as const,
      seasonSlug: "season-prev",
      dungeonSlug: "ara-kara",
      keyLevel: 10,
      completedAt: "2024-08-01T00:00:00.000Z",
      durationMs: 1,
      timerMs: null,
      timed: true,
      scoreValue: 100,
      canonicalFingerprint: "fp",
      affixes: [],
      participants: [],
      sources: [],
    } satisfies MythicRunDTO;
    const evidence = mapSeasonProfileToPreviousSeasonRatingEvidence({
      binding,
      result: providerResult({ rating: null, runs: [run] }),
      providerPayloadId: "p",
    });
    expect(evidence.state).toBe("CONTRADICTORY_PAYLOAD");
    if (evidence.state === "CONTRADICTORY_PAYLOAD") {
      expect(evidence.reason).toBe("NULL_RATING_WITH_RUNS");
    }
  });
});

describe("acquirePreviousSeasonRatingEvidence", () => {
  const previous = season({
    id: "prev",
    slug: "season-prev",
    blizzardSeasonId: 11,
  });

  it("HAS_VALUE: one provider call, persists exact result, returns rating", async () => {
    const result = providerResult({ rating: 3100 });
    const getMythicKeystoneSeasonProfile = vi.fn(async () => result);
    const blizzard: PreviousSeasonBlizzardPort = { getMythicKeystoneSeasonProfile };
    const persistProviderResult = vi.fn(async (r: ProviderResult<unknown>) => {
      expect(r).toBe(result);
      return "payload-xyz";
    });

    const evidence = await acquirePreviousSeasonRatingEvidence({
      identity,
      previousSeason: previous,
      blizzard,
      ctx,
      persistProviderResult,
    });

    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledWith(identity, 11, ctx);
    expect(persistProviderResult).toHaveBeenCalledTimes(1);
    expect(evidence).toEqual({
      state: "HAS_VALUE",
      internalSeasonId: "prev",
      seasonSlug: "season-prev",
      blizzardSeasonId: 11,
      rating: 3100,
      fetchedAt: "2026-08-08T00:00:01.000Z",
      providerPayloadId: "payload-xyz",
    });
  });

  it("CONFIRMED_NO_ACTIVITY when rating null and runs empty", async () => {
    const result = providerResult({ rating: null, runs: [] });
    const blizzard: PreviousSeasonBlizzardPort = {
      getMythicKeystoneSeasonProfile: vi.fn(async () => result),
    };
    const persistProviderResult = vi.fn(async () => "payload-empty");

    const evidence = await acquirePreviousSeasonRatingEvidence({
      identity,
      previousSeason: previous,
      blizzard,
      ctx,
      persistProviderResult,
    });

    expect(evidence.state).toBe("CONFIRMED_NO_ACTIVITY");
    expect(persistProviderResult).toHaveBeenCalledTimes(1);
  });

  it("CONTRADICTORY_PAYLOAD when rating null but runs present", async () => {
    const run = {
      id: "run-1",
      region: "EU" as const,
      seasonSlug: "season-prev",
      dungeonSlug: "ara-kara",
      keyLevel: 10,
      completedAt: "2024-08-01T00:00:00.000Z",
      durationMs: 1,
      timerMs: null,
      timed: true,
      scoreValue: null,
      canonicalFingerprint: "fp",
      affixes: [],
      participants: [],
      sources: [],
    } satisfies MythicRunDTO;
    const blizzard: PreviousSeasonBlizzardPort = {
      getMythicKeystoneSeasonProfile: vi.fn(async () =>
        providerResult({ rating: null, runs: [run] }),
      ),
    };

    const evidence = await acquirePreviousSeasonRatingEvidence({
      identity,
      previousSeason: previous,
      blizzard,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
    });

    expect(evidence.state).toBe("CONTRADICTORY_PAYLOAD");
  });

  it("PROVIDER_FAILURE does not become CONFIRMED_NO_ACTIVITY", async () => {
    const cause = new Error("upstream 500");
    const blizzard: PreviousSeasonBlizzardPort = {
      getMythicKeystoneSeasonProfile: vi.fn(async () => {
        throw cause;
      }),
    };
    const persistProviderResult = vi.fn(async () => "should-not-run");

    const evidence = await acquirePreviousSeasonRatingEvidence({
      identity,
      previousSeason: previous,
      blizzard,
      ctx,
      persistProviderResult,
    });

    expect(evidence).toEqual({
      state: "PROVIDER_FAILURE",
      reason: "MYTHIC_KEYSTONE_SEASON_PROFILE_FAILED",
      cause,
    });
    expect(persistProviderResult).not.toHaveBeenCalled();
  });
});

describe("corroboratePreviousSeasonBlizzardNotFound", () => {
  const previous = season({
    id: "prev",
    slug: "tww-3",
    blizzardSeasonId: 13,
    startsAt: new Date("2025-01-01T00:00:00.000Z"),
  });

  it("maps ambiguous 404 + RIO absence to CONFIRMED_NO_ACTIVITY", () => {
    const cause = { statusCode: 404, code: "NOT_FOUND", details: { reason: "PROFILE_UNAVAILABLE" } };
    expect(isAmbiguousBlizzardSeasonProfileNotFound(cause)).toBe(true);
    const out = corroboratePreviousSeasonBlizzardNotFound({
      binding: previous,
      ratingEvidence: {
        state: "PROVIDER_FAILURE",
        reason: "MYTHIC_KEYSTONE_SEASON_PROFILE_FAILED",
        cause,
      },
      rio: { profileFetched: true, previousSeasonScore: null },
      fetchedAt: "2026-08-08T00:00:00.000Z",
    });
    expect(out).toMatchObject({
      state: "CONFIRMED_NO_ACTIVITY",
      blizzardSeasonId: 13,
      rating: null,
    });
  });

  it("keeps PROVIDER_FAILURE when RIO reports previous-season score", () => {
    const cause = { statusCode: 404, code: "NOT_FOUND" };
    const out = corroboratePreviousSeasonBlizzardNotFound({
      binding: previous,
      ratingEvidence: {
        state: "PROVIDER_FAILURE",
        reason: "MYTHIC_KEYSTONE_SEASON_PROFILE_FAILED",
        cause,
      },
      rio: { profileFetched: true, previousSeasonScore: 2500 },
    });
    expect(out).toMatchObject({
      state: "PROVIDER_FAILURE",
      reason: "BLIZZARD_404_CONTRADICTED_BY_RAIDERIO",
    });
  });

  it("does not invent absence without RIO corroboration", () => {
    const cause = { statusCode: 404, code: "NOT_FOUND" };
    const out = corroboratePreviousSeasonBlizzardNotFound({
      binding: previous,
      ratingEvidence: {
        state: "PROVIDER_FAILURE",
        reason: "MYTHIC_KEYSTONE_SEASON_PROFILE_FAILED",
        cause,
      },
      rio: null,
    });
    expect(out).toMatchObject({
      state: "PROVIDER_FAILURE",
      reason: "BLIZZARD_404_UNCORROBORATED",
    });
  });
});
