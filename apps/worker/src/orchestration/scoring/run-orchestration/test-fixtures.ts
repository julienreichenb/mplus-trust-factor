/**
 * Shared fixtures for provider-free orchestration / scoreCharacter tests.
 */
import {
  CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  hashPerformanceAggregateContentV2,
  toPerformanceAggregateDbColumnsV2,
  toPerformanceAggregatePartitionKey,
  type PersistedCharacterPerformanceAggregateV2,
} from "@mplus/contracts";
import type { PerformanceThroughputChannelFact } from "@mplus/scoring";

export function buildTestThroughputChannels(
  dungeonSlugs: readonly string[],
  options?: {
    bestParsePercentile?: number;
    medianParsePercentile?: number;
  },
): {
  damage: PerformanceThroughputChannelFact;
  healing: PerformanceThroughputChannelFact | null;
} {
  const best = options?.bestParsePercentile ?? 80;
  const median = options?.medianParsePercentile ?? 70;
  const perDungeon = dungeonSlugs.map((dungeonSlug) => ({
    dungeonSlug,
    bestParsePercentile: best,
    medianParsePercentile: median,
    specialization: "Fire",
    bestThroughputAmount: 1_000_000,
  }));
  return {
    damage: {
      kind: "damage",
      metric: "points_and_damage",
      perDungeon,
      bestPercentileAverage: best,
      medianPercentileAverage: median,
      partition: null,
      zoneId: 47,
      totalLoggedRuns: dungeonSlugs.length * 4,
      observedSpecs: ["Fire"],
      specBinding: "EXACT_MATCH",
    },
    healing: null,
  };
}

export function buildTestPerformanceAggregateV2(
  dungeonSlugs: readonly string[],
  options?: {
    role?: "DPS" | "TANK" | "HEALER";
    targetSpecSlug?: string;
    bestParsePercentile?: number;
    medianParsePercentile?: number;
  },
): PersistedCharacterPerformanceAggregateV2 {
  const role = options?.role ?? "DPS";
  const targetSpecSlug = options?.targetSpecSlug ?? "fire";
  const best = options?.bestParsePercentile ?? 80;
  const median = options?.medianParsePercentile ?? 70;
  const dungeonAggregates = dungeonSlugs.map((slug) => ({
    dungeonSlug: slug,
    dungeonName: slug,
    encounterId: 1,
    bestParsePercentile: best,
    medianParsePercentile: median,
    loggedRunCount: 4,
    specialization: "Fire",
    keystoneLevel: 12,
    bestDps: 1_000_000,
  }));
  return {
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    role,
    targetSpecSlug,
    zoneId: 47,
    partition: null,
    damage: {
      metric: "points_and_damage",
      dungeonAggregates,
      bestPercentileAverage: best,
      medianPercentileAverage: median,
      totalLoggedRuns: dungeonSlugs.length * 4,
      totalMythicPlusScore: 3000,
      partition: null,
      zoneId: 47,
      observedSpecs: ["Fire"],
      specBinding: "EXACT_MATCH",
      wclBestPerformanceAverage: best,
      wclMedianPerformanceAverage: median,
    },
    healing: null,
    diagnostics: {
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      provenance: "AGGREGATE_ZONE_RANKINGS",
      role,
      targetSpecSlug,
      damageDungeonCount: dungeonSlugs.length,
      healingDungeonCount: 0,
      expectedDungeonCount: dungeonSlugs.length,
      specBindingPolicy: "test",
      limitations: [],
    },
  };
}

export function buildTestEnsurePerformanceAggregateResult(input: {
  characterId: string;
  seasonId: string;
  dungeonSlugs: readonly string[];
  role?: "DPS" | "TANK" | "HEALER";
  targetSpecSlug?: string;
}) {
  const compact = buildTestPerformanceAggregateV2(input.dungeonSlugs, {
    role: input.role,
    targetSpecSlug: input.targetSpecSlug,
  });
  const cols = toPerformanceAggregateDbColumnsV2(compact);
  const sourceRequestFingerprint = "test-aggregate-fingerprint";
  const contentHash = hashPerformanceAggregateContentV2({
    rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    zoneId: 47,
    partitionKey: toPerformanceAggregatePartitionKey(null),
    compact,
    sourceRequestFingerprint,
  });
  return async () =>
    ({
      state: "AVAILABLE" as const,
      data: {
        id: "agg-test-1",
        characterId: input.characterId,
        seasonId: input.seasonId,
        zoneId: 47,
        partitionKey: "current",
        rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
        metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
        state: "OK" as const,
        rawPayload: {},
        dungeonAggregates: cols.dungeonAggregates,
        globalSummary: cols.globalSummary,
        diagnostics: cols.diagnostics,
        compact,
        contentHash,
        sourceRequestFingerprint,
        fetchedAt: new Date(),
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      reason: null,
      cache: "HIT" as const,
      providerCalls: 0,
      created: false,
      updated: false,
      aggregateRowId: "agg-test-1",
      contentHash,
    }) as const;
}

/** Warm DB row for prisma.characterPerformanceAggregate.findUnique in canary tests. */
export function buildTestPerformanceAggregateDbRow(input: {
  characterId: string;
  characterName?: string;
  seasonId: string;
  dungeonSlugs: readonly string[];
  role?: "DPS" | "TANK" | "HEALER";
  targetSpecSlug?: string;
}) {
  const compact = buildTestPerformanceAggregateV2(input.dungeonSlugs, {
    role: input.role,
    targetSpecSlug: input.targetSpecSlug,
  });
  const cols = toPerformanceAggregateDbColumnsV2(compact);
  const sourceRequestFingerprint = "test-aggregate-fingerprint";
  const contentHash = hashPerformanceAggregateContentV2({
    rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    zoneId: 47,
    partitionKey: toPerformanceAggregatePartitionKey(null),
    compact,
    sourceRequestFingerprint,
  });
  return {
    id: "agg-test-canary",
    characterId: input.characterId,
    characterName: input.characterName ?? "Target",
    seasonId: input.seasonId,
    zoneId: 47,
    partitionKey: "current",
    rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    state: "OK" as const,
    rawPayload: {},
    dungeonAggregates: cols.dungeonAggregates,
    globalSummary: cols.globalSummary,
    diagnostics: cols.diagnostics,
    contentHash,
    sourceRequestFingerprint,
    fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    compact,
  };
}
