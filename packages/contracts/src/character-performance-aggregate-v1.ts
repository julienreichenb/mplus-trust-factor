/**
 * Compact persisted contract for character/season WCL points_and_damage aggregates.
 * CharacterPerformanceAggregate rows store this shape (plus rawPayload).
 * Not fight-local — do not confuse with RunRankingFact.
 */
import { hashCanonicalJson } from "./canonical-json.js";

/** Must match POINTS_AND_DAMAGE_ADAPTER_VERSION in the WCL provider package. */
export const CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION =
  "points-and-damage-v1" as const;

export const CHARACTER_PERFORMANCE_AGGREGATE_METRIC =
  "points_and_damage" as const;

/** Stable partition identity for unique keys (never null). */
export function toPerformanceAggregatePartitionKey(
  partition: number | null,
): string {
  return partition == null ? "current" : `partition:${partition}`;
}

export interface PersistedDungeonPerformanceAggregateV1 {
  dungeonSlug: string;
  dungeonName: string;
  encounterId: number | null;
  bestParsePercentile: number | null;
  medianParsePercentile: number | null;
  loggedRunCount: number | null;
  specialization: string | null;
  keystoneLevel: number | null;
  bestDps: number | null;
}

export interface PersistedPerformanceAggregateGlobalV1 {
  totalMythicPlusScore: number | null;
  totalLoggedRuns: number;
  bestDpsPercentileAverage: number | null;
  medianDpsPercentileAverage: number | null;
  partition: number | null;
  zoneId: number | null;
}

export interface PersistedPerformanceAggregateDiagnosticsV1 {
  adapterVersion: typeof CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION;
  metric: typeof CHARACTER_PERFORMANCE_AGGREGATE_METRIC;
  provenance: "AGGREGATE_ZONE_RANKINGS";
  availableDungeonCount: number;
  expectedDungeonCount: number | null;
  unavailableEncounters: Array<{
    encounterID: number;
    encounterName: string | null;
    dungeonSlug: string | null;
    reason: string;
  }>;
  wclBestPerformanceAverage: number | null;
  wclMedianPerformanceAverage: number | null;
  computedBestAverage: number | null;
  computedMedianAverage: number | null;
  errorMessage?: string;
}

/**
 * Valid reusable Performance aggregate. ERROR / EMPTY / SCHEMA_UNSUPPORTED
 * must never be persisted as a scoring cache hit.
 */
export interface PersistedCharacterPerformanceAggregateV1 {
  state: "OK";
  adapterVersion: typeof CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION;
  metric: typeof CHARACTER_PERFORMANCE_AGGREGATE_METRIC;
  zoneId: number;
  partition: number | null;
  dungeonAggregates: PersistedDungeonPerformanceAggregateV1[];
  global: PersistedPerformanceAggregateGlobalV1 | null;
  diagnostics: PersistedPerformanceAggregateDiagnosticsV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function assertPercentile(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`invalid_${field}: expected finite number or null`);
  }
  if (value < 0 || value > 100) {
    throw new Error(`invalid_${field}: percentile out of range 0..100`);
  }
  return value;
}

function assertFiniteNumberOrNull(
  value: unknown,
  field: string,
): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`invalid_${field}: expected finite number or null`);
  }
  return value;
}

function normalizeDungeon(
  raw: unknown,
): PersistedDungeonPerformanceAggregateV1 {
  if (!isRecord(raw)) {
    throw new Error("invalid_dungeon_aggregate: expected object");
  }
  if (typeof raw.dungeonSlug !== "string" || raw.dungeonSlug.length === 0) {
    throw new Error("invalid_dungeon_aggregate: dungeonSlug required");
  }
  if (raw.dungeonSlug.toLowerCase() === "unknown") {
    throw new Error("invalid_dungeon_aggregate: fabricated unknown dungeonSlug");
  }
  if (typeof raw.dungeonName !== "string" || raw.dungeonName.length === 0) {
    throw new Error("invalid_dungeon_aggregate: dungeonName required");
  }
  if (raw.dungeonName.toLowerCase() === "unknown") {
    throw new Error("invalid_dungeon_aggregate: fabricated unknown dungeonName");
  }
  const encounterId =
    raw.encounterId == null
      ? null
      : typeof raw.encounterId === "number" &&
          Number.isFinite(raw.encounterId) &&
          raw.encounterId > 0
        ? raw.encounterId
        : (() => {
            throw new Error("invalid_dungeon_aggregate: encounterId");
          })();

  const bestParsePercentile = assertPercentile(
    raw.bestParsePercentile,
    "bestParsePercentile",
  );
  const medianParsePercentile = assertPercentile(
    raw.medianParsePercentile,
    "medianParsePercentile",
  );
  if (bestParsePercentile == null && medianParsePercentile == null) {
    throw new Error(
      "invalid_dungeon_aggregate: at least one of best/median percentile required",
    );
  }

  const loggedRunCount = assertFiniteNumberOrNull(
    raw.loggedRunCount,
    "loggedRunCount",
  );
  if (loggedRunCount != null && loggedRunCount < 0) {
    throw new Error("invalid_dungeon_aggregate: loggedRunCount must be >= 0");
  }
  const bestDps = assertFiniteNumberOrNull(raw.bestDps, "bestDps");
  if (bestDps != null && bestDps < 0) {
    throw new Error("invalid_dungeon_aggregate: bestDps must be >= 0");
  }

  return {
    dungeonSlug: raw.dungeonSlug,
    dungeonName: raw.dungeonName,
    encounterId,
    bestParsePercentile,
    medianParsePercentile,
    loggedRunCount,
    specialization:
      raw.specialization == null
        ? null
        : typeof raw.specialization === "string"
          ? raw.specialization
          : (() => {
              throw new Error("invalid_dungeon_aggregate: specialization");
            })(),
    keystoneLevel: assertFiniteNumberOrNull(
      raw.keystoneLevel,
      "keystoneLevel",
    ),
    bestDps,
  };
}

/**
 * Deduplicate deterministically by dungeonSlug + encounterId + specialization.
 * Keep first after stable sort. Never fabricate zero percentiles.
 */
export function dedupeDungeonAggregates(
  rows: PersistedDungeonPerformanceAggregateV1[],
): PersistedDungeonPerformanceAggregateV1[] {
  const sorted = [...rows].sort((a, b) => {
    const slug = a.dungeonSlug.localeCompare(b.dungeonSlug);
    if (slug !== 0) return slug;
    const enc = (a.encounterId ?? -1) - (b.encounterId ?? -1);
    if (enc !== 0) return enc;
    return (a.specialization ?? "").localeCompare(b.specialization ?? "");
  });
  const seen = new Set<string>();
  const out: PersistedDungeonPerformanceAggregateV1[] = [];
  for (const row of sorted) {
    const key = `${row.dungeonSlug}::${row.encounterId ?? "null"}::${row.specialization ?? "null"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function assertPersistedCharacterPerformanceAggregateV1(
  value: unknown,
): PersistedCharacterPerformanceAggregateV1 {
  if (!isRecord(value)) {
    throw new Error("performance_aggregate_incompatible: expected object");
  }
  if (value.state !== "OK") {
    throw new Error(
      `performance_aggregate_incompatible: state must be OK, got ${String(value.state)}`,
    );
  }
  if (value.adapterVersion !== CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION) {
    throw new Error(
      `performance_aggregate_incompatible: adapterVersion ${String(value.adapterVersion)}`,
    );
  }
  if (value.metric !== CHARACTER_PERFORMANCE_AGGREGATE_METRIC) {
    throw new Error(
      `performance_aggregate_incompatible: metric ${String(value.metric)}`,
    );
  }
  if (typeof value.zoneId !== "number" || !Number.isFinite(value.zoneId) || value.zoneId <= 0) {
    throw new Error("performance_aggregate_incompatible: zoneId");
  }
  if (!Number.isInteger(value.zoneId)) {
    throw new Error("performance_aggregate_incompatible: zoneId must be integer");
  }
  const partition =
    value.partition == null
      ? null
      : typeof value.partition === "number" && Number.isFinite(value.partition)
        ? value.partition
        : (() => {
            throw new Error("performance_aggregate_incompatible: partition");
          })();

  if (!Array.isArray(value.dungeonAggregates)) {
    throw new Error("performance_aggregate_incompatible: dungeonAggregates");
  }
  const dungeonAggregates = dedupeDungeonAggregates(
    value.dungeonAggregates.map(normalizeDungeon),
  );
  if (dungeonAggregates.length === 0) {
    throw new Error(
      "performance_aggregate_incompatible: no usable dungeon aggregates",
    );
  }

  let global: PersistedPerformanceAggregateGlobalV1 | null = null;
  if (value.global != null) {
    if (!isRecord(value.global)) {
      throw new Error("performance_aggregate_incompatible: global");
    }
    global = {
      totalMythicPlusScore: assertFiniteNumberOrNull(
        value.global.totalMythicPlusScore,
        "global.totalMythicPlusScore",
      ),
      totalLoggedRuns:
        typeof value.global.totalLoggedRuns === "number" &&
        Number.isFinite(value.global.totalLoggedRuns)
          ? value.global.totalLoggedRuns
          : (() => {
              throw new Error("performance_aggregate_incompatible: totalLoggedRuns");
            })(),
      bestDpsPercentileAverage: assertPercentile(
        value.global.bestDpsPercentileAverage,
        "global.bestDpsPercentileAverage",
      ),
      medianDpsPercentileAverage: assertPercentile(
        value.global.medianDpsPercentileAverage,
        "global.medianDpsPercentileAverage",
      ),
      partition:
        value.global.partition == null
          ? null
          : assertFiniteNumberOrNull(
              value.global.partition,
              "global.partition",
            ),
      zoneId:
        value.global.zoneId == null
          ? null
          : assertFiniteNumberOrNull(value.global.zoneId, "global.zoneId"),
    };
  }

  if (!isRecord(value.diagnostics)) {
    throw new Error("performance_aggregate_incompatible: diagnostics");
  }
  const diagnostics: PersistedPerformanceAggregateDiagnosticsV1 = {
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    provenance: "AGGREGATE_ZONE_RANKINGS",
    availableDungeonCount:
      typeof value.diagnostics.availableDungeonCount === "number"
        ? value.diagnostics.availableDungeonCount
        : dungeonAggregates.length,
    expectedDungeonCount:
      value.diagnostics.expectedDungeonCount == null
        ? null
        : assertFiniteNumberOrNull(
            value.diagnostics.expectedDungeonCount,
            "diagnostics.expectedDungeonCount",
          ),
    unavailableEncounters: Array.isArray(value.diagnostics.unavailableEncounters)
      ? (value.diagnostics.unavailableEncounters as PersistedPerformanceAggregateDiagnosticsV1["unavailableEncounters"])
      : [],
    wclBestPerformanceAverage: assertFiniteNumberOrNull(
      value.diagnostics.wclBestPerformanceAverage,
      "diagnostics.wclBestPerformanceAverage",
    ),
    wclMedianPerformanceAverage: assertFiniteNumberOrNull(
      value.diagnostics.wclMedianPerformanceAverage,
      "diagnostics.wclMedianPerformanceAverage",
    ),
    computedBestAverage: assertFiniteNumberOrNull(
      value.diagnostics.computedBestAverage,
      "diagnostics.computedBestAverage",
    ),
    computedMedianAverage: assertFiniteNumberOrNull(
      value.diagnostics.computedMedianAverage,
      "diagnostics.computedMedianAverage",
    ),
    ...(typeof value.diagnostics.errorMessage === "string"
      ? { errorMessage: value.diagnostics.errorMessage }
      : {}),
  };

  return {
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    zoneId: value.zoneId,
    partition,
    dungeonAggregates,
    global,
    diagnostics,
  };
}

/** Semantic hash material — excludes volatile storage timestamps, DB ids, and
 * raw WCL JSON (Postgres jsonb can rewrite float bit-patterns on round-trip). */
export function performanceAggregateContentHashMaterial(input: {
  rankingVersion: string;
  metric: string;
  zoneId: number;
  partitionKey: string;
  rawPayload?: unknown;
  dungeonAggregates: PersistedDungeonPerformanceAggregateV1[];
  global: PersistedPerformanceAggregateGlobalV1 | null;
  diagnostics: PersistedPerformanceAggregateDiagnosticsV1;
  sourceRequestFingerprint: string;
}): unknown {
  return {
    rankingVersion: input.rankingVersion,
    metric: input.metric,
    zoneId: input.zoneId,
    partitionKey: input.partitionKey,
    dungeonAggregates: input.dungeonAggregates,
    global: input.global,
    diagnostics: input.diagnostics,
    sourceRequestFingerprint: input.sourceRequestFingerprint,
  };
}

export function hashPerformanceAggregateContent(
  input: Parameters<typeof performanceAggregateContentHashMaterial>[0],
): string {
  return hashCanonicalJson(performanceAggregateContentHashMaterial(input));
}
