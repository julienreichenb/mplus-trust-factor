/**
 * PostgreSQL integration for CharacterPerformanceAggregateRepository.
 *
 * Run:
 *   pnpm test:integration:shared -- packages/database/src/character-performance-aggregate.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  assertPersistedCharacterPerformanceAggregateV1,
  hashPerformanceAggregateContent,
  toPerformanceAggregatePartitionKey,
} from "@mplus/contracts";
import { PrismaClient } from "@prisma/client";
import {
  CharacterPerformanceAggregateRepository,
  checkDatabaseHealth,
} from "./index.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma = new PrismaClient();
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping CharacterPerformanceAggregate tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

function sampleCompact(overrides: Record<string, unknown> = {}) {
  return assertPersistedCharacterPerformanceAggregateV1({
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: "points_and_damage",
    zoneId: 47,
    partition: null,
    dungeonAggregates: [
      {
        dungeonSlug: "skyreach",
        dungeonName: "Skyreach",
        encounterId: 61209,
        bestParsePercentile: 90,
        medianParsePercentile: 80,
        loggedRunCount: 12,
        specialization: "Fire",
        keystoneLevel: 12,
        bestDps: 1_200_000,
      },
      {
        dungeonSlug: "pit-of-saron",
        dungeonName: "Pit of Saron",
        encounterId: 10658,
        bestParsePercentile: 70,
        medianParsePercentile: 65,
        loggedRunCount: 8,
        specialization: "Fire",
        keystoneLevel: 11,
        bestDps: 1_100_000,
      },
    ],
    global: {
      totalMythicPlusScore: 4000,
      totalLoggedRuns: 20,
      bestDpsPercentileAverage: 80,
      medianDpsPercentileAverage: 72.5,
      partition: null,
      zoneId: 47,
    },
    diagnostics: {
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: "points_and_damage",
      provenance: "AGGREGATE_ZONE_RANKINGS",
      availableDungeonCount: 2,
      expectedDungeonCount: 8,
      unavailableEncounters: [],
      wclBestPerformanceAverage: 80,
      wclMedianPerformanceAverage: 72.5,
      computedBestAverage: 80,
      computedMedianAverage: 72.5,
    },
    ...overrides,
  });
}

describe.runIf(dbAvailable)("CharacterPerformanceAggregateRepository", () => {
  const repo = new CharacterPerformanceAggregateRepository(prisma);
  let characterId: string;
  let seasonId: string;

  beforeAll(async () => {
    const region = await prisma.region.findUniqueOrThrow({ where: { code: "EU" } });
    const realm =
      (await prisma.realm.findFirst({ where: { regionId: region.id } })) ??
      (await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: `perf-agg-${randomUUID().slice(0, 6)}`,
          name: "Perf Agg Realm",
          timezone: "Europe/Paris",
        },
      }));
    const season =
      (await prisma.season.findFirst({ where: { regionId: region.id } })) ??
      (await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: `perf-agg-season-${randomUUID().slice(0, 6)}`,
          name: "Perf Agg Season",
          blizzardSeasonId: 999401,
          startsAt: new Date("2026-01-01"),
        },
      }));
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `perfa${randomUUID().slice(0, 8)}`,
        displayName: "PerfAgg",
        role: "DPS",
      },
    });
    characterId = character.id;
    seasonId = season.id;
  });

  it("creates and reads raw + normalized fields (Test C)", async () => {
    const compact = sampleCompact();
    const rawPayload = { metric: "points_and_damage", rankings: [{ id: 1 }] };
    const fetchedAt = new Date("2026-08-06T10:00:00.000Z");
    const expiresAt = new Date("2026-08-06T22:00:00.000Z");
    const fingerprint = "fp-create-read";

    const saved = await repo.upsert({
      characterId,
      seasonId,
      zoneId: 47,
      partition: null,
      rawPayload,
      compact,
      sourceRequestFingerprint: fingerprint,
      fetchedAt,
      expiresAt,
    });

    expect(saved.created).toBe(true);
    expect(saved.row.state).toBe("OK");
    expect(saved.row.rawPayload).toEqual(rawPayload);
    expect(saved.row.dungeonAggregates).toHaveLength(2);
    const skyreach = saved.row.dungeonAggregates.find(
      (d) => d.dungeonSlug === "skyreach",
    );
    expect(skyreach?.bestParsePercentile).toBe(90);
    expect(skyreach?.medianParsePercentile).toBe(80);
    expect(saved.row.globalSummary?.totalLoggedRuns).toBe(20);
    expect(saved.row.sourceRequestFingerprint).toBe(fingerprint);
    expect(saved.row.partitionKey).toBe("current");

    const live = await repo.findCompatibleLive({
      characterId,
      seasonId,
      zoneId: 47,
      partitionKey: toPerformanceAggregatePartitionKey(null),
      rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      now: new Date("2026-08-06T12:00:00.000Z"),
    });
    expect(live?.id).toBe(saved.row.id);
    expect(live?.contentHash).toBe(saved.row.contentHash);

    const expectedHash = hashPerformanceAggregateContent({
      rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: "points_and_damage",
      zoneId: 47,
      partitionKey: "current",
      rawPayload,
      dungeonAggregates: compact.dungeonAggregates,
      global: compact.global,
      diagnostics: compact.diagnostics,
      sourceRequestFingerprint: fingerprint,
    });
    expect(saved.row.contentHash).toBe(expectedHash);
  });

  it("idempotent refresh updates one row (Test D)", async () => {
    const compact = sampleCompact({
      dungeonAggregates: [
        {
          dungeonSlug: "skyreach",
          dungeonName: "Skyreach",
          encounterId: 61209,
          bestParsePercentile: 95,
          medianParsePercentile: 88,
          loggedRunCount: 14,
          specialization: "Fire",
          keystoneLevel: 13,
          bestDps: 1_300_000,
        },
      ],
    });
    const first = await repo.upsert({
      characterId,
      seasonId,
      zoneId: 47,
      partition: null,
      rawPayload: { v: 1 },
      compact: sampleCompact(),
      sourceRequestFingerprint: "fp-d-1",
      fetchedAt: new Date("2026-08-06T11:00:00.000Z"),
      expiresAt: new Date("2026-08-07T11:00:00.000Z"),
    });
    const second = await repo.upsert({
      characterId,
      seasonId,
      zoneId: 47,
      partition: null,
      rawPayload: { v: 2 },
      compact,
      sourceRequestFingerprint: "fp-d-2",
      fetchedAt: new Date("2026-08-06T12:00:00.000Z"),
      expiresAt: new Date("2026-08-07T12:00:00.000Z"),
    });

    expect(second.created).toBe(false);
    expect(second.updated).toBe(true);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.dungeonAggregates[0]?.bestParsePercentile).toBe(95);
    expect(second.row.rawPayload).toEqual({ v: 2 });

    const count = await prisma.characterPerformanceAggregate.count({
      where: { characterId, seasonId, zoneId: 47, partitionKey: "current" },
    });
    expect(count).toBe(1);
  });

  it("older fetch cannot overwrite newer evidence (Test E)", async () => {
    const newer = await repo.upsert({
      characterId,
      seasonId,
      zoneId: 47,
      partition: null,
      rawPayload: { newer: true },
      compact: sampleCompact({
        dungeonAggregates: [
          {
            dungeonSlug: "skyreach",
            dungeonName: "Skyreach",
            encounterId: 61209,
            bestParsePercentile: 99,
            medianParsePercentile: 90,
            loggedRunCount: 20,
            specialization: "Fire",
            keystoneLevel: 14,
            bestDps: 1_500_000,
          },
        ],
      }),
      sourceRequestFingerprint: "fp-newer",
      fetchedAt: new Date("2026-08-06T14:00:00.000Z"),
      expiresAt: new Date("2026-08-07T14:00:00.000Z"),
    });

    const older = await repo.upsert({
      characterId,
      seasonId,
      zoneId: 47,
      partition: null,
      rawPayload: { older: true },
      compact: sampleCompact({
        dungeonAggregates: [
          {
            dungeonSlug: "skyreach",
            dungeonName: "Skyreach",
            encounterId: 61209,
            bestParsePercentile: 10,
            medianParsePercentile: 10,
            loggedRunCount: 1,
            specialization: "Fire",
            keystoneLevel: 2,
            bestDps: 100,
          },
        ],
      }),
      sourceRequestFingerprint: "fp-older",
      fetchedAt: new Date("2026-08-06T13:00:00.000Z"),
      expiresAt: new Date("2026-08-07T13:00:00.000Z"),
    });

    expect(older.rejectedStale).toBe(true);
    expect(older.updated).toBe(false);
    expect(older.row.contentHash).toBe(newer.row.contentHash);
    expect(older.row.dungeonAggregates[0]?.bestParsePercentile).toBe(99);
    expect(older.row.rawPayload).toEqual({ newer: true });
  });

  it("expired live miss vs replay hit", async () => {
    const expiresAt = new Date("2026-08-01T00:00:00.000Z");
    await repo.upsert({
      characterId,
      seasonId,
      zoneId: 48,
      partition: 1,
      rawPayload: { zone: 48 },
      compact: sampleCompact({ zoneId: 48, partition: 1 }),
      sourceRequestFingerprint: "fp-expired",
      fetchedAt: new Date("2026-07-31T00:00:00.000Z"),
      expiresAt,
    });

    const live = await repo.findCompatibleLive({
      characterId,
      seasonId,
      zoneId: 48,
      partitionKey: "partition:1",
      rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      now: new Date("2026-08-06T00:00:00.000Z"),
    });
    expect(live).toBeNull();

    const replay = await repo.findCompatibleForReplay({
      characterId,
      seasonId,
      zoneId: 48,
      partitionKey: "partition:1",
      rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    });
    expect(replay).not.toBeNull();
    expect(replay?.zoneId).toBe(48);
  });

  it("version-incompatible rows are not reused", async () => {
    await prisma.characterPerformanceAggregate.create({
      data: {
        characterId,
        seasonId,
        zoneId: 49,
        partitionKey: "current",
        rankingVersion: "points-and-damage-v0",
        metric: "points_and_damage",
        state: "OK",
        rawPayload: {},
        dungeonAggregates: [],
        diagnostics: {},
        contentHash: "legacy",
        sourceRequestFingerprint: "legacy",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const live = await repo.findCompatibleLive({
      characterId,
      seasonId,
      zoneId: 49,
      partitionKey: "current",
      rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      now: new Date(),
    });
    expect(live).toBeNull();

    const replay = await repo.findCompatibleForReplay({
      characterId,
      seasonId,
      zoneId: 49,
      partitionKey: "current",
      rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    });
    expect(replay).toBeNull();
  });
});
