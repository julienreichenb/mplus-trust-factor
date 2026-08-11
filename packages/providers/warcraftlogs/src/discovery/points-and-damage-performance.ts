import { createHash } from "node:crypto";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION_V1,
  assertPersistedCharacterPerformanceAggregateV1,
  dedupeDungeonAggregates,
  toPerformanceAggregatePartitionKey,
  type PersistedCharacterPerformanceAggregateV1,
} from "@mplus/contracts";
import {
  mergePointsAndDamage,
  normalizePointsAndDamage,
  type NormalizedPointsAndDamage,
} from "../probe/performance-probe-logic.js";
import type { WclDungeonPerformanceAggregate } from "../types.js";

/** Re-export for callers that already import adapter helpers from this module. */
export {
  toPerformanceAggregatePartitionKey,
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION_V1 as CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
};

/**
 * Production Performance from Character.zoneRankings metric:points_and_damage.
 * Throughput Best%/Median%/DPS come from throughputRankings only.
 * WCL does not expose throughputSampleCount on this payload — confidence uses displayedRunCount.
 */

/** Bump when the summary adapter contract changes (cache / fingerprint invalidation). */
export const POINTS_AND_DAMAGE_ADAPTER_VERSION = "points-and-damage-v1";
export const POINTS_AND_DAMAGE_METRIC = "points_and_damage" as const;

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
  adapterVersion: typeof POINTS_AND_DAMAGE_ADAPTER_VERSION;
  metric: typeof POINTS_AND_DAMAGE_METRIC;
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
  adapterVersion: typeof POINTS_AND_DAMAGE_ADAPTER_VERSION;
  metric: typeof POINTS_AND_DAMAGE_METRIC;
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
  return hasRankings && hasThroughputMap;
}

/**
 * Cached / persisted WCL character-summary envelope is usable for Performance only when
 * it carries a successful points_and_damage adapter record (or raw that adapts cleanly).
 */
export function isCompatiblePointsAndDamageSummary(payload: unknown): boolean {
  if (!isRecord(payload)) return false;

  const performance = payload.performance;
  if (isRecord(performance)) {
    const adapterVersion = performance.adapterVersion;
    if (
      adapterVersion != null &&
      adapterVersion !== POINTS_AND_DAMAGE_ADAPTER_VERSION
    ) {
      return false;
    }
    if (performance.state === "OK") {
      const aggregates = performance.dungeonAggregates;
      if (Array.isArray(aggregates) && aggregates.length > 0) return true;
    }
    if (performance.state === "SCHEMA_UNSUPPORTED" || performance.state === "ERROR") {
      return false;
    }
  }

  const raw =
    payload.rawZoneRankingsPointsAndDamage ??
    (isRecord(performance) ? performance.raw : null);
  if (raw == null) return false;
  if (!isPointsAndDamageSchema(raw)) return false;
  const adapted = adaptPointsAndDamagePerformance({ raw });
  return adapted.state === "OK" && adapted.dungeonAggregates.length > 0;
}

/** Versioned ExternalRequest fingerprint for discoverCharacterSummary cache keys. */
export function buildWclSummaryRequestFingerprint(input: {
  region: string;
  realmSlug: string;
  name: string;
  zoneId: number;
  partition: number | null;
}): string {
  const material = [
    "warcraftlogs",
    "discoverCharacterSummary",
    POINTS_AND_DAMAGE_ADAPTER_VERSION,
    POINTS_AND_DAMAGE_METRIC,
    String(input.zoneId),
    input.partition == null ? "partition:current" : `partition:${input.partition}`,
    input.region.toLowerCase(),
    input.realmSlug.toLowerCase(),
    input.name.toLowerCase(),
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/** Fingerprint for the dedicated CharacterPerformanceAggregate provider operation. */
export function buildPerformanceAggregateRequestFingerprint(input: {
  region: string;
  realmSlug: string;
  name: string;
  zoneId: number;
  partition: number | null;
}): string {
  const material = [
    "warcraftlogs",
    "fetchCharacterPerformanceAggregate",
    POINTS_AND_DAMAGE_ADAPTER_VERSION,
    POINTS_AND_DAMAGE_METRIC,
    String(input.zoneId),
    toPerformanceAggregatePartitionKey(input.partition),
    input.region.toLowerCase(),
    input.realmSlug.toLowerCase(),
    input.name.toLowerCase(),
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * Map an OK adapter record into the compact persisted aggregate contract.
 * Rejects non-OK states — they must not be stored as reusable scoring evidence.
 */
export function toPersistedPerformanceAggregate(input: {
  record: PointsAndDamagePerformanceRecord;
  zoneId: number;
  partition: number | null;
}): PersistedCharacterPerformanceAggregateV1 {
  if (input.record.state !== "OK") {
    throw new Error(
      `cannot_persist_performance_aggregate: state=${input.record.state}`,
    );
  }
  if (input.record.adapterVersion !== POINTS_AND_DAMAGE_ADAPTER_VERSION) {
    throw new Error(
      `cannot_persist_performance_aggregate: adapterVersion=${input.record.adapterVersion}`,
    );
  }

  const dungeonAggregates = dedupeDungeonAggregates(
    input.record.dungeonAggregates.map((d) => ({
      dungeonSlug: d.dungeonSlug,
      dungeonName: d.dungeonName,
      encounterId: d.encounterId,
      bestParsePercentile: d.bestParsePercentile,
      medianParsePercentile: d.medianParsePercentile,
      loggedRunCount:
        typeof d.loggedRunCount === "number" && Number.isFinite(d.loggedRunCount)
          ? d.loggedRunCount
          : null,
      specialization: d.specialization ?? d.specSlug ?? null,
      keystoneLevel: d.keystoneLevel ?? null,
      bestDps: d.bestDps ?? null,
    })),
  );

  return assertPersistedCharacterPerformanceAggregateV1({
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION_V1,
    metric: POINTS_AND_DAMAGE_METRIC,
    zoneId: input.zoneId,
    partition: input.partition,
    dungeonAggregates,
    global: input.record.global
      ? {
          totalMythicPlusScore: input.record.global.totalMythicPlusScore,
          totalLoggedRuns: input.record.global.totalLoggedRuns,
          bestDpsPercentileAverage: input.record.global.bestDpsPercentileAverage,
          medianDpsPercentileAverage:
            input.record.global.medianDpsPercentileAverage,
          partition: input.record.global.partition,
          zoneId: input.record.global.zoneId,
        }
      : null,
    diagnostics: {
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION_V1,
      metric: POINTS_AND_DAMAGE_METRIC,
      provenance: "AGGREGATE_ZONE_RANKINGS",
      availableDungeonCount: input.record.diagnostics.availableDungeonCount,
      expectedDungeonCount: input.record.diagnostics.expectedDungeonCount,
      unavailableEncounters: input.record.diagnostics.unavailableEncounters,
      wclBestPerformanceAverage:
        input.record.diagnostics.wclBestPerformanceAverage,
      wclMedianPerformanceAverage:
        input.record.diagnostics.wclMedianPerformanceAverage,
      computedBestAverage: input.record.diagnostics.computedBestAverage,
      computedMedianAverage: input.record.diagnostics.computedMedianAverage,
      ...(input.record.diagnostics.errorMessage
        ? { errorMessage: input.record.diagnostics.errorMessage }
        : {}),
    },
  });
}

function emptyDiagnostics(
  overrides: Partial<PointsAndDamagePerformanceDiagnostics> = {},
): PointsAndDamagePerformanceDiagnostics {
  return {
    adapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
    metric: POINTS_AND_DAMAGE_METRIC,
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
      adapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
      metric: POINTS_AND_DAMAGE_METRIC,
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
      adapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
      metric: POINTS_AND_DAMAGE_METRIC,
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

  const withoutIcecrown = dungeonAggregates.filter(
    (d) => !d.dungeonSlug.toLowerCase().includes("icecrown"),
  );

  return {
    state: "OK",
    adapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
    metric: POINTS_AND_DAMAGE_METRIC,
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
    adapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
    metric: POINTS_AND_DAMAGE_METRIC,
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
