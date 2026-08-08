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
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  hashSeasonPopulationPolicyContent,
  type PersistedExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";
import {
  allowExperienceBlizzardProviderCalls,
  buildExperiencePhase1Result,
  mapPreviousEvidenceToPhase1Input,
  previousRegionalClassRankFromRioProfile,
} from "./experience-phase1.js";

const identity: CharacterIdentityInput = {
  region: "EU",
  realmSlug: "archimonde",
  name: "Tester",
};

const ctx: ProviderFetchContext = {
  region: "EU",
  requestId: "exp-phase1-test",
  correlationId: null,
  forceRefresh: false,
  now: "2026-08-08T00:00:00.000Z",
};

const CURRENT_ID = "season-current";
const PREV_ID = "season-prev";
const REGION_ID = "region-eu";

function threshold(
  score: number,
  quantile: RaiderIoCutoffThreshold["quantile"],
  label: RaiderIoCutoffThreshold["label"],
): RaiderIoCutoffThreshold {
  return { score, quantile, label };
}

function completePolicyDoc(): PersistedExperiencePopulationPolicyMetadata {
  const cutoffs: RaiderIoSeasonCutoffs = {
    region: "EU",
    seasonSlug: "season-tww-2",
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
  const built = buildSeasonPopulationPolicy(cutoffs, { seasonSlug: "season-tww-2" });
  if (!built.ok) throw new Error("expected policy");
  return {
    schemaVersion: "experience-population-policy-store-v1",
    policy: built.policy,
    raiderIoSeasonSlug: "season-tww-2",
    policyContentHash: hashSeasonPopulationPolicyContent(built.policy),
    sourceRequestFingerprint: "fp",
    sourcePayloadId: "payload",
    sourceFetchedAt: "2026-01-01T00:00:00.000Z",
    synchronizedAt: "2026-01-01T00:00:01.000Z",
    lastKnownGood: true,
  };
}

function seasonRows(opts: {
  currentStartsAt: Date | null;
  prevStartsAt: Date | null;
  prevMetadata?: unknown;
}) {
  return [
    {
      id: CURRENT_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-15",
      blizzardSeasonId: 15,
      startsAt: opts.currentStartsAt,
      endsAt: null,
      metadata: {},
    },
    {
      id: PREV_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-14",
      blizzardSeasonId: 14,
      startsAt: opts.prevStartsAt,
      endsAt: new Date("2025-12-01T00:00:00.000Z"),
      metadata: opts.prevMetadata ?? {},
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
      fetchedAt: "2026-08-08T00:00:01.000Z",
      schemaVersion: "blizzard-test",
    },
    freshness: {
      fetchedAt: "2026-08-08T00:00:01.000Z",
      expiresAt: null,
      stale: false,
    },
    metadata: {
      provider: "blizzard",
      endpointKey: "test",
      requestFingerprint: fingerprint,
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
  rows: Array<{ achievementId: number; completedAt: string | null }>,
): ProviderResult<BlizzardCharacterAchievementsDTO> {
  return providerResult({ achievements: rows }, "fp-achievements");
}

describe("allowExperienceBlizzardProviderCalls", () => {
  it("is not gated on WCL_ENABLED", () => {
    expect(
      allowExperienceBlizzardProviderCalls({
        ALLOW_LIVE_PROVIDER_CALLS: true,
        PROVIDER_MODE: "live",
        BLIZZARD_ENABLED: true,
      }),
    ).toBe(true);
  });

  it("requires ALLOW_LIVE_PROVIDER_CALLS", () => {
    expect(
      allowExperienceBlizzardProviderCalls({
        ALLOW_LIVE_PROVIDER_CALLS: false,
        PROVIDER_MODE: "live",
        BLIZZARD_ENABLED: true,
      }),
    ).toBe(false);
  });
});

describe("buildExperiencePhase1Result", () => {
  it("builds Experience from previous rating + persisted policy", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfile(2900));
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));
    const persistProviderResult = vi.fn(async () => "payload");

    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult,
      allowProviderCalls: true,
    });

    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledWith(identity, 14, ctx);
    expect(getCharacterAchievements).toHaveBeenCalledTimes(1);
    expect(persistProviderResult).toHaveBeenCalledTimes(2);
    expect(result.previousSeasonProfileCalls).toBe(1);
    expect(result.achievementsCalls).toBe(1);
    expect(result.experience.available).toBe(true);
    expect(result.experience.score).toBeCloseTo(82.5, 5);
    expect(result.experience.eliteFloorApplied).toBe(false);
  });

  it("maps confirmed no activity to score 0", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(null, [])),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
    });
    expect(result.experience.score).toBe(0);
    expect(result.experience.available).toBe(true);
  });

  it("applies elite 90 floor over weaker previous standing", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(2350)),
        getCharacterAchievements: vi.fn(async () =>
          achievementsDto([
            { achievementId: 20_589, completedAt: "2025-03-01T00:00:00.000Z" },
          ]),
        ),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
    });
    expect(result.experience.score).toBe(90);
    expect(result.experience.eliteFloorApplied).toBe(true);
    expect(result.experience.confirmedEliteTitleCount).toBe(1);
  });

  it("previous unavailable + elite → 90", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {}, // missing policy
      }),
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(2900)),
        getCharacterAchievements: vi.fn(async () =>
          achievementsDto([
            { achievementId: 40_954, completedAt: "2025-08-01T00:00:00.000Z" },
          ]),
        ),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
    });
    expect(result.diagnostics.previousReason).toBe("MISSING_POPULATION_POLICY");
    expect(result.experience.score).toBe(90);
    expect(result.experience.previousStandingScore).toBeNull();
  });

  it("missing policy → previous unavailable", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {},
      }),
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
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
    });
    expect(result.experience.available).toBe(false);
    expect(result.experience.score).toBeNull();
    expect(result.diagnostics.previousReason).toBe("MISSING_POPULATION_POLICY");
  });

  it("unresolved season binding performs no previous Blizzard call", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: null, // CURRENT_START_MISSING
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfile(2900));
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
    });
    expect(getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(result.previousSeasonProfileCalls).toBe(0);
    expect(result.achievementsCalls).toBe(1);
    expect(result.diagnostics.bindingReason).toBe("CURRENT_START_MISSING");
    expect(result.experience.available).toBe(false);
  });

  it("achievement failure does not discard usable previous score", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(2900)),
        getCharacterAchievements: vi.fn(async () => {
          throw new Error("achievements down");
        }),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
    });
    expect(result.experience.available).toBe(true);
    expect(result.experience.score).toBeCloseTo(82.5, 5);
    expect(result.experience.confirmedEliteTitleCount).toBe(0);
    expect(result.diagnostics.eliteReason).toContain("achievements down");
  });

  it("previous-provider failure does not become zero", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("season profile failed");
        }),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
    });
    expect(result.experience.score).toBeNull();
    expect(result.experience.available).toBe(false);
    expect(result.experience.previousStandingScore).toBeNull();
  });

  it("performs at most 2 Blizzard calls and zero Raider.IO / WCL", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const blizzard = {
      getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(3000)),
      getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      getSeasonCutoffs: vi.fn(),
      discoverCharacterRuns: vi.fn(),
    };
    await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
    });
    expect(blizzard.getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(blizzard.getCharacterAchievements).toHaveBeenCalledTimes(1);
    expect(blizzard.getSeasonCutoffs).not.toHaveBeenCalled();
    expect(blizzard.discoverCharacterRuns).not.toHaveBeenCalled();
  });

  it("applies caller-supplied previous regional class rank without extra provider calls", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const blizzard = {
      getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(3000)),
      getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      getSeasonCutoffs: vi.fn(),
    };
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      previousRegionalClassRank: 18,
    });
    // Standing ~82.5 from rating 3000 vs fixture policy; class rank #18 → floor 94.
    expect(result.experience.score).toBe(94);
    expect(result.experience.classRankFloor).toBe(94);
    expect(result.experience.classRankFloorApplied).toBe(true);
    expect(blizzard.getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(blizzard.getSeasonCutoffs).not.toHaveBeenCalled();
  });

  it("class rank alone can produce Experience when previous standing is unavailable", async () => {
    const prisma = createPrismaFake([]);
    const blizzard = {
      getMythicKeystoneSeasonProfile: vi.fn(),
      getCharacterAchievements: vi.fn(async () => achievementsDto([])),
    };
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      currentSeasonId: "missing",
      regionCode: "EU",
      blizzard,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      previousRegionalClassRank: 7,
    });
    expect(blizzard.getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(result.experience.available).toBe(true);
    expect(result.experience.score).toBe(97);
    expect(result.experience.previousStandingScore).toBeNull();
    expect(result.experience.classRankFloorApplied).toBe(true);
  });
});

describe("previousRegionalClassRankFromRioProfile", () => {
  it("reads previousRanks.classRank.region and ignores overall region", () => {
    expect(
      previousRegionalClassRankFromRioProfile({
        previousRanks: {
          overall: 5607,
          class: 1456,
          classRank: { world: 1456, region: 503, realm: 12 },
          server: 95,
          world: 18745,
          region: 5607,
          role: "dps",
        },
      }),
    ).toBe(503);
    expect(
      previousRegionalClassRankFromRioProfile({
        previousRanks: {
          overall: 12,
          class: null,
          classRank: { world: null, region: null, realm: null },
          server: null,
          world: 12,
          region: 12,
          role: null,
        },
      }),
    ).toBeNull();
  });
});

describe("mapPreviousEvidenceToPhase1Input", () => {
  it("maps CONFIRMED_NO_ACTIVITY without requiring policy", () => {
    const mapped = mapPreviousEvidenceToPhase1Input({
      ratingEvidence: {
        state: "CONFIRMED_NO_ACTIVITY",
        internalSeasonId: PREV_ID,
        seasonSlug: "blizzard-season-14",
        blizzardSeasonId: 14,
        rating: null,
        fetchedAt: "2026-08-08T00:00:01.000Z",
        providerPayloadId: null,
      },
      policyMetadata: null,
    });
    expect(mapped.previous).toEqual({ state: "CONFIRMED_NO_ACTIVITY" });
  });
});
