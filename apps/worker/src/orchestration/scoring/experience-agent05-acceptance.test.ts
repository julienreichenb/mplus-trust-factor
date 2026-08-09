/**
 * Agent 05 — final acceptance proofs for Experience Evidence Completion.
 *
 * Productive-path native bands, process-restart durable reuse, invented N→N+1
 * evidence isolation, and failure-mode matrix. Invented season IDs only
 * (no live Midnight/TWW constants as algorithm proof).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  BlizzardCharacterAchievementsDTO,
  CharacterIdentityInput,
  ProviderFetchContext,
  ProviderResult,
  RaiderIoCutoffThreshold,
  RaiderIoSeasonCutoffs,
} from "@mplus/contracts";
import type { CharacterExperienceEvidenceDTO } from "@mplus/database";
import {
  buildSeasonPopulationPolicy,
  estimatePreviousSeasonStanding,
  type NativeCutoffBand,
  type SeasonPopulationPolicy,
} from "@mplus/scoring";
import {
  EXPERIENCE_EVIDENCE_KIND,
  EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
  createInMemoryExperienceEvidenceStore,
  ratingEvidenceFromPersistedRow,
} from "./experience-evidence-persist.js";
import {
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  hashSeasonPopulationPolicyContent,
  type PersistedExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";
import {
  buildExperiencePhase1Result,
  previousRegionalClassRankFromRioProfile,
} from "./experience-phase1.js";
import {
  isRealMythicPlusRaiderIoSeason,
  resolveRaiderIoCurrentAndPrevious,
} from "./experience-season-bootstrap.js";
import { resolvePreviousMythicSeason } from "./experience-previous-season-evidence.js";

const identity: CharacterIdentityInput = {
  region: "EU",
  realmSlug: "archimonde",
  name: "Acceptance",
};

const ctx: ProviderFetchContext = {
  region: "EU",
  requestId: "agent05-acceptance",
  correlationId: null,
  forceRefresh: false,
  now: "2031-10-01T00:00:00.000Z",
};

/** Invented future-like seasons — not live Midnight/TWW IDs. */
const invented = {
  regionId: "region-zx",
  charId: "char-agent05-1",
  nMinus1Id: "season-zx-n-1",
  nId: "season-zx-n",
  nPlus1Id: "season-zx-n-plus-1",
  eventSlug: "season-zx-n-break-the-meta",
  nMinus1Blizzard: 9102,
  nBlizzard: 9105,
  nPlus1Blizzard: 9108,
  nMinus1Rio: "season-zx-1",
  nRio: "season-zx-2",
  nPlus1Rio: "season-zx-3",
  nMinus1Start: "2031-03-01T04:00:00.000Z",
  nStart: "2031-09-01T04:00:00.000Z",
  nPlus1Start: "2032-03-01T04:00:00.000Z",
  eventStart: "2031-07-15T04:00:00.000Z",
};

function threshold(
  score: number,
  quantile: RaiderIoCutoffThreshold["quantile"],
  label: RaiderIoCutoffThreshold["label"],
): RaiderIoCutoffThreshold {
  return { score, quantile, label };
}

function syntheticCutoffs(seasonSlug: string): RaiderIoSeasonCutoffs {
  return {
    region: "EU",
    seasonSlug,
    updatedAt: "2031-01-01T00:00:00.000Z",
    // Synthetic thresholds only (Agent 04 locked examples).
    top0_1Percent: threshold(3500, "p999", "top_0_1_percent"),
    top1Percent: threshold(3200, "p990", "top_1_percent"),
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
}

function policyDoc(seasonSlug: string): PersistedExperiencePopulationPolicyMetadata {
  const built = buildSeasonPopulationPolicy(syntheticCutoffs(seasonSlug), { seasonSlug });
  if (!built.ok) throw new Error(built.reason);
  return {
    schemaVersion: "experience-population-policy-store-v2",
    policy: built.policy,
    raiderIoSeasonSlug: seasonSlug,
    policyContentHash: hashSeasonPopulationPolicyContent(built.policy),
    sourceRequestFingerprint: "fp-agent05",
    sourcePayloadId: "payload-agent05",
    sourceFetchedAt: "2031-01-01T00:00:00.000Z",
    synchronizedAt: "2031-01-01T00:00:01.000Z",
    lastKnownGood: true,
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
      fetchedAt: "2031-10-01T00:00:01.000Z",
      schemaVersion: "blizzard-test",
    },
    freshness: {
      fetchedAt: "2031-10-01T00:00:01.000Z",
      expiresAt: null,
      stale: false,
    },
    metadata: {
      provider: "blizzard",
      endpointKey: "test",
      requestFingerprint: fingerprint,
      requestedAt: "2031-10-01T00:00:00.000Z",
      completedAt: "2031-10-01T00:00:01.000Z",
      statusCode: 200,
      cacheHit: false,
      retryCount: 0,
      costUnits: 1,
      etag: null,
      expiresAt: null,
    },
  };
}

function seasonProfile(
  rating: number | null,
  runs: unknown[] | null = [{ keyLevel: 12 }],
): ProviderResult<{
  profile: {
    currentMythicRating: number | null;
    currentSeasonId: number;
    seasons: Array<{ seasonId: number }>;
    character: { region: string; realmSlug: string; name: string };
  };
  runs: unknown[];
}> {
  return providerResult(
    {
      profile: {
        currentMythicRating: rating,
        currentSeasonId: invented.nMinus1Blizzard,
        seasons: [{ seasonId: invented.nMinus1Blizzard }],
        character: {
          region: "EU",
          realmSlug: identity.realmSlug,
          name: identity.name,
        },
      },
      runs: runs ?? [],
    },
    "fp-season-profile",
  );
}

function achievementsDto(
  rows: Array<{ achievementId: number; completedAt: string | null }> = [],
): ProviderResult<BlizzardCharacterAchievementsDTO> {
  return providerResult({ achievements: rows }, "fp-achievements");
}

function seasonsBeforeRollover() {
  return [
    {
      id: invented.nId,
      regionId: invented.regionId,
      slug: `blizzard-season-${invented.nBlizzard}`,
      blizzardSeasonId: invented.nBlizzard,
      startsAt: new Date(invented.nStart),
      endsAt: null,
      metadata: {},
      providerSeasonId: invented.nRio,
    },
    {
      id: invented.nMinus1Id,
      regionId: invented.regionId,
      slug: `blizzard-season-${invented.nMinus1Blizzard}`,
      blizzardSeasonId: invented.nMinus1Blizzard,
      startsAt: new Date(invented.nMinus1Start),
      endsAt: new Date(invented.nStart),
      metadata: {
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc(invented.nMinus1Rio),
      },
      providerSeasonId: invented.nMinus1Rio,
    },
  ];
}

function seasonsAfterRollover() {
  return [
    {
      id: invented.nPlus1Id,
      regionId: invented.regionId,
      slug: `blizzard-season-${invented.nPlus1Blizzard}`,
      blizzardSeasonId: invented.nPlus1Blizzard,
      startsAt: new Date(invented.nPlus1Start),
      endsAt: null,
      metadata: {},
      providerSeasonId: invented.nPlus1Rio,
    },
    {
      id: invented.nId,
      regionId: invented.regionId,
      slug: `blizzard-season-${invented.nBlizzard}`,
      blizzardSeasonId: invented.nBlizzard,
      startsAt: new Date(invented.nStart),
      endsAt: new Date(invented.nPlus1Start),
      metadata: {
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc(invented.nRio),
      },
      providerSeasonId: invented.nRio,
    },
    {
      id: invented.nMinus1Id,
      regionId: invented.regionId,
      slug: `blizzard-season-${invented.nMinus1Blizzard}`,
      blizzardSeasonId: invented.nMinus1Blizzard,
      startsAt: new Date(invented.nMinus1Start),
      endsAt: new Date(invented.nStart),
      metadata: {
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc(invented.nMinus1Rio),
      },
      providerSeasonId: invented.nMinus1Rio,
    },
  ];
}

function createPrismaFake(rows: ReturnType<typeof seasonsBeforeRollover>) {
  return {
    season: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findMany: async () => rows,
    },
  };
}

describe("Agent 05 — productive native-band path (no interpolation)", () => {
  it("does not use interpolateTopPercent / scoreFromEstimatedTopPercent in Experience modules", () => {
    const roots = [
      resolve(process.cwd(), "apps/worker/src/orchestration/scoring/experience-phase1.ts"),
      resolve(process.cwd(), "apps/worker/src/orchestration/scoring/refresh-bridge.ts"),
      resolve(process.cwd(), "apps/worker/src/orchestration/scoring/score-character.ts"),
      resolve(process.cwd(), "apps/worker/src/orchestration/scoring/experience-previous-season-evidence.ts"),
    ];
    for (const file of roots) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/interpolateTopPercent/);
      expect(src).not.toMatch(/scoreFromEstimatedTopPercent/);
    }
  });

  it("productive acquisition yields discrete native bands for synthetic complete policy", async () => {
    const policy = policyDoc(invented.nMinus1Rio).policy;
    const cases: Array<{ rating: number; band: NativeCutoffBand; score: number }> = [
      { rating: 3600, band: "p999", score: 100 },
      { rating: 3500, band: "p999", score: 100 },
      { rating: 3499, band: "p990", score: 90 },
      { rating: 3200, band: "p990", score: 90 },
      { rating: 3199, band: "p900", score: 75 },
      { rating: 2800, band: "p900", score: 75 },
      { rating: 2799, band: "p750", score: 60 },
      { rating: 2500, band: "p750", score: 60 },
      { rating: 2499, band: "p600", score: 45 },
      { rating: 2200, band: "p600", score: 45 },
      { rating: 2199, band: "below_p600", score: 25 },
    ];

    for (const c of cases) {
      const est = estimatePreviousSeasonStanding(c.rating, policy);
      expect(est.ok).toBe(true);
      if (!est.ok) continue;
      expect(est.standing.method).toBe("NATIVE_BAND");
      expect(est.standing.estimatedTopPercent).toBeNull();
      expect(est.standing.nativeBand).toBe(c.band);
      expect(est.standing.standingScore).toBe(c.score);
    }

    // Two materially different ratings in the same band → identical standing.
    const a = estimatePreviousSeasonStanding(3100, policy);
    const b = estimatePreviousSeasonStanding(2850, policy);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.standing.standingScore).toBe(75);
      expect(b.standing.standingScore).toBe(75);
      expect(a.standing.standingScore).toBe(b.standing.standingScore);
    }
  });

  it("buildExperiencePhase1Result standingProvenance exposes native band (not interpolated)", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const prisma = createPrismaFake(seasonsBeforeRollover());
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: invented.charId,
      identity,
      currentSeasonId: invented.nId,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(2900)),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
      boundPreviousRaiderIoSlug: invented.nMinus1Rio,
    });

    expect(result.experience.available).toBe(true);
    expect(result.experience.score).toBe(75);
    expect(result.experience.previousStandingScore).toBe(75);
    expect(result.diagnostics.matchedNativeBand).toBe("p900");
    expect(result.experience.standingProvenance?.matchedNativeBand).toBe("p900");
    expect(result.experience.standingProvenance?.populationPolicyVersion).toBe(
      "season-population-policy-v2",
    );
    expect(result.experience.confidence).toBe(1);
  });
});

describe("Agent 05 — process-restart durable reuse", () => {
  it("new store facade over shared durable rows reuses evidence with 0 historical calls", async () => {
    const durable = new Map<string, CharacterExperienceEvidenceDTO>();
    const storeCold = createInMemoryExperienceEvidenceStore(durable);
    const prisma = createPrismaFake(seasonsBeforeRollover());
    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfile(2900));
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));

    const cold = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: invented.charId,
      identity,
      currentSeasonId: invented.nId,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: storeCold,
      boundPreviousRaiderIoSlug: invented.nMinus1Rio,
    });
    expect(cold.previousSeasonProfileCalls).toBe(1);
    expect(cold.achievementsCalls).toBe(1);
    expect(durable.size).toBeGreaterThan(0);

    // Simulate process restart: new container/store facade, same durable Map (DB).
    const storeWarm = createInMemoryExperienceEvidenceStore(durable);
    const warm = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: invented.charId,
      identity,
      currentSeasonId: invented.nId,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: storeWarm,
      boundPreviousRaiderIoSlug: invented.nMinus1Rio,
    });
    expect(warm.previousSeasonProfileCalls).toBe(0);
    expect(warm.achievementsCalls).toBe(0);
    expect(warm.raiderIoHistoricalRatingCalls).toBe(0);
    expect(warm.previousSeasonRatingFromCache).toBe(true);
    expect(warm.experience.score).toBe(cold.experience.score);
    expect(warm.experience.available).toBe(cold.experience.available);
    expect(warm.experience.confidence).toBe(cold.experience.confidence);
    expect(warm.experience.standingProvenance?.matchedNativeBand).toBe(
      cold.experience.standingProvenance?.matchedNativeBand,
    );
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);

    const replayStore = createInMemoryExperienceEvidenceStore(durable);
    const replay = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: invented.charId,
      identity,
      currentSeasonId: invented.nId,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: false,
      evidenceStore: replayStore,
      boundPreviousRaiderIoSlug: invented.nMinus1Rio,
    });
    expect(replay.previousSeasonProfileCalls).toBe(0);
    expect(replay.achievementsCalls).toBe(0);
    expect(replay.raiderIoHistoricalRatingCalls).toBe(0);
    expect(replay.experience.score).toBe(cold.experience.score);
    expect(replay.experience.standingProvenance?.ratingSource).toBe("BLIZZARD");
  });
});

describe("Agent 05 — invented N→N+1 rollover + evidence isolation", () => {
  it("event/intermediate RIO season is never previous real Mythic+", () => {
    expect(
      isRealMythicPlusRaiderIoSeason({
        slug: invented.eventSlug,
        name: "Break the Meta ZX",
        startsAt: invented.eventStart,
        endsAt: invented.nStart,
        isCurrent: false,
        isMainSeason: false,
        blizzardSeasonId: null,
        dungeonSlugs: [],
      }),
    ).toBe(false);

    const resolved = resolveRaiderIoCurrentAndPrevious([
      {
        slug: invented.nRio,
        name: invented.nRio,
        startsAt: invented.nStart,
        endsAt: null,
        isCurrent: true,
        isMainSeason: true,
        blizzardSeasonId: invented.nBlizzard,
        dungeonSlugs: ["d1"],
      },
      {
        slug: invented.eventSlug,
        name: "event",
        startsAt: invented.eventStart,
        endsAt: invented.nStart,
        isCurrent: false,
        isMainSeason: false,
        blizzardSeasonId: null,
        dungeonSlugs: [],
      },
      {
        slug: invented.nMinus1Rio,
        name: invented.nMinus1Rio,
        startsAt: invented.nMinus1Start,
        endsAt: invented.nStart,
        isCurrent: false,
        isMainSeason: true,
        blizzardSeasonId: invented.nMinus1Blizzard,
        dungeonSlugs: ["d1"],
      },
    ]);
    expect(resolved.current?.slug).toBe(invented.nRio);
    expect(resolved.previous?.slug).toBe(invented.nMinus1Rio);
    expect(resolved.previous?.slug).not.toBe(invented.eventSlug);
  });

  it("rejects fixture pub-cancel seasons as previous candidates", () => {
    const current = {
      id: invented.nId,
      regionId: invented.regionId,
      slug: `blizzard-season-${invented.nBlizzard}`,
      blizzardSeasonId: invented.nBlizzard,
      startsAt: new Date(invented.nStart),
      endsAt: null,
    };
    const binding = resolvePreviousMythicSeason(current, [
      {
        id: "fixture-pollution",
        regionId: invented.regionId,
        slug: "pub-cancel-season",
        blizzardSeasonId: 999001,
        startsAt: new Date("2031-08-01T00:00:00.000Z"),
        endsAt: null,
      },
      {
        id: invented.nMinus1Id,
        regionId: invented.regionId,
        slug: `blizzard-season-${invented.nMinus1Blizzard}`,
        blizzardSeasonId: invented.nMinus1Blizzard,
        startsAt: new Date(invented.nMinus1Start),
        endsAt: new Date(invented.nStart),
      },
    ]);
    expect(binding.ok).toBe(true);
    if (!binding.ok) return;
    expect(binding.season.id).toBe(invented.nMinus1Id);
    expect(binding.season.slug).not.toBe("pub-cancel-season");
  });

  it("before rollover previous=N-1; after flip previous=N; N-1 evidence cannot satisfy N", async () => {
    const durable = new Map<string, CharacterExperienceEvidenceDTO>();
    const store = createInMemoryExperienceEvidenceStore(durable);
    const getMythicKeystoneSeasonProfile = vi.fn(async (_i, seasonId: number) => {
      if (seasonId === invented.nMinus1Blizzard) return seasonProfile(2900);
      if (seasonId === invented.nBlizzard) {
        return providerResult(
          {
            profile: {
              currentMythicRating: 3300,
              currentSeasonId: invented.nBlizzard,
              seasons: [{ seasonId: invented.nBlizzard }],
              character: {
                region: "EU",
                realmSlug: identity.realmSlug,
                name: identity.name,
              },
            },
            runs: [{ keyLevel: 14 }],
          },
          "fp-n",
        );
      }
      throw new Error(`unexpected season ${seasonId}`);
    });
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));

    const beforeBinding = resolvePreviousMythicSeason(
      {
        id: invented.nId,
        regionId: invented.regionId,
        slug: `blizzard-season-${invented.nBlizzard}`,
        blizzardSeasonId: invented.nBlizzard,
        startsAt: new Date(invented.nStart),
        endsAt: null,
      },
      seasonsBeforeRollover().map((r) => ({
        id: r.id,
        regionId: r.regionId,
        slug: r.slug,
        blizzardSeasonId: r.blizzardSeasonId,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
      })),
    );
    expect(beforeBinding.ok).toBe(true);
    if (beforeBinding.ok) {
      expect(beforeBinding.season.id).toBe(invented.nMinus1Id);
      expect(beforeBinding.season.blizzardSeasonId).toBe(invented.nMinus1Blizzard);
    }

    const coldN = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonsBeforeRollover()) as never,
      characterId: invented.charId,
      identity,
      currentSeasonId: invented.nId,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
      boundPreviousRaiderIoSlug: invented.nMinus1Rio,
    });
    expect(coldN.previousSeasonProfileCalls).toBe(1);
    expect(coldN.experience.score).toBe(75);
    expect(coldN.diagnostics.matchedNativeBand).toBe("p900");

    const afterBinding = resolvePreviousMythicSeason(
      {
        id: invented.nPlus1Id,
        regionId: invented.regionId,
        slug: `blizzard-season-${invented.nPlus1Blizzard}`,
        blizzardSeasonId: invented.nPlus1Blizzard,
        startsAt: new Date(invented.nPlus1Start),
        endsAt: null,
      },
      seasonsAfterRollover().map((r) => ({
        id: r.id,
        regionId: r.regionId,
        slug: r.slug,
        blizzardSeasonId: r.blizzardSeasonId,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
      })),
    );
    expect(afterBinding.ok).toBe(true);
    if (afterBinding.ok) {
      expect(afterBinding.season.id).toBe(invented.nId);
      expect(afterBinding.season.blizzardSeasonId).toBe(invented.nBlizzard);
      expect(afterBinding.season.id).not.toBe(invented.nMinus1Id);
    }

    const afterRollover = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonsAfterRollover()) as never,
      characterId: invented.charId,
      identity,
      currentSeasonId: invented.nPlus1Id,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
      boundPreviousRaiderIoSlug: invented.nRio,
    });
    // Must acquire N evidence — N-1 row must not satisfy N.
    expect(afterRollover.previousSeasonProfileCalls).toBe(1);
    expect(afterRollover.experience.score).toBe(90); // 3300 → p990 band
    expect(afterRollover.diagnostics.matchedNativeBand).toBe("p990");

    const oldRow = await store.find({
      characterId: invented.charId,
      seasonId: invented.nMinus1Id,
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
      compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
    });
    const newRow = await store.find({
      characterId: invented.charId,
      seasonId: invented.nId,
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
      compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
    });
    expect(oldRow).not.toBeNull();
    expect(newRow).not.toBeNull();
    expect(oldRow!.blizzardSeasonId).toBe(invented.nMinus1Blizzard);
    expect(newRow!.blizzardSeasonId).toBe(invented.nBlizzard);
    expect(oldRow!.id).not.toBe(newRow!.id);
  });
});

describe("Agent 05 — class-rank fail-closed + failure modes", () => {
  it("ambiguous generic RIO previousRanks are NOT used without exactSeasonProven", () => {
    const rank = previousRegionalClassRankFromRioProfile(
      { previousRanks: { classRank: { region: 7 }, region: 100 } },
      { exactSeasonProven: false },
    );
    expect(rank).toBeNull();
  });

  it("confirmed no activity → E=0; never standing 25", async () => {
    const result = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonsBeforeRollover()) as never,
      characterId: invented.charId,
      identity,
      currentSeasonId: invented.nId,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(null, [])),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: createInMemoryExperienceEvidenceStore(),
      boundPreviousRaiderIoSlug: invented.nMinus1Rio,
    });
    expect(result.experience.available).toBe(true);
    expect(result.experience.score).toBe(0);
    expect(result.experience.previousStandingScore).toBe(0);
    expect(result.experience.confidence).toBe(1);
  });

  it("provider failure without fallback → unavailable (not 0 or 25)", async () => {
    const result = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonsBeforeRollover()) as never,
      characterId: invented.charId,
      identity,
      currentSeasonId: invented.nId,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw Object.assign(new Error("not found"), { statusCode: 404 });
        }),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: createInMemoryExperienceEvidenceStore(),
      // No bound slug / no RIO port → no fallback.
      boundPreviousRaiderIoSlug: null,
    });
    expect(result.experience.available).toBe(false);
    expect(result.experience.score).toBeNull();
    expect(result.experience.score).not.toBe(0);
    expect(result.experience.score).not.toBe(25);
  });

  it("Blizzard failure + exact RIO proven no activity → CONFIRMED_NO_ACTIVITY", async () => {
    const result = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonsBeforeRollover()) as never,
      characterId: invented.charId,
      identity,
      currentSeasonId: invented.nId,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw Object.assign(new Error("not found"), { statusCode: 404 });
        }),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: createInMemoryExperienceEvidenceStore(),
      boundPreviousRaiderIoSlug: invented.nMinus1Rio,
      rioExactSeasonFallback: {
        profileFetched: true,
        exactSeasonSlug: invented.nMinus1Rio,
        exactSeasonScore: 0,
        activityProof: "PROVEN_NONE",
      },
    });
    expect(result.experience.available).toBe(true);
    expect(result.experience.score).toBe(0);
    expect(result.diagnostics.ratingSource).toBe("RAIDERIO_FALLBACK");
  });

  it("Blizzard failure + RIO ambiguous zero → unavailable", async () => {
    const result = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonsBeforeRollover()) as never,
      characterId: invented.charId,
      identity,
      currentSeasonId: invented.nId,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw Object.assign(new Error("not found"), { statusCode: 404 });
        }),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: createInMemoryExperienceEvidenceStore(),
      boundPreviousRaiderIoSlug: invented.nMinus1Rio,
      rioExactSeasonFallback: {
        profileFetched: true,
        exactSeasonSlug: invented.nMinus1Rio,
        exactSeasonScore: 0,
        activityProof: "UNKNOWN",
      },
    });
    expect(result.experience.available).toBe(false);
    expect(result.experience.score).toBeNull();
  });

  it("incompatible compatibilityVersion persisted row is ignored", () => {
    const row = {
      id: "x",
      characterId: invented.charId,
      seasonId: invented.nMinus1Id,
      blizzardSeasonId: invented.nMinus1Blizzard,
      raiderIoSeasonSlug: invented.nMinus1Rio,
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
      compatibilityVersion: "experience-previous-rating-v0-stale",
      state: "HAS_VALUE",
      source: "BLIZZARD",
      payload: {},
      sourcePayloadId: null,
      sourceRequestFingerprint: null,
      contentHash: null,
      fetchedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CharacterExperienceEvidenceDTO;
    expect(ratingEvidenceFromPersistedRow(row)).toBeNull();
  });

  it("partial/ambiguous native policy never becomes standing 25", () => {
    const partial: SeasonPopulationPolicy = {
      version: "season-population-policy-v2",
      source: "RAIDER_IO_SEASON_CUTOFFS",
      region: "EU",
      seasonSlug: invented.nMinus1Rio,
      sourceUpdatedAt: null,
      quality: "PARTIAL",
      anchors: [
        {
          key: "top_1_percent",
          topPercent: 1,
          nativeQuantile: "p990",
          score: 3200,
          quantilePopulationCount: null,
          totalPopulationCount: null,
        },
      ],
    };
    // rating >= p990 but p999 missing → ambiguous, not 25.
    expect(estimatePreviousSeasonStanding(3300, partial)).toEqual({
      ok: false,
      reason: "AMBIGUOUS_PARTIAL_POLICY",
    });
  });
});
