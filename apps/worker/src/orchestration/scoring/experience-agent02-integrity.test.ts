/**
 * Agent 02 — season binding + evidence integrity regressions (F2–F6).
 * These must fail against PR #84 / pre-Agent02 behavior.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import type {
  CharacterIdentityInput,
  ProviderFetchContext,
  ProviderResult,
  RaiderIoCutoffThreshold,
  RaiderIoSeasonCutoffs,
  RaiderIoStaticSeason,
} from "@mplus/contracts";
import type { CharacterExperienceEvidenceDTO } from "@mplus/database";
import { buildSeasonPopulationPolicy } from "@mplus/scoring";
import {
  EXPERIENCE_EVIDENCE_KIND,
  EXPERIENCE_EVIDENCE_SOURCE,
  EXPERIENCE_EVIDENCE_STATE,
  EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
  createInMemoryExperienceEvidenceStore,
  hashExperienceEvidencePayload,
  ratingEvidenceFromPersistedRow,
  buildPreviousSeasonRatingPersistInput,
  buildEliteCutoffHistoryPersistInput,
} from "./experience-evidence-persist.js";
import {
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  hashSeasonPopulationPolicyContent,
  type PersistedExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";
import { buildExperiencePhase1Result } from "./experience-phase1.js";
import {
  classifyBlizzardPreviousSeasonFailureForRioFallback,
  resolveCanonicalPreviousSeasonBinding,
} from "./experience-previous-season-evidence.js";
import {
  ensureExperienceSeasonBindingReady,
  isExperienceSeasonBindingEnsureComplete,
  matchBlizzardSeasonToRaiderIoByDates,
  proveExactRaiderIoCutoffSeasonEquivalence,
  revalidatePersistedRaiderIoSeasonSlug,
  resetExperienceSeasonBindingEnsureStateForTests,
  shouldEnsureExperienceSeasonBinding,
  peekExperienceSeasonBindingEnsureStateForTests,
  bootstrapExperienceSeasonMetadata,
  RIO_BLIZZARD_EXACT_ID_CHRONOLOGY_MAX_MS,
} from "./experience-season-bootstrap.js";
import { synchronizeSeasonPopulationPolicy } from "./experience-season-population-policy-sync.js";

const identity: CharacterIdentityInput = {
  region: "EU",
  realmSlug: "archimonde",
  name: "Tester",
};

const ctx: ProviderFetchContext = {
  region: "EU",
  requestId: "exp-agent02",
  correlationId: null,
  forceRefresh: false,
  now: "2026-08-09T00:00:00.000Z",
};

const CHAR_ID = "char-a02";
const CURRENT_ID = "season-current";
const PREV_ID = "season-prev-real";
const FIXTURE_ID = "season-fixture-pollution";
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

function seasonRowsWithFixturePollution() {
  return [
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
      startsAt: new Date("2025-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-01-01T00:00:00.000Z"),
      metadata: { [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc("season-tww-3") },
      providerSeasonId: "season-tww-3",
    },
    // Later startsAt than real previous — PR #84 refresh-bridge "latest prior" would pick this.
    {
      id: FIXTURE_ID,
      regionId: REGION_ID,
      slug: "pub-cancel-season",
      blizzardSeasonId: 999001,
      startsAt: new Date("2025-11-01T00:00:00.000Z"),
      endsAt: null,
      metadata: {},
      providerSeasonId: "season-fixture-fake-rio",
    },
  ];
}

function createPrismaFake(rows: ReturnType<typeof seasonRowsWithFixturePollution>) {
  return {
    season: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      ),
      findMany: vi.fn(async () => rows),
    },
  };
}

function providerResult<T>(data: T): ProviderResult<T> {
  return {
    data,
    provenance: {
      provider: "blizzard",
      externalRequestId: "ext",
      sourcePayloadId: null,
      sourceUrl: "https://example.test",
      fetchedAt: "2026-08-08T00:00:01.000Z",
      schemaVersion: "test",
    },
    freshness: {
      fetchedAt: "2026-08-08T00:00:01.000Z",
      expiresAt: null,
      ttlSeconds: null,
      stale: false,
    },
    metadata: {
      requestFingerprint: "fp",
      cacheHit: false,
      retryCount: 0,
      durationMs: 1,
      requestedAt: "2026-08-08T00:00:00.000Z",
      completedAt: "2026-08-08T00:00:01.000Z",
      statusCode: 200,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
    },
  };
}

function seasonProfile(rating: number | null) {
  return providerResult({
    profile: {
      currentMythicRating: rating,
      currentSeasonId: 14,
      seasons: [{ seasonId: 14 }],
      character: {
        region: "EU",
        realmSlug: identity.realmSlug,
        name: identity.name,
      },
    },
    runs: rating != null && rating > 0 ? [{ keyLevel: 12 }] : [],
  });
}

function achievementsDto() {
  return providerResult({
    character: {
      region: "EU",
      realmSlug: identity.realmSlug,
      name: identity.name,
    },
    achievements: [],
  });
}

function cutoffs(partial: Partial<RaiderIoSeasonCutoffs> = {}): RaiderIoSeasonCutoffs {
  return {
    region: "EU",
    seasonSlug: "season-tww-3",
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
    ...partial,
  };
}

describe("Agent 02 — explicit Blizzard-id mismatch never wins by dates", () => {
  const startX = "2025-07-01T00:00:00.000Z";

  it("rejects RIO main season with wrong blizzardSeasonId despite identical start", () => {
    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse(startX),
        endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
        blizzardSeasonId: 14,
      },
      [
        {
          slug: "season-wrong",
          name: "wrong",
          startsAt: startX,
          endsAt: "2026-01-01T00:00:00.000Z",
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 99,
          dungeonSlugs: [],
        },
      ],
    );
    expect(matched.ok).toBe(false);
    if (matched.ok) return;
    expect(matched.reason).toBe("RIO_DATE_MATCH_EXPLICIT_BLIZZARD_ID_MISMATCH");
  });

  it("allows date fallback when RIO blizzardSeasonId is null", () => {
    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse(startX),
        endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
        blizzardSeasonId: 14,
      },
      [
        {
          slug: "season-tww-3",
          name: "tww3",
          startsAt: startX,
          endsAt: "2026-01-01T00:00:00.000Z",
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: null,
          dungeonSlugs: [],
        },
        {
          slug: "season-wrong",
          name: "wrong",
          startsAt: startX,
          endsAt: "2026-01-01T00:00:00.000Z",
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 99,
          dungeonSlugs: [],
        },
      ],
    );
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    expect(matched.season.slug).toBe("season-tww-3");
  });

  it("date-disambiguates only among exact-id candidates when two share Blizzard 14", () => {
    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse(startX),
        endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
        blizzardSeasonId: 14,
      },
      [
        {
          slug: "season-far",
          name: "far",
          startsAt: "2024-01-01T00:00:00.000Z",
          endsAt: null,
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 14,
          dungeonSlugs: [],
        },
        {
          slug: "season-near",
          name: "near",
          startsAt: startX,
          endsAt: "2026-01-01T00:00:00.000Z",
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 14,
          dungeonSlugs: [],
        },
        {
          slug: "season-wrong",
          name: "wrong",
          startsAt: startX,
          endsAt: "2026-01-01T00:00:00.000Z",
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 99,
          dungeonSlugs: [],
        },
      ],
    );
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    expect(matched.season.slug).toBe("season-near");
  });

  it("bootstrap does not write season-wrong as providerSeasonId for Blizzard 14", async () => {
    type SeasonRow = {
      id: string;
      regionId: string;
      slug: string;
      name: string;
      blizzardSeasonId: number | null;
      providerSeasonId: string | null;
      startsAt: Date | null;
      endsAt: Date | null;
      isCurrent: boolean;
      metadata: Record<string, unknown>;
      region?: { id: string; code: string };
    };
    const seasons: SeasonRow[] = [
      {
        id: "cur",
        regionId: REGION_ID,
        slug: "blizzard-season-15",
        name: "15",
        blizzardSeasonId: 15,
        providerSeasonId: null,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: null,
        isCurrent: true,
        metadata: {},
        region: { id: REGION_ID, code: "EU" },
      },
      {
        id: "prev",
        regionId: REGION_ID,
        slug: "blizzard-season-14",
        name: "14",
        blizzardSeasonId: 14,
        providerSeasonId: null,
        startsAt: new Date(startX),
        endsAt: new Date("2026-01-01T00:00:00.000Z"),
        isCurrent: false,
        metadata: {},
        region: { id: REGION_ID, code: "EU" },
      },
    ];
    const prisma = {
      getSeasons: () => seasons,
      season: {
        findFirst: vi.fn(async (args: { where: Record<string, unknown>; select?: Record<string, boolean>; include?: Record<string, boolean> }) => {
          const row = seasons.find((s) => {
            if (args.where.regionId != null && s.regionId !== args.where.regionId) return false;
            if (args.where.slug != null && s.slug !== args.where.slug) return false;
            if (args.where.isCurrent === true && !s.isCurrent) return false;
            return true;
          });
          if (!row) return null;
          if (args.include?.region) return { ...row, region: row.region };
          if (args.select) {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(args.select)) out[k] = (row as Record<string, unknown>)[k];
            return out;
          }
          return { ...row };
        }),
        findUnique: vi.fn(async (args: { where: { id: string }; select?: Record<string, boolean>; include?: Record<string, boolean> }) => {
          const row = seasons.find((s) => s.id === args.where.id);
          if (!row) return null;
          if (args.include?.region) return { ...row, region: row.region };
          if (args.select) {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(args.select)) out[k] = (row as Record<string, unknown>)[k];
            return out;
          }
          return { ...row };
        }),
        create: vi.fn(async () => ({ id: "new" })),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const idx = seasons.findIndex((s) => s.id === args.where.id);
          if (idx < 0) throw new Error("missing");
          seasons[idx] = {
            ...seasons[idx]!,
            ...(args.data.providerSeasonId !== undefined
              ? { providerSeasonId: args.data.providerSeasonId as string | null }
              : {}),
            ...(args.data.metadata !== undefined
              ? { metadata: args.data.metadata as Record<string, unknown> }
              : {}),
          };
          return seasons[idx];
        }),
      },
    };

    const result = await bootstrapExperienceSeasonMetadata({
      prisma: prisma as never,
      regions: [{ code: "EU", id: REGION_ID }],
      blizzard: {
        getMythicKeystoneSeasonIndex: vi.fn(async () =>
          providerResult([
            {
              blizzardSeasonId: 14,
              slug: "s14",
              name: "14",
              startTimestamp: Date.parse(startX),
              endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
            },
            {
              blizzardSeasonId: 15,
              slug: "s15",
              name: "15",
              startTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
              endTimestamp: null,
            },
          ]),
        ),
        getMythicKeystoneSeason: vi.fn(async () => {
          throw new Error("unused");
        }),
      },
      raiderIo: {
        getStaticData: vi.fn(async () =>
          providerResult({
            expansionId: 10,
            seasons: [
              {
                slug: "season-wrong",
                name: "wrong",
                startsAt: startX,
                endsAt: "2026-01-01T00:00:00.000Z",
                isCurrent: false,
                isMainSeason: true,
                blizzardSeasonId: 99,
                dungeonSlugs: [],
              },
              {
                slug: "season-mn-1",
                name: "mn1",
                startsAt: "2026-01-01T00:00:00.000Z",
                endsAt: null,
                isCurrent: true,
                isMainSeason: true,
                blizzardSeasonId: 15,
                dungeonSlugs: [],
              },
            ],
            dungeons: [],
            attribution: {
              provider: "raiderio",
              displayText: "x",
              homepageUrl: "https://raider.io",
              profileUrl: null,
              sourceUrl: null,
            },
          }),
        ),
        getSeasonCutoffs: vi.fn(async () =>
          providerResult(cutoffs({ seasonSlug: "season-wrong", isRemappedSeason: true })),
        ),
      },
      persistProviderResult: vi.fn(async () => "p"),
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(seasons.find((s) => s.id === "prev")!.providerSeasonId).not.toBe("season-wrong");
    expect(seasons.find((s) => s.id === "prev")!.providerSeasonId).toBeNull();
    expect(result.regions[0]!.previousRaiderIoSlug).toBeNull();
    expect(result.seasonCutoffsCalls).toBe(0);
    expect(
      result.regions[0]!.reasons.some((r) =>
        r.includes("RIO_DATE_MATCH_EXPLICIT_BLIZZARD_ID_MISMATCH"),
      ),
    ).toBe(true);
  });

  it("phase-1 does not call exact historical RIO when previous RIO slug was never bound", async () => {
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
        startsAt: new Date(startX),
        endsAt: new Date("2026-01-01T00:00:00.000Z"),
        metadata: {},
        providerSeasonId: null,
      },
    ];
    const getCharacterExactSeasonHistoricalRating = vi.fn(async () =>
      providerResult({
        seasonSlug: "season-wrong",
        seasonFound: true,
        scoreAll: 2900,
        activityProof: "UNKNOWN" as const,
      }),
    );
    const result = await buildExperiencePhase1Result({
      prisma: createPrismaFake(rows as never) as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw Object.assign(new Error("not found"), {
            statusCode: 404,
            code: "NOT_FOUND",
          });
        }),
        getCharacterAchievements: vi.fn(async () => achievementsDto()),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: createInMemoryExperienceEvidenceStore(),
      canonicalPreviousBinding: {
        ok: true,
        season: {
          id: PREV_ID,
          regionId: REGION_ID,
          slug: "blizzard-season-14",
          blizzardSeasonId: 14,
          startsAt: new Date(startX),
          endsAt: new Date("2026-01-01T00:00:00.000Z"),
          providerSeasonId: null,
        },
        boundRaiderIoSlug: null,
      },
      boundPreviousRaiderIoSlug: null,
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });
    expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(result.raiderIoHistoricalRatingCalls).toBe(0);
    expect(result.experience.available).toBe(false);
  });
});

describe("Agent 02 — stale providerSeasonId revalidation", () => {
  const startX = "2025-07-01T00:00:00.000Z";

  it("PROVEN_INCOMPATIBLE when persisted slug has explicit wrong Blizzard id", () => {
    const result = revalidatePersistedRaiderIoSeasonSlug({
      persistedSlug: "season-wrong",
      targetBlizzardSeasonId: 14,
      staticDataAvailable: true,
      seasons: [
        {
          slug: "season-wrong",
          name: "wrong",
          startsAt: startX,
          endsAt: null,
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 99,
          dungeonSlugs: [],
        },
      ],
    });
    expect(result).toEqual({
      status: "PROVEN_INCOMPATIBLE",
      reason: "PERSISTED_RIO_SLUG_EXPLICIT_BLIZZARD_ID_MISMATCH",
    });
  });

  it("COULD_NOT_REVALIDATE when RIO static unavailable", () => {
    const result = revalidatePersistedRaiderIoSeasonSlug({
      persistedSlug: "season-tww-3",
      targetBlizzardSeasonId: 14,
      staticDataAvailable: false,
      seasons: [],
    });
    expect(result.status).toBe("COULD_NOT_REVALIDATE");
  });

  it("exact-ID + absurd chronology → PROVEN_INCOMPATIBLE", () => {
    const absurdStart = new Date(
      Date.parse(startX) + RIO_BLIZZARD_EXACT_ID_CHRONOLOGY_MAX_MS + 86400000,
    ).toISOString();
    const result = revalidatePersistedRaiderIoSeasonSlug({
      persistedSlug: "season-tww-3",
      targetBlizzardSeasonId: 14,
      targetBlizzardStartsAtMs: Date.parse(startX),
      targetBlizzardEndsAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
      staticDataAvailable: true,
      seasons: [
        {
          slug: "season-tww-3",
          name: "tww3",
          startsAt: absurdStart,
          endsAt: null,
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 14,
          dungeonSlugs: [],
        },
      ],
    });
    expect(result).toEqual({
      status: "PROVEN_INCOMPATIBLE",
      reason: "RIO_DATE_MATCH_EXACT_ID_CHRONOLOGY_ABSURD",
    });
  });

  it("exact-ID + compatible chronology → COMPATIBLE", () => {
    const result = revalidatePersistedRaiderIoSeasonSlug({
      persistedSlug: "season-tww-3",
      targetBlizzardSeasonId: 14,
      targetBlizzardStartsAtMs: Date.parse(startX),
      targetBlizzardEndsAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
      staticDataAvailable: true,
      seasons: [
        {
          slug: "season-tww-3",
          name: "tww3",
          startsAt: startX,
          endsAt: "2026-01-01T00:00:00.000Z",
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 14,
          dungeonSlugs: [],
        },
      ],
    });
    expect(result.status).toBe("COMPATIBLE");
  });

  it("exact-ID + missing dates → COMPATIBLE (ID sufficient)", () => {
    const result = revalidatePersistedRaiderIoSeasonSlug({
      persistedSlug: "season-tww-3",
      targetBlizzardSeasonId: 14,
      targetBlizzardStartsAtMs: null,
      targetBlizzardEndsAtMs: null,
      staticDataAvailable: true,
      seasons: [
        {
          slug: "season-tww-3",
          name: "tww3",
          startsAt: null,
          endsAt: null,
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 14,
          dungeonSlugs: [],
        },
      ],
    });
    expect(result.status).toBe("COMPATIBLE");
  });

  it("no-ID slug + compatible dates → COMPATIBLE", () => {
    const result = revalidatePersistedRaiderIoSeasonSlug({
      persistedSlug: "season-tww-3",
      targetBlizzardSeasonId: 14,
      targetBlizzardStartsAtMs: Date.parse(startX),
      targetBlizzardEndsAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
      staticDataAvailable: true,
      seasons: [
        {
          slug: "season-tww-3",
          name: "tww3",
          startsAt: startX,
          endsAt: "2026-01-01T00:00:00.000Z",
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: null,
          dungeonSlugs: [],
        },
      ],
    });
    expect(result.status).toBe("COMPATIBLE");
  });

  it("no-ID slug + dates proving mismatch → PROVEN_INCOMPATIBLE", () => {
    const result = revalidatePersistedRaiderIoSeasonSlug({
      persistedSlug: "season-tww-3",
      targetBlizzardSeasonId: 14,
      targetBlizzardStartsAtMs: Date.parse(startX),
      targetBlizzardEndsAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
      staticDataAvailable: true,
      seasons: [
        {
          slug: "season-tww-3",
          name: "tww3",
          startsAt: "2020-01-01T00:00:00.000Z",
          endsAt: null,
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: null,
          dungeonSlugs: [],
        },
      ],
    });
    expect(result.status).toBe("PROVEN_INCOMPATIBLE");
    if (result.status !== "PROVEN_INCOMPATIBLE") return;
    expect(result.reason).toContain("PERSISTED_RIO_SLUG_DATE_MISMATCH");
  });

  it("no-ID slug + insufficient dates → COULD_NOT_REVALIDATE", () => {
    const result = revalidatePersistedRaiderIoSeasonSlug({
      persistedSlug: "season-tww-3",
      targetBlizzardSeasonId: 14,
      targetBlizzardStartsAtMs: Date.parse(startX),
      targetBlizzardEndsAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
      staticDataAvailable: true,
      seasons: [
        {
          slug: "season-tww-3",
          name: "tww3",
          startsAt: null,
          endsAt: null,
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: null,
          dungeonSlugs: [],
        },
      ],
    });
    expect(result.status).toBe("COULD_NOT_REVALIDATE");
  });

  it("bootstrap clears exact-ID absurd chronology LKG and skips cutoff sync", async () => {
    const absurdStart = new Date(
      Date.parse(startX) + RIO_BLIZZARD_EXACT_ID_CHRONOLOGY_MAX_MS + 86400000,
    ).toISOString();
    const { prisma, seasons } = makeBootstrapPrisma("season-tww-3");
    // Fresh match fails (no compatible RIO for 14); legacy slug has matching id but absurd dates.
    const getSeasonCutoffs = vi.fn(async () => providerResult(cutoffs()));
    const result = await bootstrapExperienceSeasonMetadata({
      prisma: prisma as never,
      regions: [{ code: "EU", id: REGION_ID }],
      blizzard: {
        getMythicKeystoneSeasonIndex: vi.fn(async () =>
          providerResult([
            {
              blizzardSeasonId: 14,
              slug: "s14",
              name: "14",
              startTimestamp: Date.parse(startX),
              endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
            },
            {
              blizzardSeasonId: 15,
              slug: "s15",
              name: "15",
              startTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
              endTimestamp: null,
            },
          ]),
        ),
        getMythicKeystoneSeason: vi.fn(async () => {
          throw new Error("unused");
        }),
      },
      raiderIo: {
        getStaticData: vi.fn(async () =>
          providerResult({
            expansionId: 10,
            seasons: [
              {
                slug: "season-tww-3",
                name: "tww3",
                startsAt: absurdStart,
                endsAt: null,
                isCurrent: false,
                isMainSeason: true,
                blizzardSeasonId: 14,
                dungeonSlugs: [],
              },
              {
                slug: "season-mn-1",
                name: "mn1",
                startsAt: "2026-01-01T00:00:00.000Z",
                endsAt: null,
                isCurrent: true,
                isMainSeason: true,
                blizzardSeasonId: 15,
                dungeonSlugs: [],
              },
            ],
            dungeons: [],
            attribution: {
              provider: "raiderio",
              displayText: "x",
              homepageUrl: "https://raider.io",
              profileUrl: null,
              sourceUrl: null,
            },
          }),
        ),
        getSeasonCutoffs,
      },
      persistProviderResult: vi.fn(async () => "p"),
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(seasons.find((s) => s.id === "prev")!.providerSeasonId).toBeNull();
    expect(result.seasonCutoffsCalls).toBe(0);
    expect(getSeasonCutoffs).not.toHaveBeenCalled();
    expect(
      result.regions[0]!.reasons.some((r) =>
        r.includes("RIO_DATE_MATCH_EXACT_ID_CHRONOLOGY_ABSURD"),
      ),
    ).toBe(true);
  });

  it("bootstrap retains no-ID LKG when dates are insufficient to revalidate", async () => {
    const { prisma, seasons } = makeBootstrapPrisma("season-tww-3");
    const getSeasonCutoffs = vi.fn(async () => providerResult(cutoffs()));
    const result = await bootstrapExperienceSeasonMetadata({
      prisma: prisma as never,
      regions: [{ code: "EU", id: REGION_ID }],
      blizzard: {
        getMythicKeystoneSeasonIndex: vi.fn(async () =>
          providerResult([
            {
              blizzardSeasonId: 14,
              slug: "s14",
              name: "14",
              startTimestamp: Date.parse(startX),
              endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
            },
            {
              blizzardSeasonId: 15,
              slug: "s15",
              name: "15",
              startTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
              endTimestamp: null,
            },
          ]),
        ),
        getMythicKeystoneSeason: vi.fn(async () => {
          throw new Error("unused");
        }),
      },
      raiderIo: {
        getStaticData: vi.fn(async () =>
          providerResult({
            expansionId: 10,
            seasons: [
              {
                slug: "season-tww-3",
                name: "tww3",
                startsAt: null,
                endsAt: null,
                isCurrent: false,
                isMainSeason: true,
                blizzardSeasonId: null,
                dungeonSlugs: [],
              },
              {
                slug: "season-mn-1",
                name: "mn1",
                startsAt: "2026-01-01T00:00:00.000Z",
                endsAt: null,
                isCurrent: true,
                isMainSeason: true,
                blizzardSeasonId: 15,
                dungeonSlugs: [],
              },
            ],
            dungeons: [],
            attribution: {
              provider: "raiderio",
              displayText: "x",
              homepageUrl: "https://raider.io",
              profileUrl: null,
              sourceUrl: null,
            },
          }),
        ),
        getSeasonCutoffs,
      },
      persistProviderResult: vi.fn(async () => "p"),
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(seasons.find((s) => s.id === "prev")!.providerSeasonId).toBe("season-tww-3");
    expect(result.seasonCutoffsCalls).toBe(1);
    expect(getSeasonCutoffs).toHaveBeenCalled();
    expect(
      result.regions[0]!.reasons.some((r) =>
        r.includes("PERSISTED_RIO_SLUG_COULD_NOT_REVALIDATE"),
      ),
    ).toBe(true);
  });

  function makeBootstrapPrisma(prevProviderSeasonId: string | null) {
    type SeasonRow = {
      id: string;
      regionId: string;
      slug: string;
      name: string;
      blizzardSeasonId: number | null;
      providerSeasonId: string | null;
      startsAt: Date | null;
      endsAt: Date | null;
      isCurrent: boolean;
      metadata: Record<string, unknown>;
      region?: { id: string; code: string };
    };
    const seasons: SeasonRow[] = [
      {
        id: "cur",
        regionId: REGION_ID,
        slug: "blizzard-season-15",
        name: "15",
        blizzardSeasonId: 15,
        providerSeasonId: null,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: null,
        isCurrent: true,
        metadata: {},
        region: { id: REGION_ID, code: "EU" },
      },
      {
        id: "prev",
        regionId: REGION_ID,
        slug: "blizzard-season-14",
        name: "14",
        blizzardSeasonId: 14,
        providerSeasonId: prevProviderSeasonId,
        startsAt: new Date(startX),
        endsAt: new Date("2026-01-01T00:00:00.000Z"),
        isCurrent: false,
        metadata: {},
        region: { id: REGION_ID, code: "EU" },
      },
    ];
    const prisma = {
      getSeasons: () => seasons,
      season: {
        findFirst: vi.fn(async (args: {
          where: Record<string, unknown>;
          select?: Record<string, boolean>;
          include?: Record<string, boolean>;
        }) => {
          const row = seasons.find((s) => {
            if (args.where.regionId != null && s.regionId !== args.where.regionId)
              return false;
            if (args.where.slug != null && s.slug !== args.where.slug) return false;
            if (args.where.isCurrent === true && !s.isCurrent) return false;
            return true;
          });
          if (!row) return null;
          if (args.include?.region) return { ...row, region: row.region };
          if (args.select) {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(args.select))
              out[k] = (row as Record<string, unknown>)[k];
            return out;
          }
          return { ...row };
        }),
        findUnique: vi.fn(async (args: {
          where: { id: string };
          select?: Record<string, boolean>;
          include?: Record<string, boolean>;
        }) => {
          const row = seasons.find((s) => s.id === args.where.id);
          if (!row) return null;
          if (args.include?.region) return { ...row, region: row.region };
          if (args.select) {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(args.select))
              out[k] = (row as Record<string, unknown>)[k];
            return out;
          }
          return { ...row };
        }),
        create: vi.fn(async () => ({ id: "new" })),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const idx = seasons.findIndex((s) => s.id === args.where.id);
          if (idx < 0) throw new Error("missing");
          seasons[idx] = {
            ...seasons[idx]!,
            ...(args.data.providerSeasonId !== undefined
              ? { providerSeasonId: args.data.providerSeasonId as string | null }
              : {}),
            ...(args.data.metadata !== undefined
              ? { metadata: args.data.metadata as Record<string, unknown> }
              : {}),
          };
          return seasons[idx];
        }),
      },
    };
    return { prisma, seasons };
  }

  it("clears stale season-wrong and skips cutoff sync; later valid season-14 binds", async () => {
    const { prisma, seasons } = makeBootstrapPrisma("season-wrong");
    const blizzardIndex = vi.fn(async () =>
      providerResult([
        {
          blizzardSeasonId: 14,
          slug: "s14",
          name: "14",
          startTimestamp: Date.parse(startX),
          endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
        },
        {
          blizzardSeasonId: 15,
          slug: "s15",
          name: "15",
          startTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
          endTimestamp: null,
        },
      ]),
    );
    const getSeasonCutoffs = vi.fn(async () =>
      providerResult(cutoffs({ seasonSlug: "season-wrong" })),
    );

    const first = await bootstrapExperienceSeasonMetadata({
      prisma: prisma as never,
      regions: [{ code: "EU", id: REGION_ID }],
      blizzard: {
        getMythicKeystoneSeasonIndex: blizzardIndex,
        getMythicKeystoneSeason: vi.fn(async () => {
          throw new Error("unused");
        }),
      },
      raiderIo: {
        getStaticData: vi.fn(async () =>
          providerResult({
            expansionId: 10,
            seasons: [
              {
                slug: "season-wrong",
                name: "wrong",
                startsAt: startX,
                endsAt: "2026-01-01T00:00:00.000Z",
                isCurrent: false,
                isMainSeason: true,
                blizzardSeasonId: 99,
                dungeonSlugs: [],
              },
              {
                slug: "season-mn-1",
                name: "mn1",
                startsAt: "2026-01-01T00:00:00.000Z",
                endsAt: null,
                isCurrent: true,
                isMainSeason: true,
                blizzardSeasonId: 15,
                dungeonSlugs: [],
              },
            ],
            dungeons: [],
            attribution: {
              provider: "raiderio",
              displayText: "x",
              homepageUrl: "https://raider.io",
              profileUrl: null,
              sourceUrl: null,
            },
          }),
        ),
        getSeasonCutoffs,
      },
      persistProviderResult: vi.fn(async () => "p"),
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(seasons.find((s) => s.id === "prev")!.providerSeasonId).toBeNull();
    expect(first.regions[0]!.previousRaiderIoSlug).toBeNull();
    expect(first.seasonCutoffsCalls).toBe(0);
    expect(getSeasonCutoffs).not.toHaveBeenCalled();
    expect(
      first.regions[0]!.reasons.some((r) =>
        r.includes("PERSISTED_RIO_SLUG_PROVEN_INCOMPATIBLE"),
      ),
    ).toBe(true);

    // Second bootstrap with a valid Blizzard-14 RIO season replaces the binding.
    const second = await bootstrapExperienceSeasonMetadata({
      prisma: prisma as never,
      regions: [{ code: "EU", id: REGION_ID }],
      blizzard: {
        getMythicKeystoneSeasonIndex: blizzardIndex,
        getMythicKeystoneSeason: vi.fn(async () => {
          throw new Error("unused");
        }),
      },
      raiderIo: {
        getStaticData: vi.fn(async () =>
          providerResult({
            expansionId: 10,
            seasons: [
              {
                slug: "season-tww-3",
                name: "tww3",
                startsAt: startX,
                endsAt: "2026-01-01T00:00:00.000Z",
                isCurrent: false,
                isMainSeason: true,
                blizzardSeasonId: 14,
                dungeonSlugs: [],
              },
              {
                slug: "season-mn-1",
                name: "mn1",
                startsAt: "2026-01-01T00:00:00.000Z",
                endsAt: null,
                isCurrent: true,
                isMainSeason: true,
                blizzardSeasonId: 15,
                dungeonSlugs: [],
              },
            ],
            dungeons: [],
            attribution: {
              provider: "raiderio",
              displayText: "x",
              homepageUrl: "https://raider.io",
              profileUrl: null,
              sourceUrl: null,
            },
          }),
        ),
        getSeasonCutoffs: vi.fn(async () => providerResult(cutoffs())),
      },
      persistProviderResult: vi.fn(async () => "p"),
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(seasons.find((s) => s.id === "prev")!.providerSeasonId).toBe("season-tww-3");
    expect(second.regions[0]!.previousRaiderIoSlug).toBe("season-tww-3");
    expect(second.seasonCutoffsCalls).toBe(1);
  });

  it("retains valid providerSeasonId when RIO static cannot be contacted", async () => {
    const { prisma, seasons } = makeBootstrapPrisma("season-tww-3");
    const result = await bootstrapExperienceSeasonMetadata({
      prisma: prisma as never,
      regions: [{ code: "EU", id: REGION_ID }],
      blizzard: {
        getMythicKeystoneSeasonIndex: vi.fn(async () =>
          providerResult([
            {
              blizzardSeasonId: 14,
              slug: "s14",
              name: "14",
              startTimestamp: Date.parse(startX),
              endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
            },
            {
              blizzardSeasonId: 15,
              slug: "s15",
              name: "15",
              startTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
              endTimestamp: null,
            },
          ]),
        ),
        getMythicKeystoneSeason: vi.fn(async () => {
          throw new Error("unused");
        }),
      },
      raiderIo: {
        getStaticData: vi.fn(async () => {
          throw new Error("rio static down");
        }),
        getSeasonCutoffs: vi.fn(async () => providerResult(cutoffs())),
      },
      persistProviderResult: vi.fn(async () => "p"),
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(seasons.find((s) => s.id === "prev")!.providerSeasonId).toBe("season-tww-3");
    expect(result.seasonCutoffsCalls).toBe(1);
    expect(
      result.regions[0]!.reasons.some((r) => r.includes("RIO_STATIC_DATA_FAILED")),
    ).toBe(true);
  });
});

describe("Agent 02 — unique exact-id chronology sanity", () => {
  const startX = "2025-07-01T00:00:00.000Z";

  it("unique exact id + normal dates → accept", () => {
    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse(startX),
        endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
        blizzardSeasonId: 14,
      },
      [
        {
          slug: "season-tww-3",
          name: "tww3",
          startsAt: startX,
          endsAt: "2026-01-01T00:00:00.000Z",
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 14,
          dungeonSlugs: [],
        },
      ],
    );
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    expect(matched.season.slug).toBe("season-tww-3");
  });

  it("unique exact id + missing dates → accept", () => {
    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: null,
        endTimestamp: null,
        blizzardSeasonId: 14,
      },
      [
        {
          slug: "season-tww-3",
          name: "tww3",
          startsAt: null,
          endsAt: null,
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 14,
          dungeonSlugs: [],
        },
      ],
    );
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    expect(matched.season.slug).toBe("season-tww-3");
  });

  it("unique exact id + absurd chronology → reject", () => {
    const absurdStartMs =
      Date.parse(startX) + RIO_BLIZZARD_EXACT_ID_CHRONOLOGY_MAX_MS + 24 * 60 * 60 * 1000;
    const matched = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse(startX),
        endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
        blizzardSeasonId: 14,
      },
      [
        {
          slug: "season-tww-3",
          name: "tww3",
          startsAt: new Date(absurdStartMs).toISOString(),
          endsAt: null,
          isCurrent: false,
          isMainSeason: true,
          blizzardSeasonId: 14,
          dungeonSlugs: [],
        },
      ],
    );
    expect(matched.ok).toBe(false);
    if (matched.ok) return;
    expect(matched.reason).toBe("RIO_DATE_MATCH_EXACT_ID_CHRONOLOGY_ABSURD");
  });
});

describe("Agent 02 F3 — canonical previous binding resists fixture pollution", () => {
  it("selects authority previous row and its RIO slug, not later fixture", () => {
    const rows = seasonRowsWithFixturePollution();
    const current = rows[0]!;
    const binding = resolveCanonicalPreviousSeasonBinding(current, rows);
    expect(binding.ok).toBe(true);
    if (!binding.ok) return;
    expect(binding.season.id).toBe(PREV_ID);
    expect(binding.boundRaiderIoSlug).toBe("season-tww-3");
    expect(binding.boundRaiderIoSlug).not.toBe("season-fixture-fake-rio");
  });

  it("phase-1 RIO exact-season call uses canonical slug under fixture pollution", async () => {
    const rows = seasonRowsWithFixturePollution();
    const prisma = createPrismaFake(rows);
    const getMythicKeystoneSeasonProfile = vi.fn(async () => {
      throw Object.assign(new Error("not found"), {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    });
    const getCharacterExactSeasonHistoricalRating = vi.fn(async () =>
      providerResult({
        seasonSlug: "season-tww-3",
        seasonFound: true,
        scoreAll: 2900,
        activityProof: "UNKNOWN" as const,
      }),
    );

    const result = await buildExperiencePhase1Result({
      prisma: prisma as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile,
        getCharacterAchievements: vi.fn(async () => achievementsDto()),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: createInMemoryExperienceEvidenceStore(),
      // Poisoned caller slug must not win over the selected Season.providerSeasonId.
      boundPreviousRaiderIoSlug: "season-fixture-fake-rio",
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });

    expect(getCharacterExactSeasonHistoricalRating).toHaveBeenCalledWith(
      identity,
      "season-tww-3",
      expect.anything(),
    );
    expect(result.diagnostics.ratingSource).toBe("RAIDERIO_FALLBACK");
    expect(result.experience.available).toBe(true);
  });
});

describe("Agent 02 F4 — persisted evidence binding compatibility", () => {
  function makeValidRow(overrides: Partial<CharacterExperienceEvidenceDTO> = {}) {
    const persist = buildPreviousSeasonRatingPersistInput({
      characterId: CHAR_ID,
      evidence: {
        state: "HAS_VALUE",
        rating: 2900,
        ratingSource: "BLIZZARD",
        internalSeasonId: PREV_ID,
        seasonSlug: "blizzard-season-14",
        blizzardSeasonId: 14,
        fetchedAt: "2026-08-08T00:00:01.000Z",
        providerPayloadId: "p",
      },
      raiderIoSeasonSlug: "season-tww-3",
    })!;
    const now = new Date();
    return {
      id: "row-1",
      characterId: persist.characterId,
      seasonId: persist.seasonId,
      blizzardSeasonId: persist.blizzardSeasonId ?? null,
      raiderIoSeasonSlug: persist.raiderIoSeasonSlug ?? null,
      evidenceKind: persist.evidenceKind,
      compatibilityVersion: persist.compatibilityVersion,
      state: persist.state,
      source: persist.source,
      payload: persist.payload,
      sourcePayloadId: persist.sourcePayloadId ?? null,
      sourceRequestFingerprint: null,
      contentHash: persist.contentHash ?? null,
      fetchedAt: persist.fetchedAt,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } satisfies CharacterExperienceEvidenceDTO;
  }

  const expected = {
    characterId: CHAR_ID,
    seasonId: PREV_ID,
    blizzardSeasonId: 14,
    raiderIoSeasonSlug: "season-tww-3",
  };

  it("accepts compatible row for provider-free replay", () => {
    const row = makeValidRow();
    const evidence = ratingEvidenceFromPersistedRow(row, expected);
    expect(evidence?.state).toBe("HAS_VALUE");
  });

  it("rejects mismatched Blizzard season id", () => {
    const row = makeValidRow({ blizzardSeasonId: 99 });
    expect(ratingEvidenceFromPersistedRow(row, expected)).toBeNull();
  });

  it("rejects mismatched RIO slug", () => {
    const row = makeValidRow({ raiderIoSeasonSlug: "season-wrong" });
    expect(ratingEvidenceFromPersistedRow(row, expected)).toBeNull();
  });

  it("rejects bad content hash", () => {
    const row = makeValidRow({ contentHash: "deadbeef".repeat(8) });
    expect(ratingEvidenceFromPersistedRow(row, expected)).toBeNull();
  });

  it("incompatible cache with providers allowed → reacquire", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const bad = makeValidRow({ blizzardSeasonId: 99 });
    // Seed incompatible row under the identity key.
    await store.upsertImmutable({
      characterId: bad.characterId,
      seasonId: bad.seasonId,
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
      compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
      blizzardSeasonId: 99,
      raiderIoSeasonSlug: "season-tww-3",
      state: EXPERIENCE_EVIDENCE_STATE.HAS_VALUE,
      source: EXPERIENCE_EVIDENCE_SOURCE.BLIZZARD,
      payload: bad.payload,
      contentHash: hashExperienceEvidencePayload(bad.payload),
      fetchedAt: bad.fetchedAt,
    });

    const getMythicKeystoneSeasonProfile = vi.fn(async () => seasonProfile(3100));
    const result = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonRowsWithFixturePollution()) as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile,
        getCharacterAchievements: vi.fn(async () => achievementsDto()),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
    });

    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(result.previousSeasonRatingFromCache).toBe(false);
    expect(result.diagnostics.ratingSource).toBe("BLIZZARD");
  });

  it("incompatible cache with providers forbidden → unavailable", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const bad = makeValidRow({ raiderIoSeasonSlug: "season-wrong" });
    await store.upsertImmutable({
      characterId: bad.characterId,
      seasonId: bad.seasonId,
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
      compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
      blizzardSeasonId: 14,
      raiderIoSeasonSlug: "season-wrong",
      state: EXPERIENCE_EVIDENCE_STATE.HAS_VALUE,
      source: EXPERIENCE_EVIDENCE_SOURCE.BLIZZARD,
      payload: {
        ...(bad.payload as object),
        raiderIoSeasonSlug: "season-wrong",
      },
      contentHash: null,
      fetchedAt: bad.fetchedAt,
    });

    const result = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonRowsWithFixturePollution()) as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw new Error("should not call");
        }),
        getCharacterAchievements: vi.fn(async () => {
          throw new Error("should not call");
        }),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: false,
      evidenceStore: store,
    });

    expect(result.previousSeasonRatingFromCache).toBe(false);
    expect(result.experience.available).toBe(false);
  });

  it("BLIZZARD legacy row with null RIO slug remains compatible", () => {
    const persist = buildPreviousSeasonRatingPersistInput({
      characterId: CHAR_ID,
      evidence: {
        state: "HAS_VALUE",
        rating: 2900,
        ratingSource: "BLIZZARD",
        internalSeasonId: PREV_ID,
        seasonSlug: "blizzard-season-14",
        blizzardSeasonId: 14,
        fetchedAt: "2026-08-08T00:00:01.000Z",
        providerPayloadId: "p",
      },
      raiderIoSeasonSlug: null,
    })!;
    const now = new Date();
    const row: CharacterExperienceEvidenceDTO = {
      id: "legacy-blizz",
      characterId: persist.characterId,
      seasonId: persist.seasonId,
      blizzardSeasonId: 14,
      raiderIoSeasonSlug: null,
      evidenceKind: persist.evidenceKind,
      compatibilityVersion: persist.compatibilityVersion,
      state: persist.state,
      source: EXPERIENCE_EVIDENCE_SOURCE.BLIZZARD,
      payload: { ...(persist.payload as object), raiderIoSeasonSlug: null },
      sourcePayloadId: null,
      sourceRequestFingerprint: null,
      contentHash: null,
      fetchedAt: persist.fetchedAt,
      createdAt: now,
      updatedAt: now,
    };
    expect(
      ratingEvidenceFromPersistedRow(row, {
        characterId: CHAR_ID,
        seasonId: PREV_ID,
        blizzardSeasonId: 14,
        raiderIoSeasonSlug: "season-tww-3",
      })?.state,
    ).toBe("HAS_VALUE");
  });

  it("RAIDERIO_FALLBACK with null RIO slug is rejected when binding has exact slug", () => {
    const now = new Date();
    const payload = {
      schemaVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
      state: "HAS_VALUE" as const,
      rating: 2900,
      ratingSource: "RAIDERIO_FALLBACK" as const,
      internalSeasonId: PREV_ID,
      seasonSlug: "blizzard-season-14",
      blizzardSeasonId: 14,
      raiderIoSeasonSlug: null,
    };
    const row: CharacterExperienceEvidenceDTO = {
      id: "rio-null",
      characterId: CHAR_ID,
      seasonId: PREV_ID,
      blizzardSeasonId: 14,
      raiderIoSeasonSlug: null,
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
      compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
      state: EXPERIENCE_EVIDENCE_STATE.HAS_VALUE,
      source: EXPERIENCE_EVIDENCE_SOURCE.RAIDERIO_FALLBACK,
      payload,
      sourcePayloadId: null,
      sourceRequestFingerprint: null,
      contentHash: null,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    expect(
      ratingEvidenceFromPersistedRow(row, {
        characterId: CHAR_ID,
        seasonId: PREV_ID,
        blizzardSeasonId: 14,
        raiderIoSeasonSlug: "season-tww-3",
      }),
    ).toBeNull();
  });

  it("RAIDERIO_FALLBACK with wrong slug is rejected", () => {
    const persist = buildPreviousSeasonRatingPersistInput({
      characterId: CHAR_ID,
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
      raiderIoSeasonSlug: "season-wrong",
    })!;
    const now = new Date();
    const row: CharacterExperienceEvidenceDTO = {
      id: "rio-wrong",
      characterId: persist.characterId,
      seasonId: persist.seasonId,
      blizzardSeasonId: 14,
      raiderIoSeasonSlug: "season-wrong",
      evidenceKind: persist.evidenceKind,
      compatibilityVersion: persist.compatibilityVersion,
      state: persist.state,
      source: EXPERIENCE_EVIDENCE_SOURCE.RAIDERIO_FALLBACK,
      payload: persist.payload,
      sourcePayloadId: null,
      sourceRequestFingerprint: null,
      contentHash: persist.contentHash ?? null,
      fetchedAt: persist.fetchedAt,
      createdAt: now,
      updatedAt: now,
    };
    expect(
      ratingEvidenceFromPersistedRow(row, {
        characterId: CHAR_ID,
        seasonId: PREV_ID,
        blizzardSeasonId: 14,
        raiderIoSeasonSlug: "season-tww-3",
      }),
    ).toBeNull();
  });

  it("correct exact RAIDERIO_FALLBACK replays provider-free", async () => {
    const store = createInMemoryExperienceEvidenceStore();
    const persist = buildPreviousSeasonRatingPersistInput({
      characterId: CHAR_ID,
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
      raiderIoSeasonSlug: "season-tww-3",
    })!;
    await store.upsertImmutable(persist);
    await store.upsertImmutable(
      buildEliteCutoffHistoryPersistInput({
        characterId: CHAR_ID,
        currentSeasonId: CURRENT_ID,
        confirmedCount: 0,
        confirmed: [],
        fetchedAt: "2026-08-08T00:00:01.000Z",
      }),
    );

    const getMythicKeystoneSeasonProfile = vi.fn(async () => {
      throw new Error("should not call");
    });
    const result = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonRowsWithFixturePollution()) as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile,
        getCharacterAchievements: vi.fn(async () => {
          throw new Error("should not call");
        }),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: false,
      evidenceStore: store,
    });
    expect(getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(result.previousSeasonRatingFromCache).toBe(true);
    expect(result.experience.available).toBe(true);
    expect(result.diagnostics.ratingSource).toBe("PERSISTED");
  });
});

describe("Agent 02 F2 — remapped cutoff equivalence proof", () => {
  const rioMain: RaiderIoStaticSeason = {
    slug: "season-tww-3",
    name: "TWW 3",
    startsAt: "2025-07-01T00:00:00.000Z",
    endsAt: "2026-01-01T00:00:00.000Z",
    isCurrent: false,
    isMainSeason: true,
    blizzardSeasonId: 14,
    dungeonSlugs: [],
  };

  it("proves exact Blizzard↔RIO identity", () => {
    const proof = proveExactRaiderIoCutoffSeasonEquivalence({
      boundRaiderIoSlug: "season-tww-3",
      blizzardSeasonId: 14,
      blizzardStartsAtMs: Date.parse("2025-07-01T00:00:00.000Z"),
      blizzardEndsAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
      rioSeason: rioMain,
    });
    expect(proof.proven).toBe(true);
  });

  it("rejects event / non-main season", () => {
    const proof = proveExactRaiderIoCutoffSeasonEquivalence({
      boundRaiderIoSlug: "season-tww-3",
      blizzardSeasonId: 14,
      blizzardStartsAtMs: Date.parse("2025-07-01T00:00:00.000Z"),
      blizzardEndsAtMs: null,
      rioSeason: { ...rioMain, isMainSeason: false },
    });
    expect(proof.proven).toBe(false);
    expect(proof.reasons).toContain("RIO_NOT_MAIN_SEASON");
  });

  it("rejects wrong Blizzard id", () => {
    const proof = proveExactRaiderIoCutoffSeasonEquivalence({
      boundRaiderIoSlug: "season-tww-3",
      blizzardSeasonId: 14,
      blizzardStartsAtMs: Date.parse("2025-07-01T00:00:00.000Z"),
      blizzardEndsAtMs: null,
      rioSeason: { ...rioMain, blizzardSeasonId: 99 },
    });
    expect(proof.proven).toBe(false);
    expect(proof.reasons).toContain("RIO_BLIZZARD_SEASON_ID_MISMATCH");
  });

  it("accepts remapped cutoffs only when proof is true", async () => {
    const prior = policyDoc("season-tww-3");
    const prisma = {
      season: {
        findUnique: vi.fn(async () => ({
          id: PREV_ID,
          regionId: REGION_ID,
          slug: "blizzard-season-14",
          isCurrent: false,
          metadata: { [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: prior },
          region: { id: REGION_ID, code: "EU" },
        })),
        update: vi.fn(async () => ({})),
      },
    };
    const remapped = cutoffs({ isRemappedSeason: true });

    const refused = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: PREV_ID,
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: { getSeasonCutoffs: vi.fn(async () => providerResult(remapped)) },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      exactTargetSeasonEquivalenceProven: false,
    });
    expect(refused).toMatchObject({
      status: "RETAINED_LAST_KNOWN_GOOD",
      reason: "REMAPPED_CUTOFFS_UNPROVEN_TARGET_SEASON_EQUIVALENCE",
    });

    const proof = proveExactRaiderIoCutoffSeasonEquivalence({
      boundRaiderIoSlug: "season-tww-3",
      blizzardSeasonId: 14,
      blizzardStartsAtMs: Date.parse("2025-07-01T00:00:00.000Z"),
      blizzardEndsAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
      rioSeason: rioMain,
    });
    const accepted = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: PREV_ID,
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: { getSeasonCutoffs: vi.fn(async () => providerResult(remapped)) },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      exactTargetSeasonEquivalenceProven: proof.proven,
    });
    expect(proof.proven).toBe(true);
    expect(accepted.status).toBe("UPDATED");
  });
});

describe("Agent 02 F5 — ensure retries after failed bootstrap", () => {
  beforeEach(() => {
    resetExperienceSeasonBindingEnsureStateForTests();
  });

  it("incomplete region result is not memoized; complete result may skip", () => {
    expect(
      isExperienceSeasonBindingEnsureComplete({
        region: "EU",
        status: "partial",
        hydratedSeasonCount: 0,
        currentSeasonId: "cur",
        previousSeasonId: null,
        currentRaiderIoSlug: null,
        previousRaiderIoSlug: null,
        policySync: null,
        reasons: ["POLICY_SYNC_PROVIDER_FAILURE"],
      }),
    ).toBe(false);

    expect(
      isExperienceSeasonBindingEnsureComplete({
        region: "EU",
        status: "ok",
        hydratedSeasonCount: 2,
        currentSeasonId: "cur",
        previousSeasonId: "prev",
        currentRaiderIoSlug: "season-mn-1",
        previousRaiderIoSlug: "season-tww-3",
        policySync: {
          status: "UPDATED",
          seasonId: "prev",
          policy: {} as never,
          policyContentHash: "h",
          sourcePayloadId: null,
        },
        reasons: [],
      }),
    ).toBe(true);
  });

  /**
   * Agent 03 acceptance — NO_USABLE_POLICY must remain retryable (not memoized).
   * Otherwise ensure never re-runs when population policy later becomes available.
   */
  it("scoring-stabilization: NO_USABLE_POLICY is not ensure-complete", () => {
    expect(
      isExperienceSeasonBindingEnsureComplete({
        region: "EU",
        status: "ok",
        hydratedSeasonCount: 2,
        currentSeasonId: "cur-midnight",
        previousSeasonId: "prev-tww",
        currentRaiderIoSlug: "season-midnight-1",
        previousRaiderIoSlug: "season-tww-3",
        policySync: {
          status: "NO_USABLE_POLICY",
          seasonId: "prev-tww",
          reason: "INSUFFICIENT_POLICY",
        },
        reasons: ["POLICY_SYNC_INSUFFICIENT"],
      }),
    ).toBe(false);
  });

  it("ensureExperienceSeasonBindingReady retries after failure then skips after success", async () => {
    const currentId = 15;
    type SeasonRow = {
      id: string;
      regionId: string;
      slug: string;
      name: string;
      blizzardSeasonId: number | null;
      providerSeasonId: string | null;
      startsAt: Date | null;
      endsAt: Date | null;
      isCurrent: boolean;
      metadata: Record<string, unknown>;
      region?: { id: string; code: string };
    };
    const seasons: SeasonRow[] = [
      {
        id: CURRENT_ID,
        regionId: REGION_ID,
        slug: "blizzard-season-15",
        name: "15",
        blizzardSeasonId: currentId,
        providerSeasonId: null,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: null,
        isCurrent: true,
        metadata: {},
        region: { id: REGION_ID, code: "EU" },
      },
      {
        id: PREV_ID,
        regionId: REGION_ID,
        slug: "blizzard-season-14",
        name: "14",
        blizzardSeasonId: 14,
        providerSeasonId: null,
        startsAt: new Date("2025-07-01T00:00:00.000Z"),
        endsAt: new Date("2026-01-01T00:00:00.000Z"),
        isCurrent: false,
        metadata: {},
        region: { id: REGION_ID, code: "EU" },
      },
    ];
    const prisma = {
      season: {
        findFirst: vi.fn(async (args: {
          where: Record<string, unknown>;
          select?: Record<string, boolean>;
          include?: Record<string, boolean>;
        }) => {
          const row = seasons.find((s) => {
            if (args.where.regionId != null && s.regionId !== args.where.regionId)
              return false;
            if (args.where.slug != null && s.slug !== args.where.slug) return false;
            if (args.where.isCurrent === true && !s.isCurrent) return false;
            return true;
          });
          if (!row) return null;
          if (args.include?.region) return { ...row, region: row.region };
          if (args.select) {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(args.select))
              out[k] = (row as Record<string, unknown>)[k];
            return out;
          }
          return { ...row };
        }),
        findUnique: vi.fn(async (args: {
          where: { id: string };
          select?: Record<string, boolean>;
          include?: Record<string, boolean>;
        }) => {
          const row = seasons.find((s) => s.id === args.where.id);
          if (!row) return null;
          if (args.include?.region) return { ...row, region: row.region };
          if (args.select) {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(args.select))
              out[k] = (row as Record<string, unknown>)[k];
            return out;
          }
          return { ...row };
        }),
        create: vi.fn(async () => ({ id: "new" })),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const idx = seasons.findIndex((s) => s.id === args.where.id);
          if (idx < 0) throw new Error("missing");
          seasons[idx] = {
            ...seasons[idx]!,
            ...(args.data.providerSeasonId !== undefined
              ? { providerSeasonId: args.data.providerSeasonId as string | null }
              : {}),
            ...(args.data.metadata !== undefined
              ? { metadata: args.data.metadata as Record<string, unknown> }
              : {}),
            ...(args.data.blizzardSeasonId !== undefined
              ? { blizzardSeasonId: args.data.blizzardSeasonId as number }
              : {}),
            ...(args.data.startsAt !== undefined
              ? { startsAt: args.data.startsAt as Date }
              : {}),
            ...(args.data.endsAt !== undefined
              ? { endsAt: args.data.endsAt as Date | null }
              : {}),
          };
          return seasons[idx];
        }),
      },
    };

    let boom = true;
    const getMythicKeystoneSeasonIndex = vi.fn(async () => {
      if (boom) throw new Error("blizzard down");
      return providerResult([
        {
          blizzardSeasonId: 14,
          slug: "s14",
          name: "14",
          startTimestamp: Date.parse("2025-07-01T00:00:00.000Z"),
          endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
        },
        {
          blizzardSeasonId: 15,
          slug: "s15",
          name: "15",
          startTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
          endTimestamp: null,
        },
      ]);
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const input = {
      prisma: prisma as never,
      regions: [{ code: "EU", id: REGION_ID }],
      blizzard: {
        getMythicKeystoneSeasonIndex,
        getMythicKeystoneSeason: vi.fn(async () => {
          throw new Error("unused");
        }),
      },
      raiderIo: {
        getStaticData: vi.fn(async () =>
          providerResult({
            expansionId: 10,
            seasons: [
              {
                slug: "season-tww-3",
                name: "tww3",
                startsAt: "2025-07-01T00:00:00.000Z",
                endsAt: "2026-01-01T00:00:00.000Z",
                isCurrent: false,
                isMainSeason: true,
                blizzardSeasonId: 14,
                dungeonSlugs: [],
              },
              {
                slug: "season-mn-1",
                name: "mn1",
                startsAt: "2026-01-01T00:00:00.000Z",
                endsAt: null,
                isCurrent: true,
                isMainSeason: true,
                blizzardSeasonId: 15,
                dungeonSlugs: [],
              },
            ],
            dungeons: [],
            attribution: {
              provider: "raiderio",
              displayText: "x",
              homepageUrl: "https://raider.io",
              profileUrl: null,
              sourceUrl: null,
            },
          }),
        ),
        getSeasonCutoffs: vi.fn(async () => providerResult(cutoffs())),
      },
      persistProviderResult: vi.fn(async () => "p"),
      logger,
      currentBlizzardSeasonIdByRegion: { EU: currentId },
    };

    const first = await ensureExperienceSeasonBindingReady(input);
    expect(first).not.toMatchObject({
      status: "skipped",
      reason: "EXPERIENCE_SEASON_BINDING_ALREADY_ENSURED",
    });
    expect(getMythicKeystoneSeasonIndex).toHaveBeenCalledTimes(1);
    expect(peekExperienceSeasonBindingEnsureStateForTests().get("EU")).toBeUndefined();
    expect(
      shouldEnsureExperienceSeasonBinding({
        regionCode: "EU",
        currentBlizzardSeasonId: currentId,
      }),
    ).toBe(true);

    boom = false;
    const second = await ensureExperienceSeasonBindingReady(input);
    expect(second).not.toMatchObject({
      status: "skipped",
      reason: "EXPERIENCE_SEASON_BINDING_ALREADY_ENSURED",
    });
    expect(getMythicKeystoneSeasonIndex).toHaveBeenCalledTimes(2);
    expect(peekExperienceSeasonBindingEnsureStateForTests().get("EU")).toBe(currentId);
    expect(seasons.find((s) => s.id === PREV_ID)!.providerSeasonId).toBe("season-tww-3");

    const third = await ensureExperienceSeasonBindingReady(input);
    expect(third).toEqual({
      status: "skipped",
      reason: "EXPERIENCE_SEASON_BINDING_ALREADY_ENSURED",
    });
    expect(getMythicKeystoneSeasonIndex).toHaveBeenCalledTimes(2);
  });
});

describe("Agent 02 F6 — Blizzard terminal vs transient RIO fallback", () => {
  it("classifies 429 / 5xx / network as TRANSIENT", () => {
    expect(
      classifyBlizzardPreviousSeasonFailureForRioFallback({
        statusCode: 429,
        code: "RATE_LIMITED",
      }),
    ).toBe("TRANSIENT");
    expect(
      classifyBlizzardPreviousSeasonFailureForRioFallback({
        statusCode: 503,
        code: "NETWORK",
      }),
    ).toBe("TRANSIENT");
    expect(
      classifyBlizzardPreviousSeasonFailureForRioFallback({
        code: "NETWORK",
        retryable: true,
        statusCode: null,
      }),
    ).toBe("TRANSIENT");
  });

  it("classifies historical 404 as TERMINAL_HISTORICAL_UNAVAILABLE", () => {
    expect(
      classifyBlizzardPreviousSeasonFailureForRioFallback({
        statusCode: 404,
        code: "NOT_FOUND",
      }),
    ).toBe("TERMINAL_HISTORICAL_UNAVAILABLE");
  });

  async function runWithBlizzardError(cause: object) {
    const store = createInMemoryExperienceEvidenceStore();
    const getCharacterExactSeasonHistoricalRating = vi.fn(async () =>
      providerResult({
        seasonSlug: "season-tww-3",
        seasonFound: true,
        scoreAll: 2900,
        activityProof: "UNKNOWN" as const,
      }),
    );
    const result = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonRowsWithFixturePollution()) as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => {
          throw Object.assign(new Error("fail"), cause);
        }),
        getCharacterAchievements: vi.fn(async () => achievementsDto()),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: store,
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });
    const persisted = await store.find({
      characterId: CHAR_ID,
      seasonId: PREV_ID,
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
      compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
    });
    return { result, persisted, getCharacterExactSeasonHistoricalRating };
  }

  it("429 does not call RIO or persist fallback", async () => {
    const { result, persisted, getCharacterExactSeasonHistoricalRating } =
      await runWithBlizzardError({ statusCode: 429, code: "RATE_LIMITED" });
    expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(persisted).toBeNull();
    expect(result.experience.available).toBe(false);
  });

  it("5xx does not call RIO or persist fallback", async () => {
    const { persisted, getCharacterExactSeasonHistoricalRating } =
      await runWithBlizzardError({ statusCode: 503, code: "NETWORK" });
    expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(persisted).toBeNull();
  });

  it("retryable network does not call RIO or persist fallback", async () => {
    const { persisted, getCharacterExactSeasonHistoricalRating } =
      await runWithBlizzardError({
        statusCode: null,
        code: "NETWORK",
        retryable: true,
      });
    expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(persisted).toBeNull();
  });

  it("terminal 404 still permits exact-season RIO fallback", async () => {
    const { result, persisted, getCharacterExactSeasonHistoricalRating } =
      await runWithBlizzardError({ statusCode: 404, code: "NOT_FOUND" });
    expect(getCharacterExactSeasonHistoricalRating).toHaveBeenCalledTimes(1);
    expect(persisted).not.toBeNull();
    expect(result.diagnostics.ratingSource).toBe("RAIDERIO_FALLBACK");
  });

  it("successful Blizzard never calls RIO fallback", async () => {
    const getCharacterExactSeasonHistoricalRating = vi.fn(async () => {
      throw new Error("RIO should not run");
    });
    const result = await buildExperiencePhase1Result({
      prisma: createPrismaFake(seasonRowsWithFixturePollution()) as never,
      characterId: CHAR_ID,
      identity,
      currentSeasonId: CURRENT_ID,
      regionCode: "EU",
      blizzard: {
        getMythicKeystoneSeasonProfile: vi.fn(async () => seasonProfile(2900)),
        getCharacterAchievements: vi.fn(async () => achievementsDto()),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "p"),
      allowProviderCalls: true,
      evidenceStore: createInMemoryExperienceEvidenceStore(),
      raiderIoExactSeason: { getCharacterExactSeasonHistoricalRating },
    });
    expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(result.diagnostics.ratingSource).toBe("BLIZZARD");
  });
});
