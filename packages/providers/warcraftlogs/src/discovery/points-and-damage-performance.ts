import {
  mergePointsAndDamage,
  normalizePointsAndDamage,
  type NormalizedPointsAndDamage,
} from "../probe/performance-probe-logic.js";
import type { WclDungeonPerformanceAggregate } from "../types.js";

/**
 * Production Performance from Character.zoneRankings metric:points_and_damage.
 * Throughput Best%/Median%/DPS come from throughputRankings only.
 * WCL does not expose throughputSampleCount on this payload — confidence uses displayedRunCount.
 */

export type PointsAndDamagePerformanceState =
  | "OK"
  | "ERROR"
  | "SCHEMA_UNSUPPORTED"
  | "SKIPPED"
  | "EMPTY";

export interface PointsAndDamageUnavailableEncounter {
  encounterID: number;
  encounterName: string | null;
  dungeonSlug: string | null;
  reason: "no_score_row" | "no_throughput_row" | "no_zone_rankings_row";
}

export interface PointsAndDamagePerformanceDiagnostics {
  metric: "points_and_damage";
  provenance: "AGGREGATE_ZONE_RANKINGS";
  /** Score calibration fields kept for later; not used in Performance score. */
  ratingPointsExcludedFromScore: true;
  keystoneLevelExcludedFromScore: true;
  scoreRankPercentExcludedFromScore: true;
  /** WCL points_and_damage throughput rows do not provide a sample size today. */
  throughputSampleCountUnavailable: true;
  availableDungeonCount: number;
  expectedDungeonCount: number | null;
  payloadTopKeys: string[];
  unavailableEncounters: PointsAndDamageUnavailableEncounter[];
  wclBestPerformanceAverage: number | null;
  wclMedianPerformanceAverage: number | null;
  computedBestAverage: number | null;
  computedMedianAverage: number | null;
  errorMessage?: string;
}

export interface PointsAndDamagePerformanceRecord {
  state: PointsAndDamagePerformanceState;
  /** Complete raw zoneRankings JSON (audit / ExternalPayload). */
  raw: unknown;
  dungeonAggregates: WclDungeonPerformanceAggregate[];
  normalized: NormalizedPointsAndDamage | null;
  global: {
    totalMythicPlusScore: number | null;
    totalLoggedRuns: number;
    bestDpsPercentileAverage: number | null;
    medianDpsPercentileAverage: number | null;
    partition: number | null;
    zoneId: number | null;
    specRanks: NormalizedPointsAndDamage["specRanks"];
    itemLevelFilter: NormalizedPointsAndDamage["itemLevelFilter"];
  } | null;
  diagnostics: PointsAndDamagePerformanceDiagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * True when payload looks like points_and_damage (rankings + throughputRankings or explicit metric).
 * Wrong metric / missing throughput map → SCHEMA_UNSUPPORTED (never fabricate empty OK).
 */
export function isPointsAndDamageSchema(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const metric = typeof raw.metric === "string" ? raw.metric : null;
  if (metric != null && metric !== "points_and_damage") return false;
  const hasThroughputMap =
    isRecord(raw.throughputRankings) || Array.isArray(raw.throughputRankings);
  const hasRankings = Array.isArray(raw.rankings);
  if (metric === "points_and_damage") return hasRankings || hasThroughputMap;
  // Unlabeled payload: require both score rankings and throughputRankings.
  return hasRankings && hasThroughputMap;
}

function emptyDiagnostics(
  overrides: Partial<PointsAndDamagePerformanceDiagnostics> = {},
): PointsAndDamagePerformanceDiagnostics {
  return {
    metric: "points_and_damage",
    provenance: "AGGREGATE_ZONE_RANKINGS",
    ratingPointsExcludedFromScore: true,
    keystoneLevelExcludedFromScore: true,
    scoreRankPercentExcludedFromScore: true,
    throughputSampleCountUnavailable: true,
    availableDungeonCount: 0,
    expectedDungeonCount: null,
    payloadTopKeys: [],
    unavailableEncounters: [],
    wclBestPerformanceAverage: null,
    wclMedianPerformanceAverage: null,
    computedBestAverage: null,
    computedMedianAverage: null,
    ...overrides,
  };
}

export function adaptPointsAndDamagePerformance(input: {
  raw: unknown;
  expectedDungeonCount?: number | null;
  expectedEncounterIds?: number[];
}): PointsAndDamagePerformanceRecord {
  const expectedDungeonCount = input.expectedDungeonCount ?? null;
  const raw = input.raw;

  if (raw == null) {
    return {
      state: "EMPTY",
      raw: null,
      dungeonAggregates: [],
      normalized: null,
      global: null,
      diagnostics: emptyDiagnostics({
        expectedDungeonCount,
        errorMessage: "points_and_damage zoneRankings payload was null",
      }),
    };
  }

  if (!isPointsAndDamageSchema(raw)) {
    return {
      state: "SCHEMA_UNSUPPORTED",
      raw,
      dungeonAggregates: [],
      normalized: null,
      global: null,
      diagnostics: emptyDiagnostics({
        expectedDungeonCount,
        payloadTopKeys: isRecord(raw) ? Object.keys(raw) : [],
        errorMessage:
          "points_and_damage schema unsupported: expected metric points_and_damage with rankings/throughputRankings",
      }),
    };
  }

  const normalized = normalizePointsAndDamage(raw);
  const merged = mergePointsAndDamage(normalized);

  // Valid dungeon rows: at least one execution percentile (never zero-fill missing).
  const validDungeons = merged.dungeons.filter(
    (d) =>
      (d.bestExecutionPercentile != null && Number.isFinite(d.bestExecutionPercentile)) ||
      (d.medianExecutionPercentile != null && Number.isFinite(d.medianExecutionPercentile)),
  );

  const dungeonAggregates: WclDungeonPerformanceAggregate[] = validDungeons.map((d) => ({
    dungeonSlug: d.dungeonSlug ?? (d.encounterName ? d.encounterName : "unknown"),
    dungeonName: d.encounterName ?? d.dungeonSlug ?? "unknown",
    encounterId: d.encounterId,
    bestParsePercentile: d.bestExecutionPercentile,
    medianParsePercentile: d.medianExecutionPercentile,
    loggedRunCount: d.displayedRunCount,
    specSlug: d.specialization,
    roleSlug: null,
    keystoneLevel: d.keystoneLevel,
    throughputBracket: d.throughputBracket,
    ratingPoints: d.ratingPoints,
    scoreRank: d.scoreRank,
    regionRank: d.regionRank,
    serverRank: d.serverRank,
    scoreRankPercent: d.scoreRankPercent,
    specialization: d.specialization,
    bestDps: d.bestDps,
    completion: d.completion,
  }));

  const expectedIds = input.expectedEncounterIds ?? [];
  const scoreIds = new Set(
    normalized.scoreDungeons.map((d) => d.encounterId).filter((id): id is number => id != null),
  );
  const throughputIds = new Set(
    normalized.throughputDungeons
      .map((d) => d.encounterId)
      .filter((id): id is number => id != null),
  );
  const unavailableEncounters: PointsAndDamageUnavailableEncounter[] = [];
  for (const encounterID of expectedIds) {
    const hasScore = scoreIds.has(encounterID);
    const hasThroughput = throughputIds.has(encounterID);
    if (hasScore && hasThroughput) continue;
    const score = normalized.scoreDungeons.find((d) => d.encounterId === encounterID);
    const throughput = normalized.throughputDungeons.find((d) => d.encounterId === encounterID);
    unavailableEncounters.push({
      encounterID,
      encounterName: score?.encounterName ?? throughput?.encounterName ?? null,
      dungeonSlug: score?.dungeonSlug ?? throughput?.dungeonSlug ?? null,
      reason: !hasScore && !hasThroughput
        ? "no_zone_rankings_row"
        : !hasScore
          ? "no_score_row"
          : "no_throughput_row",
    });
  }

  // Reject Icecrown / junk if present without valid percentiles (already filtered via validDungeons).
  const withoutIcecrown = dungeonAggregates.filter(
    (d) => !d.dungeonSlug.toLowerCase().includes("icecrown"),
  );

  return {
    state: "OK",
    raw,
    dungeonAggregates: withoutIcecrown,
    normalized,
    global: {
      totalMythicPlusScore: merged.global.totalMythicPlusScore,
      totalLoggedRuns: merged.global.totalLoggedRuns,
      bestDpsPercentileAverage: merged.global.bestDpsPercentileAverage,
      medianDpsPercentileAverage: merged.global.medianDpsPercentileAverage,
      partition: merged.global.partition,
      zoneId: merged.global.zoneId,
      specRanks: merged.global.specRanks,
      itemLevelFilter: merged.global.itemLevelFilter,
    },
    diagnostics: emptyDiagnostics({
      expectedDungeonCount,
      availableDungeonCount: withoutIcecrown.length,
      payloadTopKeys: normalized.payloadTopKeys,
      unavailableEncounters,
      wclBestPerformanceAverage: merged.global.wclBestPerformanceAverage,
      wclMedianPerformanceAverage: merged.global.wclMedianPerformanceAverage,
      computedBestAverage: merged.global.bestDpsPercentileAverage,
      computedMedianAverage: merged.global.medianDpsPercentileAverage,
    }),
  };
}

export function pointsAndDamageErrorRecord(
  state: Extract<PointsAndDamagePerformanceState, "ERROR" | "SCHEMA_UNSUPPORTED" | "SKIPPED">,
  raw: unknown,
  errorMessage: string,
  expectedDungeonCount?: number | null,
): PointsAndDamagePerformanceRecord {
  return {
    state,
    raw,
    dungeonAggregates: [],
    normalized: null,
    global: null,
    diagnostics: emptyDiagnostics({
      expectedDungeonCount: expectedDungeonCount ?? null,
      payloadTopKeys: isRecord(raw) ? Object.keys(raw) : [],
      errorMessage,
    }),
  };
}
