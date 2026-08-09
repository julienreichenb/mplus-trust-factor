/**
 * Agent 01 regressions: canonical runAuthoritativeScoring Experience replay +
 * provider accounting (fails against PR #84 outer gate / RIO accounting gap).
 */
import { describe, expect, it, vi } from "vitest";
import type {
  BlizzardCharacterAchievementsDTO,
  EvidenceCandidateMetadataV2,
  ProviderResult,
  RaiderIoCutoffThreshold,
  RaiderIoExactSeasonHistoricalRating,
  RaiderIoSeasonCutoffs,
} from "@mplus/contracts";
import { buildSeasonPopulationPolicy } from "@mplus/scoring";
import type { WorkerContainer } from "../../container.js";
import { runAuthoritativeScoring } from "./refresh-bridge.js";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import {
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  hashSeasonPopulationPolicyContent,
  type PersistedExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";

const CHAR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CURRENT_SEASON_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PREV_SEASON_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REGION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const PREV_RIO_SLUG = "season-tww-3";
const CURRENT_RIO_SLUG = "season-tww-4";
const PREV_RATING = 2900;
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

function completePolicyDoc(): PersistedExperiencePopulationPolicyMetadata {
  const cutoffs: RaiderIoSeasonCutoffs = {
    region: "EU",
    seasonSlug: PREV_RIO_SLUG,
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
  const built = buildSeasonPopulationPolicy(cutoffs, { seasonSlug: PREV_RIO_SLUG });
  if (!built.ok) throw new Error("expected policy");
  return {
    schemaVersion: "experience-population-policy-store-v2",
    policy: built.policy,
    raiderIoSeasonSlug: PREV_RIO_SLUG,
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
  providerSeasonId: string;
  isCurrent: boolean;
  metadata: Record<string, unknown>;
};

function buildSeasons(): Record<string, SeasonRow> {
  const policyDoc = completePolicyDoc();
  return {
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
      metadata: {
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc,
      },
    },
  };
}

function createHarness(opts?: {
  allowExperienceProviders?: boolean;
  blizzardFails?: boolean;
}) {
  const allowExperienceProviders = opts?.allowExperienceProviders !== false;
  const blizzardFails = opts?.blizzardFails === true;
  const seasons = buildSeasons();
  const evidenceRows = new Map<string, Record<string, unknown>>();
  const evidenceKey = (row: {
    characterId: string;
    seasonId: string;
    evidenceKind: string;
    compatibilityVersion: string;
  }) =>
    `${row.characterId}|${row.seasonId}|${row.evidenceKind}|${row.compatibilityVersion}`;

  const getMythicKeystoneSeasonProfile = vi.fn(async (_identity, seasonId: number) => {
    if (blizzardFails) {
      throw Object.assign(new Error("blizzard historical unavailable"), {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
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
            name: "Wallidrixe",
          },
        },
        runs: [{ keyLevel: 12 } as never],
      },
      "fp-prev-season",
    );
  });

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

  const getCharacterExactSeasonHistoricalRating = vi.fn(
    async (): Promise<ProviderResult<RaiderIoExactSeasonHistoricalRating>> =>
      providerResult(
        {
          requestedSeasonSlug: PREV_RIO_SLUG,
          seasonFound: true,
          scoreAll: PREV_RATING,
          activityProof: "PROVEN_NONE" as const,
          totalSeasonRuns: 0,
        },
        "fp-rio-exact",
        "raiderio",
      ),
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
      findMany: vi.fn(async () => [...evidenceRows.values()]),
    },
    characterScore: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        saved.push(create);
        return { id: `score-${saved.length}`, ...create };
      }),
    },
    season: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = seasons[where.id];
        if (!row) return null;
        return {
          id: row.id,
          regionId: row.regionId,
          slug: row.slug,
          blizzardSeasonId: row.blizzardSeasonId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
        };
      }),
      findMany: vi.fn(
        async (args?: {
          where?: {
            regionId?: string;
            startsAt?: { lt?: Date };
            blizzardSeasonId?: { not?: null };
          };
          orderBy?: { startsAt?: "asc" | "desc" };
          take?: number;
          select?: Record<string, boolean>;
        }) => {
          let rows = Object.values(seasons);
          if (args?.where?.regionId) {
            rows = rows.filter((r) => r.regionId === args.where!.regionId);
          }
          if (args?.where?.startsAt?.lt) {
            const lt = args.where.startsAt.lt.getTime();
            rows = rows.filter((r) => r.startsAt.getTime() < lt);
          }
          if (args?.where?.blizzardSeasonId?.not !== undefined) {
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
          // buildExperiencePhase1Result needs full season rows (incl. metadata).
          if (!args?.select) {
            return rows;
          }
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
      blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
      warcraftlogs: {},
      raiderio: {
        getSeasonCutoffs,
        getCharacterExactSeasonHistoricalRating,
      },
    },
    disabledProviders: new Set(),
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
    region: "EU",
    realm: "archimonde",
    characterName: "Wallidrixe",
    portsOverride: createMemoryOrchestrationPorts(),
    performanceAggregateProviderOverride: null as null,
  };

  return {
    container,
    scoringArgs,
    saved,
    evidenceRows,
    getMythicKeystoneSeasonProfile,
    getCharacterAchievements,
    getCharacterExactSeasonHistoricalRating,
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

describe("runAuthoritativeScoring Experience canonical replay + accounting", () => {
  it("A: provider-free replay reconstructs identical Experience with 0 historical calls", async () => {
    const cold = createHarness({ allowExperienceProviders: true });

    const coldResult = await runAuthoritativeScoring({
      ...cold.scoringArgs,
      container: cold.container,
    });

    expect(cold.getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(cold.getCharacterAchievements).toHaveBeenCalledTimes(1);
    expect(cold.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(cold.saved[0]!.experience).toBe(90);
    expect(coldResult.providerCalls).toBeGreaterThanOrEqual(2);

    const coldExp = experienceFromSaved(cold.saved[0]!);
    expect(coldExp.available).toBe(true);
    expect(coldExp.score).toBe(90);
    expect(cold.evidenceRows.size).toBeGreaterThan(0);

    // Replay on the same evidence store with providers forbidden (PR #84 skipped this path).
    cold.container.env.ALLOW_LIVE_PROVIDER_CALLS = false;
    cold.getMythicKeystoneSeasonProfile.mockClear();
    cold.getCharacterAchievements.mockClear();
    cold.getCharacterExactSeasonHistoricalRating.mockClear();

    const replayResult = await runAuthoritativeScoring({
      ...cold.scoringArgs,
      container: cold.container,
      portsOverride: createMemoryOrchestrationPorts(),
    });

    expect(cold.getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(cold.getCharacterAchievements).not.toHaveBeenCalled();
    expect(cold.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(replayResult.providerCalls).toBe(0);

    const replayExp = experienceFromSaved(cold.saved[1]!);
    expect(replayExp).toEqual(coldExp);
    expect(cold.saved[1]!.experience).toBe(90);
    expect(cold.saved[1]!.performance).toBe(cold.saved[0]!.performance);
    expect(cold.saved[1]!.survival).toBe(cold.saved[0]!.survival);
    expect(cold.saved[1]!.utility).toBe(cold.saved[0]!.utility);
  });

  it("B: cache miss with providers forbidden → explicit unavailable Experience; P/S/U still compute", async () => {
    const harness = createHarness({ allowExperienceProviders: false });

    const controlSaved: Array<Record<string, unknown>> = [];
    const controlContainer = {
      ...harness.container,
      prisma: {
        ...harness.container.prisma,
        characterScore: {
          upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
            controlSaved.push(create);
            return { id: `score-control-${controlSaved.length}`, ...create };
          }),
        },
      },
    } as unknown as WorkerContainer;

    await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: controlContainer,
      portsOverride: createMemoryOrchestrationPorts(),
      experienceOverride: null,
    });

    const result = await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
    });

    expect(harness.getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(harness.getCharacterAchievements).not.toHaveBeenCalled();
    expect(harness.getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
    expect(harness.evidenceRows.size).toBe(0);
    expect(harness.saved[0]!.experience).toBeNull();

    const exp = experienceFromSaved(harness.saved[0]!);
    expect(exp.available).toBe(false);
    expect(exp.score).toBeNull();
    expect(exp.reason).toBe("PREVIOUS_EVIDENCE_UNAVAILABLE");
    expect(exp.confidence).toBeNull();

    // Explicit unavailable Experience object (not a silent skip leaving dimensionDetails.experience null).
    expect(exp).not.toBeNull();
    expect(
      (controlSaved[0]!.dimensionDetails as { experience: unknown }).experience,
    ).toBeNull();

    expect(result.scoreResult?.characterScoreId).toMatch(/^score-/);
    expect(harness.saved[0]!.performance).toBe(controlSaved[0]!.performance);
    expect(harness.saved[0]!.survival).toBe(controlSaved[0]!.survival);
    expect(harness.saved[0]!.utility).toBe(controlSaved[0]!.utility);
    expect(harness.saved[0]!.composite).toBe(controlSaved[0]!.composite);
    expect(result.providerCalls).toBe(0);
  });

  it("C: Blizzard failure + exact RIO fallback is counted in providerCalls", async () => {
    const harness = createHarness({
      allowExperienceProviders: true,
      blizzardFails: true,
    });

    const result = await runAuthoritativeScoring({
      ...harness.scoringArgs,
      container: harness.container,
    });

    expect(harness.getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(harness.getCharacterExactSeasonHistoricalRating).toHaveBeenCalledTimes(1);
    expect(harness.getCharacterExactSeasonHistoricalRating).toHaveBeenCalledWith(
      { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      PREV_RIO_SLUG,
      expect.objectContaining({ region: "EU" }),
    );
    expect(harness.getCharacterAchievements).toHaveBeenCalledTimes(1);

    // previousSeasonProfile (1) + achievements (1) + RIO historical (1)
    expect(result.providerCalls).toBeGreaterThanOrEqual(3);

    const exp = experienceFromSaved(harness.saved[0]!);
    expect(exp.available).toBe(true);
    expect(exp.score).toBe(90);
    expect(harness.saved[0]!.experience).toBe(90);
  });
});
