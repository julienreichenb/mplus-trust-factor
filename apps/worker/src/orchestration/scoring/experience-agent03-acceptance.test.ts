/**
 * Agent 03 — final acceptance through canonical runAuthoritativeScoring.
 *
 * Proves cold → warm → provider-free replay, remapped-cutoff fresh policy,
 * wrong-season contamination, transient vs terminal fallback, rollover,
 * exact Experience provider accounting, class-rank fail-closed, and P/S/U
 * non-regression. Does not call buildExperiencePhase1Result as sole proof.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  BlizzardCharacterAchievementsDTO,
  EvidenceCandidateMetadataV2,
  ProviderResult,
  RaiderIoCutoffThreshold,
  RaiderIoExactSeasonHistoricalRating,
  RaiderIoSeasonCutoffs,
  RaiderIoStaticSeason,
} from "@mplus/contracts";
import { buildSeasonPopulationPolicy, NATIVE_BAND_STANDING_SCORES } from "@mplus/scoring";
import type { WorkerContainer } from "../../container.js";
import { runAuthoritativeScoring } from "./refresh-bridge.js";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import {
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  hashSeasonPopulationPolicyContent,
  readExperiencePopulationPolicyMetadata,
  type PersistedExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";
import { proveExactRaiderIoCutoffSeasonEquivalence } from "./experience-season-bootstrap.js";
import { synchronizeSeasonPopulationPolicy } from "./experience-season-population-policy-sync.js";
import { previousRegionalClassRankFromRioProfile } from "./experience-phase1.js";
import { EXPERIENCE_EVIDENCE_KIND } from "./experience-evidence-persist.js";

const CHAR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CURRENT_SEASON_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PREV_SEASON_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIXTURE_SEASON_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const REGION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const N_PLUS_1_SEASON_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const PREV_RIO_SLUG = "season-tww-3";
const CURRENT_RIO_SLUG = "season-tww-4";
const FIXTURE_RIO_SLUG = "season-fixture-poison";
const N_PLUS_1_RIO_SLUG = "season-tww-5";
const PREV_RATING = 3000; // → p990 → standing 90
const ELITE_ACHIEVEMENT_ID = 20_589;

const refreshContract = {
  scoringModelKey: "test",
  scoringModelVersion: 1,
  observationSchemaVersion: "observations-v2",
  wclAdapterVersion: "points-and-damage-v1",
  blizzardAdapterVersion: "blizzard-v1",
  raiderIoAdapterVersion: "raiderio-v1",
  runSelectionVersion: "active-season-eight-v1",
  abilityCatalogVersion: "abilities-v1",

  abilityCatalogExecutionKey: "static:abilities-v1",
  mechanicCatalogVersion: "mechanics-v1",
  activeSeasonId: "blizzard-season-15",
  zoneId: 47 as number | null,
  partition: null as number | null,
};

function threshold(
  score: number,
  quantile: RaiderIoCutoffThreshold["quantile"],
  label: RaiderIoCutoffThreshold["label"],
): RaiderIoCutoffThreshold {
  return { score, quantile, label };
}

function cutoffsDto(seasonSlug: string, remapped = false): RaiderIoSeasonCutoffs {
  return {
    region: "EU",
    seasonSlug,
    updatedAt: "2026-01-01T00:00:00.000Z",
    isRemappedSeason: remapped,
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
}

function completePolicyDoc(
  seasonSlug = PREV_RIO_SLUG,
): PersistedExperiencePopulationPolicyMetadata {
  const built = buildSeasonPopulationPolicy(cutoffsDto(seasonSlug), {
    seasonSlug,
  });
  if (!built.ok) throw new Error("expected policy");
  return {
    schemaVersion: "experience-population-policy-store-v2",
    policy: built.policy,
    raiderIoSeasonSlug: seasonSlug,
    policyContentHash: hashSeasonPopulationPolicyContent(built.policy),
    sourceRequestFingerprint: "fp-bootstrap",
    sourcePayloadId: "payload-bootstrap",
    sourceFetchedAt: "2026-01-01T00:00:00.000Z",
    synchronizedAt: "2026-01-01T00:00:01.000Z",
    lastKnownGood: true,
  };
}

function candidates(): EvidenceCandidateMetadataV2[] {
  const dungeons = [
    "ara-kara",
    "city-of-threads",
    "the-dawnbreaker",
    "the-stonevault",
    "mists-of-tirna-scithe",
    "the-necrotic-wake",
    "siege-of-boralus",
    "grim-batol",
  ];
  return dungeons.flatMap((slug, i) => [
    {
      discoveryIdentity: { reportCode: `R${i}A`, fightId: 1 },
      reportRevision: 1,
      dungeonSlug: slug,
      keyLevel: 12,
      timed: true,
      runScore: 200,
      evidenceCompleteness: 1,
      completedAt: "2026-01-01T00:00:00.000Z",
      fightDurationMs: 1_800_000,
      actorId: 1,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: "test",
    },
    {
      discoveryIdentity: { reportCode: `R${i}B`, fightId: 2 },
      reportRevision: 1,
      dungeonSlug: slug,
      keyLevel: 11,
      timed: true,
      runScore: 180,
      evidenceCompleteness: 1,
      completedAt: "2026-01-02T00:00:00.000Z",
      fightDurationMs: 1_700_000,
      actorId: 1,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: "test",
    },
  ]);
}

function providerResult<T>(
  data: T,
  fingerprint: string,
  provider: "blizzard" | "raiderio" = "blizzard",
): ProviderResult<T> {
  return {
    data,
    provenance: {
      provider,
      externalRequestId: "ext",
      sourcePayloadId: null,
      sourceUrl:
        provider === "raiderio"
          ? "https://raider.io/api/v1/characters/profile"
          : "https://eu.api.blizzard.com/example",
      fetchedAt: "2026-08-08T00:00:01.000Z",
      schemaVersion: `${provider}-test`,
    },
    freshness: {
      fetchedAt: "2026-08-08T00:00:01.000Z",
      expiresAt: null,
      stale: false,
    },
    metadata: {
      provider,
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

type SeasonRow = {
  id: string;
  regionId: string;
  slug: string;
  blizzardSeasonId: number;
  startsAt: Date;
  endsAt: Date | null;
  providerSeasonId: string | null;
  isCurrent: boolean;
  metadata: Record<string, unknown>;
  name?: string;
};

type BlizzardMode =
  | { kind: "success"; rating: number }
  | { kind: "error"; cause: object };

function buildBaseSeasons(opts?: {
  includePolicy?: boolean;
  includeFixturePollution?: boolean;
  includeNPlus1?: boolean;
}): Record<string, SeasonRow> {
  const includePolicy = opts?.includePolicy !== false;
  const seasons: Record<string, SeasonRow> = {
    [CURRENT_SEASON_ID]: {
      id: CURRENT_SEASON_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-15",
      blizzardSeasonId: 15,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: null,
      providerSeasonId: CURRENT_RIO_SLUG,
      isCurrent: true,
      metadata: {},
      name: "Season 15",
    },
    [PREV_SEASON_ID]: {
      id: PREV_SEASON_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-14",
      blizzardSeasonId: 14,
      startsAt: new Date("2025-06-01T00:00:00.000Z"),
      endsAt: new Date("2025-12-01T00:00:00.000Z"),
      providerSeasonId: PREV_RIO_SLUG,
      isCurrent: false,
      metadata: includePolicy
        ? { [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc() }
        : {},
      name: "Season 14",
    },
  };

  if (opts?.includeFixturePollution) {
    seasons[FIXTURE_SEASON_ID] = {
      id: FIXTURE_SEASON_ID,
      regionId: REGION_ID,
      slug: "internal-fixture-event",
      blizzardSeasonId: 14_999,
      // Later than true previous — must not become product previous.
      startsAt: new Date("2025-11-01T00:00:00.000Z"),
      endsAt: new Date("2025-12-15T00:00:00.000Z"),
      providerSeasonId: FIXTURE_RIO_SLUG,
      isCurrent: false,
      metadata: {},
      name: "Fixture Event",
    };
  }

  if (opts?.includeNPlus1) {
    seasons[N_PLUS_1_SEASON_ID] = {
      id: N_PLUS_1_SEASON_ID,
      regionId: REGION_ID,
      slug: "blizzard-season-16",
      blizzardSeasonId: 16,
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: null,
      providerSeasonId: N_PLUS_1_RIO_SLUG,
      isCurrent: false,
      metadata: {},
      name: "Season 16",
    };
  }

  return seasons;
}

function createHarness(opts?: {
  allowExperienceProviders?: boolean;
  blizzardMode?: BlizzardMode;
  includePolicy?: boolean;
  includeFixturePollution?: boolean;
  includeNPlus1?: boolean;
  rioHistoricalRating?: number;
}) {
  const allowExperienceProviders = opts?.allowExperienceProviders !== false;
  const blizzardMode: BlizzardMode = opts?.blizzardMode ?? {
    kind: "success",
    rating: PREV_RATING,
  };
  const seasons = buildBaseSeasons({
    includePolicy: opts?.includePolicy,
    includeFixturePollution: opts?.includeFixturePollution,
    includeNPlus1: opts?.includeNPlus1,
  });
  const evidenceRows = new Map<string, Record<string, unknown>>();
  const evidenceKey = (row: {
    characterId: string;
    seasonId: string;
    evidenceKind: string;
    compatibilityVersion: string;
  }) =>
    `${row.characterId}|${row.seasonId}|${row.evidenceKind}|${row.compatibilityVersion}`;

  const getMythicKeystoneSeasonProfile = vi.fn(async (_identity, seasonId: number) => {
    if (blizzardMode.kind === "error") {
      throw Object.assign(new Error("blizzard historical failure"), blizzardMode.cause);
    }
    expect(seasonId).toBe(14);
    return providerResult(
      {
        profile: {
          currentMythicRating: blizzardMode.rating,
          currentSeasonId: 14,
          seasons: [{ seasonId: 14 }],
          character: {
            region: "EU",
            realmSlug: "archimonde",
            name: "Acceptance",
          },
        },
        runs: [{ keyLevel: 12 } as never],
      },
      "fp-prev-season",
    );
  });

  /** Agent 03B history discovery — seasons with profiles (includes current). */
  const getMythicKeystoneProfile = vi.fn(async () =>
    providerResult(
      {
        currentMythicRating: 4000,
        currentSeasonId: 15,
        seasons: [{ seasonId: 14 }, { seasonId: 15 }],
        character: {
          region: "EU",
          realmSlug: "archimonde",
          name: "Acceptance",
        },
      },
      "fp-mplus-index",
    ),
  );

  const getCharacterAchievements = vi.fn(
    async (): Promise<ProviderResult<BlizzardCharacterAchievementsDTO>> =>
      providerResult(
        {
          achievements: [
            {
              achievementId: ELITE_ACHIEVEMENT_ID,
              completedAt: "2025-03-01T00:00:00.000Z",
            },
          ],
        },
        "fp-achievements",
      ),
  );

  const rioRating = opts?.rioHistoricalRating ?? PREV_RATING;
  const getCharacterExactSeasonHistoricalRating = vi.fn(
    async (
      _identity,
      seasonSlug: string,
    ): Promise<ProviderResult<RaiderIoExactSeasonHistoricalRating>> => {
      expect(seasonSlug).toBe(PREV_RIO_SLUG);
      expect(seasonSlug).not.toBe(FIXTURE_RIO_SLUG);
      return providerResult(
        {
          requestedSeasonSlug: PREV_RIO_SLUG,
          seasonFound: true,
          scoreAll: rioRating,
          activityProof: "PROVEN_POSITIVE" as const,
          totalSeasonRuns: 40,
        },
        "fp-rio-exact",
        "raiderio",
      );
    },
  );

  const getSeasonCutoffs = vi.fn(async () => {
    throw new Error("Experience must not call Raider.IO cutoffs per character");
  });

  const saved: Array<Record<string, unknown>> = [];

  const prisma = {
    scoreModel: {
      findUnique: vi.fn(async () => ({ config: {} })),
    },
    characterPerformanceAggregate: {
      findUnique: vi.fn(async () => null),
    },
    characterExperienceEvidence: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            characterId_seasonId_evidenceKind_compatibilityVersion: {
              characterId: string;
              seasonId: string;
              evidenceKind: string;
              compatibilityVersion: string;
            };
          };
        }) => {
          const id = where.characterId_seasonId_evidenceKind_compatibilityVersion;
          return evidenceRows.get(evidenceKey(id)) ?? null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `ev-${evidenceRows.size + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        evidenceRows.set(
          evidenceKey({
            characterId: String(data.characterId),
            seasonId: String(data.seasonId),
            evidenceKind: String(data.evidenceKind),
            compatibilityVersion: String(data.compatibilityVersion),
          }),
          row,
        );
        return row;
      }),
      findMany: vi.fn(
        async (args?: {
          where?: {
            characterId?: string;
            evidenceKind?: string;
            compatibilityVersion?: string;
          };
        }) => {
          let rows = [...evidenceRows.values()];
          if (args?.where?.characterId) {
            rows = rows.filter((r) => r.characterId === args.where!.characterId);
          }
          if (args?.where?.evidenceKind) {
            rows = rows.filter((r) => r.evidenceKind === args.where!.evidenceKind);
          }
          if (args?.where?.compatibilityVersion) {
            rows = rows.filter(
              (r) => r.compatibilityVersion === args.where!.compatibilityVersion,
            );
          }
          return rows;
        },
      ),
    },
    characterScore: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        saved.push(create);
        return { id: `score-${saved.length}`, ...create };
      }),
    },
    season: {
      findUnique: vi.fn(
        async ({
          where,
          include,
        }: {
          where: { id: string };
          include?: { region?: boolean };
        }) => {
          const row = seasons[where.id];
          if (!row) return null;
          const base = {
            id: row.id,
            regionId: row.regionId,
            slug: row.slug,
            name: row.name ?? row.slug,
            blizzardSeasonId: row.blizzardSeasonId,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            providerSeasonId: row.providerSeasonId,
            isCurrent: row.isCurrent,
            metadata: row.metadata,
          };
          if (include?.region) {
            return { ...base, region: { id: REGION_ID, code: "EU" } };
          }
          return base;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { metadata?: Record<string, unknown>; providerSeasonId?: string | null };
        }) => {
          const row = seasons[where.id];
          if (!row) throw new Error(`season ${where.id} missing`);
          if (data.metadata !== undefined) row.metadata = data.metadata;
          if (data.providerSeasonId !== undefined) {
            row.providerSeasonId = data.providerSeasonId;
          }
          return row;
        },
      ),
      findMany: vi.fn(
        async (args?: {
          where?: {
            regionId?: string;
            id?: { in?: string[] };
            startsAt?: { lt?: Date };
            blizzardSeasonId?: { not?: null; in?: number[] };
          };
          orderBy?: { startsAt?: "asc" | "desc" };
          take?: number;
          select?: Record<string, boolean>;
        }) => {
          let rows = Object.values(seasons);
          if (args?.where?.id?.in) {
            const ids = new Set(args.where.id.in);
            rows = rows.filter((r) => ids.has(r.id));
          }
          if (args?.where?.regionId) {
            rows = rows.filter((r) => r.regionId === args.where!.regionId);
          }
          if (args?.where?.startsAt?.lt) {
            const lt = args.where.startsAt.lt.getTime();
            rows = rows.filter((r) => r.startsAt.getTime() < lt);
          }
          if (args?.where?.blizzardSeasonId?.in) {
            const ids = new Set(args.where.blizzardSeasonId.in);
            rows = rows.filter(
              (r) => r.blizzardSeasonId != null && ids.has(r.blizzardSeasonId),
            );
          } else if (args?.where?.blizzardSeasonId?.not !== undefined) {
            rows = rows.filter((r) => r.blizzardSeasonId != null);
          }
          if (args?.orderBy?.startsAt === "desc") {
            rows = [...rows].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
          } else if (args?.orderBy?.startsAt === "asc") {
            rows = [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
          }
          if (typeof args?.take === "number") {
            rows = rows.slice(0, args.take);
          }
          if (!args?.select) return rows;
          return rows.map((r) => {
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(args.select!)) {
              if (args.select![key]) out[key] = (r as Record<string, unknown>)[key];
            }
            return out;
          });
        },
      ),
    },
  };

  const container = {
    env: {
      SCORING_ENABLED: true,
      SCORING_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: allowExperienceProviders,
      PROVIDER_MODE: "fixture",
      WCL_ENABLED: false,
      BLIZZARD_ENABLED: true,
      WCL_CHARACTER_TTL_SECONDS: 43_200,
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    prisma,
    providers: {
      blizzard: {
        getMythicKeystoneProfile,
        getMythicKeystoneSeasonProfile,
        getCharacterAchievements,
      },
      warcraftlogs: {},
      raiderio: {
        getSeasonCutoffs,
        getCharacterExactSeasonHistoricalRating,
      },
    },
    disabledProviders: new Set<string>(),
    repositories: {
      artifacts: {},
      evidence: {},
      externalRequest: {
        recordRequestAndPayload: vi.fn(async () => ({
          payload: { id: "payload-1" },
        })),
      },
    },
    createRedisConnection: vi.fn(),
  } as unknown as WorkerContainer;

  const scoringArgs = {
    characterId: CHAR_ID,
    seasonId: CURRENT_SEASON_ID,
    seasonSlug: "blizzard-season-15",
    role: "DPS" as const,
    classSlug: "mage",
    specSlug: "fire",
    refreshContract,
    evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
    highKeyPolicyId: "policy-1",
    activeDungeonSlugs: candidates().map((c) => c.dungeonSlug),
    candidates: candidates(),
    scoreModelKey: "test",
    scoreModelVersion: 1,
    scoreModelId: "model-1",
    calculatedAt: "2026-01-01T00:00:00.000Z",
    region: "EU" as const,
    realm: "archimonde",
    characterName: "Acceptance",
    portsOverride: createMemoryOrchestrationPorts(),
    performanceAggregateProviderOverride: null as null,
  };

  return {
    container,
    scoringArgs,
    saved,
    seasons,
    evidenceRows,
    getMythicKeystoneProfile,
    getMythicKeystoneSeasonProfile,
    getCharacterAchievements,
    getCharacterExactSeasonHistoricalRating,
    getSeasonCutoffs,
  };
}

type ExperienceDetails = {
  score: number | null;
  available: boolean;
  confidence: number | null;
  reason: string | null;
  previousStandingScore: number | null;
  eliteFloorApplied: boolean;
  confirmedEliteTitleCount: number;
  standingProvenance?: unknown;
};

function experienceFromSaved(row: Record<string, unknown>): ExperienceDetails {
  return (row.dimensionDetails as { experience: ExperienceDetails }).experience;
}

function ratingEvidenceRows(evidenceRows: Map<string, Record<string, unknown>>) {
  return [...evidenceRows.values()].filter(
    (r) => r.evidenceKind === EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
  );
}

describe("Agent 03 — canonical cold → warm → provider-free replay", () => {
  it("proves Blizzard-first acquisition, warm cache, and provider-free identical E", async () => {
    const harness = createHarness({ allowExperienceProviders: true });

    const cold = await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
    });

    expect(harness.getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(harness.getCharacterAchievements).toHaveBeenCalledTimes(1);
    expect(harness.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    // Index + previous Season Details + achievements (03B history then Phase 1 reuse).
    expect(cold.providerCalls).toBe(3);

    const coldExp = experienceFromSaved(harness.saved[0]!);
    expect(coldExp.available).toBe(true);
    expect(coldExp.score).toBe(NATIVE_BAND_STANDING_SCORES.p990);
    expect(harness.saved[0]!.experience).toBe(NATIVE_BAND_STANDING_SCORES.p990);
    expect(ratingEvidenceRows(harness.evidenceRows).length).toBe(1);
    expect(ratingEvidenceRows(harness.evidenceRows)[0]!.seasonId).toBe(PREV_SEASON_ID);
    expect(ratingEvidenceRows(harness.evidenceRows)[0]!.blizzardSeasonId).toBe(14);
    expect(ratingEvidenceRows(harness.evidenceRows)[0]!.raiderIoSeasonSlug).toBe(
      PREV_RIO_SLUG,
    );

    const coldPsu = {
      performance: harness.saved[0]!.performance,
      survival: harness.saved[0]!.survival,
      utility: harness.saved[0]!.utility,
    };

    // WARM — Profile Index once; Season Details short-circuit when evidence exists.
    harness.getMythicKeystoneProfile?.mockClear();
    harness.getMythicKeystoneSeasonProfile.mockClear();
    harness.getCharacterAchievements.mockClear();
    harness.getCharacterExactSeasonHistoricalRating.mockClear();

    const warm = await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
      portsOverride: createMemoryOrchestrationPorts(),
    });

    expect(harness.getMythicKeystoneProfile).toHaveBeenCalledTimes(1);
    expect(harness.getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(harness.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(harness.getCharacterAchievements).not.toHaveBeenCalled();
    expect(warm.providerCalls).toBe(1);

    const warmExp = experienceFromSaved(harness.saved[1]!);
    expect(warmExp).toEqual(coldExp);
    expect(harness.saved[1]!.performance).toBe(coldPsu.performance);
    expect(harness.saved[1]!.survival).toBe(coldPsu.survival);
    expect(harness.saved[1]!.utility).toBe(coldPsu.utility);

    // PROVIDER-FREE REPLAY — ALLOW_LIVE_PROVIDER_CALLS=false still reconstructs E.
    harness.container.env.ALLOW_LIVE_PROVIDER_CALLS = false;
    harness.getMythicKeystoneSeasonProfile.mockClear();
    harness.getCharacterAchievements.mockClear();
    harness.getCharacterExactSeasonHistoricalRating.mockClear();

    const replay = await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
      portsOverride: createMemoryOrchestrationPorts(),
    });

    expect(harness.getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(harness.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(harness.getCharacterAchievements).not.toHaveBeenCalled();
    expect(replay.providerCalls).toBe(0);

    const replayExp = experienceFromSaved(harness.saved[2]!);
    expect(replayExp).toEqual(coldExp);
    expect(harness.saved[2]!.performance).toBe(coldPsu.performance);
    expect(harness.saved[2]!.survival).toBe(coldPsu.survival);
    expect(harness.saved[2]!.utility).toBe(coldPsu.utility);
  });
});

describe("Agent 03 — fresh policy + remapped cutoffs + positive rating", () => {
  it("persists remapped LKG from scratch then scores native p990 via canonical entry", async () => {
    const harness = createHarness({
      allowExperienceProviders: true,
      includePolicy: false,
      blizzardMode: { kind: "success", rating: PREV_RATING },
    });

    expect(
      readExperiencePopulationPolicyMetadata(harness.seasons[PREV_SEASON_ID]!.metadata),
    ).toBeNull();

    const rioSeason: RaiderIoStaticSeason = {
      slug: PREV_RIO_SLUG,
      name: "TWW 3",
      startsAt: "2025-06-01T00:00:00.000Z",
      endsAt: "2025-12-01T00:00:00.000Z",
      isCurrent: false,
      isMainSeason: true,
      blizzardSeasonId: 14,
      dungeonSlugs: [],
    };
    const proof = proveExactRaiderIoCutoffSeasonEquivalence({
      boundRaiderIoSlug: PREV_RIO_SLUG,
      blizzardSeasonId: 14,
      blizzardStartsAtMs: Date.parse("2025-06-01T00:00:00.000Z"),
      blizzardEndsAtMs: Date.parse("2025-12-01T00:00:00.000Z"),
      rioSeason,
    });
    expect(proof.proven).toBe(true);

    const remapped = cutoffsDto(PREV_RIO_SLUG, true);
    expect(remapped.isRemappedSeason).toBe(true);

    const refused = await synchronizeSeasonPopulationPolicy({
      prisma: harness.container.prisma as never,
      seasonId: PREV_SEASON_ID,
      regionCode: "EU",
      raiderIoSeasonSlug: PREV_RIO_SLUG,
      raiderIo: {
        getSeasonCutoffs: vi.fn(async () =>
          providerResult(remapped, "fp-cutoffs-refuse", "raiderio"),
        ),
      },
      ctx: {
        region: "EU",
        requestId: "agent03-fresh-refuse",
        correlationId: null,
        forceRefresh: false,
        now: "2026-01-01T00:00:00.000Z",
      },
      persistProviderResult: async () => "payload-cutoffs",
      exactTargetSeasonEquivalenceProven: false,
    });
    expect(refused).toMatchObject({
      status: "NO_USABLE_POLICY",
      reason: "REMAPPED_CUTOFFS_UNPROVEN_TARGET_SEASON_EQUIVALENCE",
    });

    const synced = await synchronizeSeasonPopulationPolicy({
      prisma: harness.container.prisma as never,
      seasonId: PREV_SEASON_ID,
      regionCode: "EU",
      raiderIoSeasonSlug: PREV_RIO_SLUG,
      raiderIo: {
        getSeasonCutoffs: vi.fn(async () =>
          providerResult(remapped, "fp-cutoffs-accept", "raiderio"),
        ),
      },
      ctx: {
        region: "EU",
        requestId: "agent03-fresh-accept",
        correlationId: null,
        forceRefresh: false,
        now: "2026-01-01T00:00:00.000Z",
      },
      persistProviderResult: async () => "payload-cutoffs",
      exactTargetSeasonEquivalenceProven: proof.proven,
    });
    expect(synced.status).toBe("UPDATED");

    const stored = readExperiencePopulationPolicyMetadata(
      harness.seasons[PREV_SEASON_ID]!.metadata,
    );
    expect(stored).not.toBeNull();
    expect(stored!.raiderIoSeasonSlug).toBe(PREV_RIO_SLUG);
    expect(stored!.lastKnownGood).toBe(true);

    const cold = await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
    });

    expect(harness.getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(harness.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(cold.providerCalls).toBe(3);

    const exp = experienceFromSaved(harness.saved[0]!);
    expect(exp.available).toBe(true);
    expect(exp.score).toBe(NATIVE_BAND_STANDING_SCORES.p990);
    expect(exp.previousStandingScore).toBe(NATIVE_BAND_STANDING_SCORES.p990);

    // Provider-free replay after fresh policy + evidence persist.
    harness.container.env.ALLOW_LIVE_PROVIDER_CALLS = false;
    harness.getMythicKeystoneSeasonProfile.mockClear();
    harness.getCharacterAchievements.mockClear();
    harness.getCharacterExactSeasonHistoricalRating.mockClear();

    const replay = await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
      portsOverride: createMemoryOrchestrationPorts(),
    });
    expect(replay.providerCalls).toBe(0);
    expect(experienceFromSaved(harness.saved[1]!)).toEqual(exp);
  });
});

describe("Agent 03 — wrong-season contamination via canonical scoring", () => {
  it("persists Blizzard N-1 history with bound RIO slug; never calls RIO character historical", async () => {
    const harness = createHarness({
      allowExperienceProviders: true,
      includeFixturePollution: true,
      blizzardMode: { kind: "success", rating: PREV_RATING },
    });

    await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
    });

    expect(harness.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();

    const rating = ratingEvidenceRows(harness.evidenceRows).find(
      (r) => r.seasonId === PREV_SEASON_ID,
    )!;
    expect(rating).toBeTruthy();
    expect(rating.seasonId).toBe(PREV_SEASON_ID);
    expect(rating.blizzardSeasonId).toBe(14);
    expect(rating.raiderIoSeasonSlug).toBe(PREV_RIO_SLUG);
    expect(rating.source).toBe("BLIZZARD");

    const exp = experienceFromSaved(harness.saved[0]!);
    expect(exp.available).toBe(true);
    expect(exp.score).toBe(NATIVE_BAND_STANDING_SCORES.p990);
  });
});

describe("Agent 03 — transient vs terminal Blizzard fallback (canonical)", () => {
  it.each([
    { label: "429", cause: { statusCode: 429, code: "RATE_LIMITED" } },
    { label: "5xx", cause: { statusCode: 503, code: "NETWORK" } },
    {
      label: "retryable network",
      cause: { statusCode: null, code: "NETWORK", retryable: true },
    },
  ])("$label does not call RIO or persist immutable fallback", async ({ cause }) => {
    const harness = createHarness({
      allowExperienceProviders: true,
      blizzardMode: { kind: "error", cause },
    });

    await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
    });

    expect(harness.getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(harness.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(ratingEvidenceRows(harness.evidenceRows)).toHaveLength(0);
    // Elite achievements may still yield Experience (elite floor); rating remains unpersisted.
    const exp = experienceFromSaved(harness.saved[0]!);
    expect(exp.previousStandingScore).toBeNull();
  });

  it("terminal 404 does not call RIO character historical; elite floor may still score", async () => {
    const harness = createHarness({
      allowExperienceProviders: true,
      blizzardMode: {
        kind: "error",
        cause: { statusCode: 404, code: "NOT_FOUND" },
      },
    });

    const result = await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
    });

    // History Season Details fails once; Phase1 must not retry Season Details or RIO historical.
    expect(harness.getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(harness.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(harness.getCharacterAchievements).toHaveBeenCalledTimes(1);
    // index + failed details + achievements
    expect(result.providerCalls).toBe(3);
    expect(ratingEvidenceRows(harness.evidenceRows)).toHaveLength(0);
    const exp = experienceFromSaved(harness.saved[0]!);
    expect(exp.available).toBe(true);
    expect(exp.score).toBe(90);
    expect(exp.eliteFloorApplied).toBe(true);
    expect(exp.previousStandingScore).toBeNull();
  });

  it("after transient failure, next attempt can retry Blizzard successfully", async () => {
    const harness = createHarness({
      allowExperienceProviders: true,
      blizzardMode: {
        kind: "error",
        cause: { statusCode: 429, code: "RATE_LIMITED" },
      },
    });

    await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
    });
    expect(ratingEvidenceRows(harness.evidenceRows)).toHaveLength(0);

    // Replace Blizzard stub with success for retry (same evidence store / seasons).
    harness.getMythicKeystoneSeasonProfile.mockImplementation(
      async (_identity, seasonId: number) => {
        expect(seasonId).toBe(14);
        return providerResult(
          {
            profile: {
              currentMythicRating: PREV_RATING,
              currentSeasonId: 14,
              seasons: [{ seasonId: 14 }],
              character: {
                region: "EU",
                realmSlug: "archimonde",
                name: "Acceptance",
              },
            },
            runs: [{ keyLevel: 12 } as never],
          },
          "fp-prev-season-retry",
        );
      },
    );
    harness.getMythicKeystoneSeasonProfile.mockClear();
    harness.getCharacterExactSeasonHistoricalRating.mockClear();

    await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
      portsOverride: createMemoryOrchestrationPorts(),
    });

    expect(harness.getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(harness.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(ratingEvidenceRows(harness.evidenceRows)[0]!.source).toBe("BLIZZARD");
    expect(harness.saved[1]!.experience).toBe(NATIVE_BAND_STANDING_SCORES.p990);
  });
});

describe("Agent 03 — rollover + ensure retry", () => {
  it("after N→N+1 flip, stale N-1 evidence cannot satisfy new previous N", async () => {
    const harness = createHarness({
      allowExperienceProviders: true,
      includeNPlus1: true,
      includePolicy: true,
    });

    // Seed policy on season 15 so it can become previous after rollover.
    harness.seasons[CURRENT_SEASON_ID]!.metadata = {
      [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: completePolicyDoc(CURRENT_RIO_SLUG),
    };

    await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
    });
    expect(ratingEvidenceRows(harness.evidenceRows)[0]!.seasonId).toBe(PREV_SEASON_ID);

    // Flip current: season 15 is no longer current; 16 becomes current.
    harness.seasons[CURRENT_SEASON_ID]!.isCurrent = false;
    harness.seasons[CURRENT_SEASON_ID]!.endsAt = new Date("2025-12-15T00:00:00.000Z");
    harness.seasons[N_PLUS_1_SEASON_ID]!.isCurrent = true;

    harness.getMythicKeystoneProfile.mockImplementation(async () =>
      providerResult(
        {
          currentMythicRating: 4000,
          currentSeasonId: 16,
          seasons: [{ seasonId: 14 }, { seasonId: 15 }, { seasonId: 16 }],
          character: {
            region: "EU",
            realmSlug: "archimonde",
            name: "Acceptance",
          },
        },
        "fp-mplus-index-rollover",
      ),
    );
    harness.getMythicKeystoneSeasonProfile.mockImplementation(
      async (_identity, seasonId: number) => {
        // New closed historical season after rollover is Blizzard 15.
        expect(seasonId).toBe(15);
        return providerResult(
          {
            profile: {
              currentMythicRating: 2800,
              currentSeasonId: 15,
              seasons: [{ seasonId: 15 }],
              character: {
                region: "EU",
                realmSlug: "archimonde",
                name: "Acceptance",
              },
            },
            runs: [{ keyLevel: 11 } as never],
          },
          "fp-season-15",
        );
      },
    );
    harness.getMythicKeystoneProfile.mockClear();
    harness.getMythicKeystoneSeasonProfile.mockClear();
    harness.getCharacterAchievements.mockClear();
    harness.getCharacterExactSeasonHistoricalRating.mockClear();

    await runAuthoritativeScoring({
      ...harness.scoringArgs,
      seasonId: N_PLUS_1_SEASON_ID,
      seasonSlug: "blizzard-season-16",
      container: harness.container,
      portsOverride: createMemoryOrchestrationPorts(),
    });

    // Must re-fetch historical for season 15 — stale season-14 evidence does not satisfy.
    expect(harness.getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    const seasonsPersisted = ratingEvidenceRows(harness.evidenceRows).map((r) => r.seasonId);
    expect(seasonsPersisted).toContain(PREV_SEASON_ID);
    expect(seasonsPersisted).toContain(CURRENT_SEASON_ID);
    // Standing would be p900 (75); elite floor from achievements → 90.
    expect(harness.saved[1]!.experience).toBe(90);
    // Ensure retry (fail → retry → skip) remains covered by Agent 02 F5.
  });
});

describe("Agent 03 — class-rank fail-closed (remaining scope)", () => {
  it("generic previousRanks.classRank.region stays null without exactSeasonProven", () => {
    // Canonical refresh-bridge passes exactSeasonProven: false by design.
    const rank = previousRegionalClassRankFromRioProfile(
      { previousRanks: { classRank: { region: 7 }, region: 100 } },
      { exactSeasonProven: false },
    );
    expect(rank).toBeNull();
  });
});

describe("Agent 03 — live-probe destructive reset guard", () => {
  it("requires explicit env opt-in and rejects production-like APP_ENV", async () => {
    const { assertExperienceLiveProbeDestructiveResetAllowed } = await import(
      "./experience-agent05-live-probe-guards.js"
    );

    expect(() =>
      assertExperienceLiveProbeDestructiveResetAllowed({
        EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET: undefined,
        APP_ENV: "test",
      }),
    ).toThrow(/EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET/);

    expect(() =>
      assertExperienceLiveProbeDestructiveResetAllowed({
        EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET: "true",
        APP_ENV: "production",
      }),
    ).toThrow(/production/);

    expect(() =>
      assertExperienceLiveProbeDestructiveResetAllowed({
        EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET: "true",
        APP_ENV: "staging",
      }),
    ).toThrow(/staging/);

    expect(() =>
      assertExperienceLiveProbeDestructiveResetAllowed({
        EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET: "true",
        APP_ENV: "test",
      }),
    ).not.toThrow();
  });
});
