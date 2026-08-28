/**
 * Agent 03 — real Prisma CharacterExperienceEvidence round-trip + canonical
 * provider-free reconstruction (disposable/isolated DB via pnpm test / integration).
 *
 * Not an in-memory Map "process restart" proof: create client → persist →
 * disconnect → new client → runAuthoritativeScoring with providers forbidden.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type {
  EvidenceCandidateMetadataV2,
  RaiderIoCutoffThreshold,
  RaiderIoSeasonCutoffs,
} from "@mplus/contracts";
import {
  checkDatabaseHealth,
  createCharacterExperienceEvidenceRepository,
  createPrismaClient,
  EXPERIENCE_EVIDENCE_KIND,
  EXPERIENCE_EVIDENCE_SOURCE,
  EXPERIENCE_EVIDENCE_STATE,
  EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
  type PrismaClient,
} from "@mplus/database";
import { buildSeasonPopulationPolicy, NATIVE_BAND_STANDING_SCORES } from "@mplus/scoring";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import type { WorkerContainer } from "../../container.js";
import {
  hashExperienceEvidencePayload,
  type PersistedPreviousSeasonRatingPayloadV1,
} from "./experience-evidence-persist.js";
import {
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  hashSeasonPopulationPolicyContent,
} from "./experience-season-population-policy-metadata.js";
import { runAuthoritativeScoring } from "./refresh-bridge.js";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

let prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping Agent 03 Experience Prisma persistence: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

function threshold(
  score: number,
  quantile: RaiderIoCutoffThreshold["quantile"],
  label: RaiderIoCutoffThreshold["label"],
): RaiderIoCutoffThreshold {
  return { score, quantile, label };
}

function policyMetadata(seasonSlug: string) {
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
  if (!built.ok) throw new Error(built.reason);
  return {
    schemaVersion: "experience-population-policy-store-v2" as const,
    policy: built.policy,
    raiderIoSeasonSlug: seasonSlug,
    policyContentHash: hashSeasonPopulationPolicyContent(built.policy),
    sourceRequestFingerprint: "fp-agent03-prisma",
    sourcePayloadId: null,
    sourceFetchedAt: "2026-01-01T00:00:00.000Z",
    synchronizedAt: "2026-01-01T00:00:01.000Z",
    lastKnownGood: true,
  };
}

function candidates(dungeonSlug: string): EvidenceCandidateMetadataV2[] {
  return [1, 2].flatMap((fightId) => [
    {
      discoveryIdentity: { reportCode: `A03${fightId}A`, fightId },
      reportRevision: 1,
      dungeonSlug,
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
      discoverySource: "agent03",
    },
    {
      discoveryIdentity: { reportCode: `A03${fightId}B`, fightId: fightId + 10 },
      reportRevision: 1,
      dungeonSlug,
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
      discoverySource: "agent03",
    },
  ]);
}

// Eight dungeons × 2 candidates required by active-season-eight selection.
const DUNGEON_SLUGS = [
  "ara-kara",
  "city-of-threads",
  "the-dawnbreaker",
  "the-stonevault",
  "mists-of-tirna-scithe",
  "the-necrotic-wake",
  "siege-of-boralus",
  "grim-batol",
];

describe.runIf(dbAvailable)(
  "Agent 03 — Prisma Experience evidence restart + canonical replay",
  () => {
    it("persists rating via repository, recreates Prisma client, reconstructs E with 0 historical calls", async () => {
      const suffix = randomUUID().slice(0, 8);
      const region =
        (await prisma.region.findFirst({ where: { code: "EU" } })) ??
        (await prisma.region.create({
          data: {
            id: randomUUID(),
            code: `A3${suffix}`.slice(0, 8).toUpperCase(),
            apiHost: "eu.api.blizzard.com",
            localeDefault: "en_GB",
          },
        }));

      const realm =
        (await prisma.realm.findFirst({
          where: { regionId: region.id, slug: `a03-${suffix}` },
        })) ??
        (await prisma.realm.create({
          data: {
            id: randomUUID(),
            regionId: region.id,
            slug: `a03-${suffix}`,
            name: `Agent03 ${suffix}`,
          },
        }));

      const character = await prisma.character.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          realmId: realm.id,
          normalizedName: `a03char${suffix}`,
          displayName: `A03Char${suffix}`,
          role: "DPS",
        },
      });

      const prevRio = `season-a03-prev-${suffix}`;
      const curRio = `season-a03-cur-${suffix}`;
      const blizzardPrev = 91_014;
      const blizzardCur = 91_015;

      const previousSeason = await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: `blizzard-season-${blizzardPrev}`,
          name: `A03 Prev ${suffix}`,
          blizzardSeasonId: blizzardPrev,
          providerSeasonId: prevRio,
          startsAt: new Date("2025-06-01T00:00:00.000Z"),
          endsAt: new Date("2025-12-01T00:00:00.000Z"),
          isCurrent: false,
          metadata: {
            [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyMetadata(prevRio),
          },
        },
      });

      const currentSeason = await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: `blizzard-season-${blizzardCur}`,
          name: `A03 Cur ${suffix}`,
          blizzardSeasonId: blizzardCur,
          providerSeasonId: curRio,
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: null,
          isCurrent: true,
          metadata: {},
        },
      });

      const scoreModel = await prisma.scoreModel.create({
        data: {
          id: randomUUID(),
          key: `a03-exp-${suffix}`,
          version: 1,
          name: "a03-experience",
          status: "DRAFT",
          config: {},
        },
      });

      const payload: PersistedPreviousSeasonRatingPayloadV1 = {
        schemaVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
        state: "HAS_VALUE",
        rating: 3000,
        ratingSource: "BLIZZARD",
        internalSeasonId: previousSeason.id,
        seasonSlug: previousSeason.slug,
        blizzardSeasonId: blizzardPrev,
        raiderIoSeasonSlug: prevRio,
      };

      const storeWrite = createCharacterExperienceEvidenceRepository(prisma);
      const { created } = await storeWrite.upsertImmutable({
        characterId: character.id,
        seasonId: previousSeason.id,
        evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
        compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
        blizzardSeasonId: blizzardPrev,
        raiderIoSeasonSlug: prevRio,
        state: EXPERIENCE_EVIDENCE_STATE.HAS_VALUE,
        source: EXPERIENCE_EVIDENCE_SOURCE.BLIZZARD,
        payload,
        contentHash: hashExperienceEvidencePayload(payload),
        fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      expect(created).toBe(true);

      // Dispose / recreate Prisma client (real restart boundary).
      await prisma.$disconnect();
      prisma = createPrismaClient(databaseUrl);

      const getMythicKeystoneSeasonProfile = vi.fn(async () => {
        throw new Error("historical Blizzard must not run");
      });
      const getCharacterAchievements = vi.fn(async () => {
        throw new Error("achievements must not run when providers are forbidden");
      });
      const getCharacterExactSeasonHistoricalRating = vi.fn(async () => {
        throw new Error("historical RIO must not run");
      });

      const container = {
        env: {
          SCORING_ENABLED: true,
          SCORING_PUBLICATION_ENABLED: false,
          ALLOW_LIVE_PROVIDER_CALLS: false,
          PROVIDER_MODE: "fixture",
          WCL_ENABLED: false,
          BLIZZARD_ENABLED: true,
          WCL_CHARACTER_TTL_SECONDS: 43_200,
          APP_ENV: "test",
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
            getSeasonCutoffs: vi.fn(async () => {
              throw new Error("cutoffs must not run");
            }),
            getCharacterExactSeasonHistoricalRating,
          },
        },
        disabledProviders: new Set<string>(),
        repositories: {
          artifacts: {},
          evidence: {},
          externalRequest: {
            recordRequestAndPayload: vi.fn(async () => ({
              payload: { id: randomUUID() },
            })),
          },
        },
        createRedisConnection: vi.fn(),
      } as unknown as WorkerContainer;

      // scoreCharacter still upserts via prisma.characterScore — use real DB.
      const allCandidates = DUNGEON_SLUGS.flatMap((slug) => candidates(slug));

      const result = await runAuthoritativeScoring({
        characterId: character.id,
        seasonId: currentSeason.id,
        seasonSlug: currentSeason.slug,
        role: "DPS",
        classSlug: "mage",
        specSlug: "fire",
        refreshContract: {
          scoringModelKey: scoreModel.key,
          scoringModelVersion: 1,
          observationSchemaVersion: "observations-v2",
          wclAdapterVersion: "points-and-damage-v1",
          blizzardAdapterVersion: "blizzard-v1",
          raiderIoAdapterVersion: "raiderio-v1",
          runSelectionVersion: "active-season-eight-v1",
          abilityCatalogVersion: "abilities-v1",

          abilityCatalogExecutionKey: "static:abilities-v1",
          mechanicCatalogVersion: "mechanics-v1",
          activeSeasonId: currentSeason.slug,
          zoneId: 47,
          partition: null,
        },
        evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
        highKeyPolicyId: "policy-1",
        activeDungeonSlugs: DUNGEON_SLUGS,
        candidates: allCandidates,
        scoreModelKey: scoreModel.key,
        scoreModelVersion: 1,
        scoreModelId: scoreModel.id,
        calculatedAt: "2026-01-01T00:00:00.000Z",
        region: "EU",
        realm: realm.slug,
        characterName: character.displayName,
        portsOverride: createMemoryOrchestrationPorts(),
        performanceAggregateProviderOverride: null,
        container,
      });

      expect(getMythicKeystoneSeasonProfile).not.toHaveBeenCalled();
      expect(getCharacterExactSeasonHistoricalRating).not.toHaveBeenCalled();
      expect(result.providerCalls).toBe(0);

      const score = await prisma.characterScore.findFirst({
        where: { characterId: character.id, seasonId: currentSeason.id },
        orderBy: { calculatedAt: "desc" },
      });
      expect(score).not.toBeNull();
      expect(score!.experience).toBe(NATIVE_BAND_STANDING_SCORES.p990);

      const details = score!.dimensionDetails as {
        experience: { available: boolean; score: number | null };
      };
      expect(details.experience.available).toBe(true);
      expect(details.experience.score).toBe(NATIVE_BAND_STANDING_SCORES.p990);

      // Repository re-read after client recreation.
      const storeRead = createCharacterExperienceEvidenceRepository(prisma);
      const row = await storeRead.find({
        characterId: character.id,
        seasonId: previousSeason.id,
        evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
        compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
      });
      expect(row).not.toBeNull();
      expect(row!.blizzardSeasonId).toBe(blizzardPrev);
      expect(row!.raiderIoSeasonSlug).toBe(prevRio);
    });
  },
);
