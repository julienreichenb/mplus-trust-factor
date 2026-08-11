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
  buildPreviousSeasonRatingPersistInput,
  createInMemoryExperienceEvidenceStore,
} from "./experience-evidence-persist.js";
import {
  allowExperienceBlizzardProviderCalls,
  buildExperiencePhase1Result,
  mapPreviousEvidenceToPhase1Input,
  previousRegionalClassRankFromRioProfile,
  rioPreviousSeasonCorroborationFromProfile,
} from "./experience-phase1.js";
import type { HistoricalSeasonRating } from "./experience-blizzard-season-history.js";

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
    schemaVersion: "experience-population-policy-store-v2",
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

const PREV_RIO_SLUG = "season-tww-2";

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
      isCurrent: true,
      providerSeasonId: "season-tww-3",
      metadata: {},
    },
    {
      id: PREV_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-14",
      blizzardSeasonId: 14,
      startsAt: opts.prevStartsAt,
      endsAt: new Date("2025-12-01T00:00:00.000Z"),
      isCurrent: false,
      providerSeasonId: PREV_RIO_SLUG,
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

function blizzardHistorical(
  overrides: Partial<HistoricalSeasonRating> & Pick<HistoricalSeasonRating, "rating" | "state">,
): HistoricalSeasonRating {
  return {
    seasonId: PREV_ID,
    seasonSlug: "blizzard-season-14",
    blizzardSeasonId: 14,
    source: "BLIZZARD",
    ...overrides,
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
  it("builds Experience from persisted historical rating + policy (no Season Details)", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const getMythicKeystoneSeasonProfile = vi.fn(async () => {
      throw new Error("Phase1 must not acquire Season Details");
    });
    const getCharacterAchievements = vi.fn(async () => achievementsDto([]));
    const persistProviderResult = vi.fn(async () => "payload");

    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult,
      allowProviderCalls: true,
      historicalRatingsOverride: [
        blizzardHistorical({ rating: 2900, state: "HAS_VALUE" }),
      ],
    });

    expect(getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(getCharacterAchievements).toHaveBeenCalledTimes(1);
    expect(persistProviderResult).toHaveBeenCalledTimes(1);
    expect(result.previousSeasonProfileCalls).toBe(0);
    expect(result.raiderIoHistoricalRatingCalls).toBe(0);
    expect(result.achievementsCalls).toBe(1);
    expect(result.experience.available).toBe(true);
    expect(result.experience.score).toBe(75);
    expect(result.experience.eliteFloorApplied).toBe(false);
    expect(result.experience.standingProvenance?.ratingSource).toBe("BLIZZARD");
    expect(result.experience.standingProvenance?.historicalRating).toBe(2900);
  });

  it("season-level CONFIRMED_NO_ACTIVITY alone does not yield global E0", async () => {
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
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      historicalRatingsOverride: [
        blizzardHistorical({ rating: null, state: "CONFIRMED_NO_ACTIVITY" }),
      ],
    });
    // Partial no-activity rows ≠ whole-history absence → standing unavailable, not E0.
    expect(result.diagnostics.previousReason).toBe("NO_SCOREABLE_HISTORICAL_STANDING");
    expect(result.experience.previousStandingScore).toBeNull();
    expect(result.experience.score).toBeNull();
    expect(result.experience.available).toBe(false);
    expect(result.experience.reason).toBe("HISTORICAL_EVIDENCE_UNAVAILABLE");
  });

  it("class-rank floor still scores when only CONFIRMED_NO_ACTIVITY history exists", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
      }),
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(),
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      previousRegionalClassRank: 7,
      historicalRatingsOverride: [
        blizzardHistorical({ rating: null, state: "CONFIRMED_NO_ACTIVITY" }),
      ],
    });
    expect(result.diagnostics.previousReason).toBe("NO_SCOREABLE_HISTORICAL_STANDING");
    expect(result.experience.previousStandingScore).toBeNull();
    expect(result.experience.available).toBe(true);
    expect(result.experience.score).toBe(97);
    expect(result.experience.classRankFloorApplied).toBe(true);
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
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("Phase1 must not acquire");
        }),
        getCharacterAchievements: vi.fn(async () =>
          achievementsDto([
            { achievementId: 20_589, completedAt: "2025-03-01T00:00:00.000Z" },
          ]),
        ),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      historicalRatingsOverride: [
        blizzardHistorical({ rating: 2350, state: "HAS_VALUE" }),
      ],
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
        prevMetadata: {}, // missing policy → standing uncontextualized
      }),
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("Phase1 must not acquire");
        }),
        getCharacterAchievements: vi.fn(async () =>
          achievementsDto([
            { achievementId: 40_954, completedAt: "2025-08-01T00:00:00.000Z" },
          ]),
        ),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      historicalRatingsOverride: [
        blizzardHistorical({ rating: 2900, state: "HAS_VALUE" }),
      ],
    });
    expect(result.diagnostics.previousReason).toBe("NO_CONTEXTUALIZED_HISTORICAL_STANDING");
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
      characterId: "char-test",
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
      historicalRatingsOverride: [
        blizzardHistorical({ rating: 2900, state: "HAS_VALUE" }),
      ],
    });
    expect(result.experience.available).toBe(false);
    expect(result.experience.score).toBeNull();
    expect(result.diagnostics.previousReason).toBe("NO_CONTEXTUALIZED_HISTORICAL_STANDING");
    expect(result.diagnostics.uncontextualizedHistoricalSeasonCount).toBe(1);
  });

  it("missing current season performs no Season Details and stays unavailable", async () => {
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
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      characterId: "char-test",
      currentSeasonId: "missing-season",
      regionCode: "EU",
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      historicalRatingsOverride: [
        blizzardHistorical({ rating: 2900, state: "HAS_VALUE" }),
      ],
    });
    expect(getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(result.previousSeasonProfileCalls).toBe(0);
    expect(result.achievementsCalls).toBe(1);
    expect(result.diagnostics.bindingReason).toBe("CURRENT_SEASON_NOT_FOUND");
    expect(result.experience.available).toBe(false);
  });

  it("achievement failure does not discard a score already at/above the elite floor", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    // Rating above p999 threshold → standing 100; elite cannot change the result.
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("Phase1 must not acquire");
        }),
        getCharacterAchievements: vi.fn(async () => {
          throw new Error("achievements down");
        }),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      historicalRatingsOverride: [
        blizzardHistorical({ rating: 3600, state: "HAS_VALUE" }),
      ],
    });
    expect(result.experience.available).toBe(true);
    expect(result.experience.score).toBe(100);
    expect(result.experience.confirmedEliteTitleCount).toBe(0);
    expect(result.diagnostics.eliteReason).toContain("achievements down");
  });

  it("achievement failure remains unavailable when elite could raise the score", async () => {
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
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("Phase1 must not acquire");
        }),
        getCharacterAchievements: vi.fn(async () => {
          throw new Error("achievements down");
        }),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      historicalRatingsOverride: [
        blizzardHistorical({ rating: 2900, state: "HAS_VALUE" }),
      ],
    });
    expect(result.experience.available).toBe(false);
    expect(result.experience.score).toBeNull();
    expect(result.experience.reason).toBe("ELITE_EVIDENCE_UNAVAILABLE");
    expect(result.diagnostics.eliteReason).toContain("achievements down");
  });

  it("confirmed no activity + achievements failure remains unavailable (not zero)", async () => {
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
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("Phase1 must not acquire");
        }),
        getCharacterAchievements: vi.fn(async () => {
          throw new Error("achievements down");
        }),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      historicalRatingsOverride: [
        blizzardHistorical({ rating: null, state: "CONFIRMED_NO_ACTIVITY" }),
      ],
    });
    expect(result.experience.available).toBe(false);
    expect(result.experience.score).toBeNull();
    // Season-level absence alone does not resolve previous → historical unavailable.
    expect(result.experience.reason).toBe("HISTORICAL_EVIDENCE_UNAVAILABLE");
  });

  it("without persisted historical evidence Phase1 stays unavailable (no acquisition)", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const getMythicKeystoneSeasonProfile = vi.fn(async () =>
      seasonProfile(null, [{ id: "run-1" } as never]),
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile,
        getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
    });
    expect(getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(result.previousSeasonProfileCalls).toBe(0);
    expect(result.experience.available).toBe(false);
    expect(result.experience.score).toBeNull();
    expect(result.diagnostics.previousReason).toBe("NO_HISTORICAL_RATING_EVIDENCE");
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
      characterId: "char-test",
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

  it("Phase1: 0 Season Details / 0 RIO historical; at most 1 achievements call", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const store = createInMemoryExperienceEvidenceStore();
    await store.upsertImmutable(
      buildPreviousSeasonRatingPersistInput({
        characterId: "char-test",
        evidence: {
          state: "HAS_VALUE",
          rating: 3000,
          ratingSource: "BLIZZARD",
          internalSeasonId: PREV_ID,
          seasonSlug: "blizzard-season-14",
          blizzardSeasonId: 14,
          fetchedAt: "2026-08-08T00:00:01.000Z",
          providerPayloadId: "p",
        },
        raiderIoSeasonSlug: PREV_RIO_SLUG,
      })!,
    );
    const blizzard = {
      getMythicKeystoneSeasonProfile: vi.fn(async () => {
        throw new Error("Phase1 must not acquire");
      }),
      getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      getSeasonCutoffs: vi.fn(),
      discoverCharacterRuns: vi.fn(),
    };
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
    });
    expect(blizzard.getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(blizzard.getCharacterAchievements).toHaveBeenCalledTimes(1);
    expect(blizzard.getSeasonCutoffs).not.toHaveBeenCalled();
    expect(blizzard.discoverCharacterRuns).not.toHaveBeenCalled();
    expect(result.previousSeasonProfileCalls).toBe(0);
    expect(result.raiderIoHistoricalRatingCalls).toBe(0);
    expect(result.previousSeasonRatingFromCache).toBe(true);
    expect(result.experience.score).toBe(90);
  });

  it("applies caller-supplied previous regional class rank without Season Details", async () => {
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
      getMythicKeystoneSeasonProfile: vi.fn(async () => {
        throw new Error("Phase1 must not acquire");
      }),
      getCharacterAchievements: vi.fn(async () => achievementsDto([])),
      getSeasonCutoffs: vi.fn(),
    };
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      characterId: "char-test",
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard,
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      previousRegionalClassRank: 18,
      historicalRatingsOverride: [
        blizzardHistorical({ rating: 3000, state: "HAS_VALUE" }),
      ],
    });
    // Standing 90 from rating 3000 (= p990) vs fixture policy; class rank #18 → floor 94.
    expect(result.experience.score).toBe(94);
    expect(result.experience.classRankFloor).toBe(94);
    expect(result.experience.classRankFloorApplied).toBe(true);
    expect(blizzard.getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(result.previousSeasonProfileCalls).toBe(0);
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
      characterId: "char-test",
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

  it("does not accept RAIDERIO_FALLBACK rows as Phase1 historical standing", async () => {
    const prisma = createPrismaFake(
      seasonRows({
        currentStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        prevStartsAt: new Date("2025-06-01T00:00:00.000Z"),
        prevMetadata: {
          [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(),
        },
      }),
    );
    const store = createInMemoryExperienceEvidenceStore();
    await store.upsertImmutable(
      buildPreviousSeasonRatingPersistInput({
        characterId: "char-rio",
        evidence: {
          state: "HAS_VALUE",
          rating: 2900,
          ratingSource: "RAIDERIO_FALLBACK",
          internalSeasonId: PREV_ID,
          seasonSlug: "blizzard-season-14",
          blizzardSeasonId: 14,
          fetchedAt: "2026-08-08T00:00:01.000Z",
          providerPayloadId: "p",
        },
        raiderIoSeasonSlug: PREV_RIO_SLUG,
      })!,
    );
    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      identity,
      characterId: "char-rio",
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
      rioExactSeasonFallback: {
        profileFetched: true,
        exactSeasonSlug: PREV_RIO_SLUG,
        exactSeasonScore: 2900,
        activityProof: "UNKNOWN",
      },
    });
    expect(result.raiderIoHistoricalRatingCalls).toBe(0);
    expect(result.previousSeasonProfileCalls).toBe(0);
    expect(result.diagnostics.ratingSource).not.toBe("RAIDERIO_FALLBACK");
    expect(result.experience.available).toBe(false);
    expect(result.experience.score).toBeNull();
  });
});

describe("previousRegionalClassRankFromRioProfile", () => {
  it("fails closed unless exact-season identity is proven", () => {
    const ranks = {
      previousRanks: {
        overall: 5607,
        class: 1456,
        classRank: { world: 1456, region: 503, realm: 12 },
        server: 95,
        world: 18745,
        region: 5607,
        role: "dps",
      },
    };
    expect(previousRegionalClassRankFromRioProfile(ranks)).toBeNull();
    expect(
      previousRegionalClassRankFromRioProfile(ranks, { exactSeasonProven: false }),
    ).toBeNull();
    expect(previousRegionalClassRankFromRioProfile(null)).toBeNull();
  });

  it("reads previousRanks.classRank.region only when exactSeasonProven", () => {
    expect(
      previousRegionalClassRankFromRioProfile(
        {
          previousRanks: {
            overall: 5607,
            class: 1456,
            classRank: { world: 1456, region: 503, realm: 12 },
            server: 95,
            world: 18745,
            region: 5607,
            role: "dps",
          },
        },
        { exactSeasonProven: true },
      ),
    ).toBe(503);
    expect(
      previousRegionalClassRankFromRioProfile(
        {
          previousRanks: {
            overall: 12,
            class: null,
            classRank: { world: null, region: null, realm: null },
            server: null,
            world: 12,
            region: 12,
            role: null,
          },
        },
        { exactSeasonProven: true },
      ),
    ).toBeNull();
  });
});

describe("rioPreviousSeasonCorroborationFromProfile", () => {
  it("does not assume profile is supplied", () => {
    expect(rioPreviousSeasonCorroborationFromProfile(null)).toBeNull();
    expect(rioPreviousSeasonCorroborationFromProfile(undefined)).toBeNull();
  });

  it("requires bound previous slug match (Wallidrixe-safe when slug matches)", () => {
    const profile = {
      previousSeason: { seasonSlug: "season-zx-1", scores: { all: 0 } },
    };
    expect(
      rioPreviousSeasonCorroborationFromProfile(profile, {
        boundPreviousRaiderIoSlug: "season-zx-1",
      }),
    ).toEqual({
      profileFetched: true,
      previousSeasonScore: null,
      seasonBound: true,
      exactSeasonSlug: "season-zx-1",
    });
    expect(
      rioPreviousSeasonCorroborationFromProfile(profile, {
        boundPreviousRaiderIoSlug: "season-zx-2",
      }),
    ).toEqual({
      profileFetched: true,
      previousSeasonScore: null,
      seasonBound: false,
      exactSeasonSlug: "season-zx-2",
    });
    expect(
      rioPreviousSeasonCorroborationFromProfile(
        { previousSeason: { seasonSlug: "season-zx-1", scores: { all: 3200 } } },
        { boundPreviousRaiderIoSlug: "season-zx-1" },
      ),
    ).toEqual({
      profileFetched: true,
      previousSeasonScore: 3200,
      seasonBound: true,
      exactSeasonSlug: "season-zx-1",
    });
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
        ratingSource: "BLIZZARD",
      },
      policyMetadata: null,
    });
    expect(mapped.previous).toEqual({ state: "CONFIRMED_NO_ACTIVITY" });
  });
});
