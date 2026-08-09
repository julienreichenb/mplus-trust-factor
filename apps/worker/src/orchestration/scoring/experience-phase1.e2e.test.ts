/**
 * Experience Phase 1 product-boundary E2E (fixture-backed):
 * season metadata → previous Blizzard rating → persisted policy standing →
 * elite titles → ExperiencePhase1Result → CharacterScore + composite.
 *
 * Asserts zero per-character Raider.IO cutoff calls and zero WCL calls for Experience.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  BlizzardCharacterAchievementsDTO,
  EvidenceCandidateMetadataV2,
  ProviderResult,
  RaiderIoCutoffThreshold,
  RaiderIoSeasonCutoffs,
} from "@mplus/contracts";
import {
  buildSeasonPopulationPolicy,
  estimatePreviousSeasonStanding,
} from "@mplus/scoring";
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
const ELITE_ACHIEVEMENT_ID = 20_589; // Tempered Hero: TWW S1

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
      cacheHit: true,
      retryCount: 0,
      costUnits: 1,
      etag: null,
      expiresAt: null,
    },
  };
}

describe("Experience Phase 1 end-to-end (fixture)", () => {
  it("hydrated seasons → standing + elite → persisted Experience in composite; no RIO cutoffs / WCL", async () => {
    const policyDoc = completePolicyDoc();
    const seasons = {
      [CURRENT_SEASON_ID]: {
        id: CURRENT_SEASON_ID,
        regionId: REGION_ID,
        slug: "blizzard-season-15",
        blizzardSeasonId: 15,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: null as Date | null,
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

    // Checklist: seasons have startsAt, endsAt, providerSeasonId; previous has policy.
    expect(seasons[CURRENT_SEASON_ID]!.startsAt).toBeTruthy();
    expect(seasons[PREV_SEASON_ID]!.startsAt).toBeTruthy();
    expect(seasons[PREV_SEASON_ID]!.endsAt).toBeTruthy();
    expect(seasons[CURRENT_SEASON_ID]!.providerSeasonId).toBe(CURRENT_RIO_SLUG);
    expect(seasons[PREV_SEASON_ID]!.providerSeasonId).toBe(PREV_RIO_SLUG);
    expect(
      seasons[PREV_SEASON_ID]!.metadata[EXPERIENCE_POPULATION_POLICY_METADATA_KEY],
    ).toBeTruthy();

    const standing = estimatePreviousSeasonStanding(PREV_RATING, policyDoc.policy);
    expect(standing.ok).toBe(true);
    if (!standing.ok) throw new Error("standing");
    expect(standing.standing.nativeBand).toBe("p900");
    expect(standing.standing.standingScore).toBe(75);
    expect(standing.standing.estimatedTopPercent).toBeNull();
    const expectedPreviousStandingScore = standing.standing.standingScore;
    expect(expectedPreviousStandingScore).toBe(75);
    // Elite floor raises final Experience to 90.
    const expectedExperienceScore = 90;

    const getMythicKeystoneSeasonProfile = vi.fn(async (_identity, seasonId: number) => {
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
              // Non-elite Keystone Hero — must not count.
              { achievementId: 20_526, completedAt: "2025-02-01T00:00:00.000Z" },
            ],
          },
          "fp-achievements",
        ),
    );

    const getSeasonCutoffs = vi.fn(async () => {
      throw new Error("Experience must not call Raider.IO cutoffs per character");
    });
    const fetchCharacterPerformanceAggregate = vi.fn(async () => {
      throw new Error("Experience path must not trigger WCL aggregate fetch");
    });

    const saved: Array<Record<string, unknown>> = [];
    const baselineSaved: Array<Record<string, unknown>> = [];

    const evidenceRows = new Map<string, Record<string, unknown>>();
    const evidenceKey = (row: {
      characterId: string;
      seasonId: string;
      evidenceKind: string;
      compatibilityVersion: string;
    }) =>
      `${row.characterId}|${row.seasonId}|${row.evidenceKind}|${row.compatibilityVersion}`;

    const basePrisma = {
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
      season: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const row = seasons[where.id];
          if (!row) return null;
          const { metadata: _m, isCurrent: _c, providerSeasonId: _p, ...rest } = row;
          return rest;
        }),
        findMany: vi.fn(async () => Object.values(seasons)),
      },
    };

    const makeContainer = (
      scoreSink: Array<Record<string, unknown>>,
      experienceEnabled: boolean,
    ): WorkerContainer =>
      ({
        env: {
          SCORING_ENABLED: true,
          SCORING_PUBLICATION_ENABLED: false,
          ALLOW_LIVE_PROVIDER_CALLS: experienceEnabled,
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
        prisma: {
          ...basePrisma,
          characterScore: {
            upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
              scoreSink.push(create);
              return { id: `score-${scoreSink.length}`, ...create };
            }),
          },
        },
        providers: {
          blizzard: { getMythicKeystoneSeasonProfile, getCharacterAchievements },
          warcraftlogs: {
            fetchCharacterPerformanceAggregate,
          },
          raiderio: { getSeasonCutoffs },
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
      }) as unknown as WorkerContainer;

    const ports = createMemoryOrchestrationPorts();
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
      portsOverride: ports,
      performanceAggregateProviderOverride: null,
    };

    // Baseline: providers forbidden, no persisted evidence → explicit unavailable Experience.
    await runAuthoritativeScoring({
      ...scoringArgs,
      container: makeContainer(baselineSaved, false),
    });
    expect(getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
    expect(getCharacterAchievements).not.toHaveBeenCalled();
    expect(baselineSaved[0]!.experience).toBeNull();
    const baselineExp = (
      baselineSaved[0]!.dimensionDetails as {
        experience: { available: boolean; score: number | null; reason: string | null };
      }
    ).experience;
    expect(baselineExp.available).toBe(false);
    expect(baselineExp.score).toBeNull();
    expect(baselineExp.reason).toBe("PREVIOUS_EVIDENCE_UNAVAILABLE");

    // Full Experience path (fixture + ALLOW_LIVE_PROVIDER_CALLS).
    const result = await runAuthoritativeScoring({
      ...scoringArgs,
      container: makeContainer(saved, true),
    });

    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledTimes(1);
    expect(getMythicKeystoneSeasonProfile).toHaveBeenCalledWith(
      { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      14,
      expect.objectContaining({ region: "EU" }),
    );
    expect(getCharacterAchievements).toHaveBeenCalledTimes(1);
    expect(getSeasonCutoffs).not.toHaveBeenCalled();
    expect(fetchCharacterPerformanceAggregate).not.toHaveBeenCalled();

    expect(result.scoreResult?.characterScoreId).toMatch(/^score-/);
    expect(saved[0]!.experience).toBe(expectedExperienceScore);

    const details = saved[0]!.dimensionDetails as {
      experience: {
        score: number;
        available: boolean;
        previousStandingScore: number;
        eliteFloorApplied: boolean;
        confirmedEliteTitleCount: number;
        reason: null;
      };
      partialComposite: {
        availableCount: number;
        effectiveWeights: Record<string, number>;
        composite: number | null;
      };
    };

    expect(details.experience.available).toBe(true);
    expect(details.experience.score).toBe(expectedExperienceScore);
    expect(details.experience.previousStandingScore).toBeCloseTo(
      expectedPreviousStandingScore,
      5,
    );
    expect(details.experience.eliteFloorApplied).toBe(true);
    expect(details.experience.confirmedEliteTitleCount).toBe(1);
    expect(details.partialComposite.effectiveWeights.experience).toBeGreaterThan(0);
    expect(details.partialComposite.availableCount).toBeGreaterThan(
      (baselineSaved[0]!.dimensionDetails as { partialComposite: { availableCount: number } })
        .partialComposite.availableCount,
    );

    // Experience changes composite; P/S/U unchanged.
    expect(saved[0]!.composite).not.toBe(baselineSaved[0]!.composite);
    expect(saved[0]!.performance).toBe(baselineSaved[0]!.performance);
    expect(saved[0]!.survival).toBe(baselineSaved[0]!.survival);
    expect(saved[0]!.utility).toBe(baselineSaved[0]!.utility);

    // WCL gate stays off; Experience Blizzard calls are counted separately on bridge.
    expect(result.providerCalls).toBeGreaterThanOrEqual(2);
  });
});
