/**
 * Compact persisted contract for role-aware Performance throughput aggregates (V2).
 * CharacterPerformanceAggregate rows store this shape (plus rawPayload).
 * Ranking version bump invalidates V1 `points-and-damage-v1` cache rows (no migration).
 */
import { hashCanonicalJson } from "./canonical-json.js";
import {
  dedupeDungeonAggregates,
  type PersistedDungeonPerformanceAggregateV1,
} from "./character-performance-aggregate-v1.js";

/** Cache / adapter identity for role-aware dual-channel aggregates. */
export const CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION =
  "role-aware-throughput-v2" as const;

/** Column metric stamp for V2 rows (not part of unique identity). */
export const CHARACTER_PERFORMANCE_AGGREGATE_METRIC =
  "role_aware_throughput" as const;

export const PERFORMANCE_THROUGHPUT_METRIC_DAMAGE = "points_and_damage" as const;
export const PERFORMANCE_THROUGHPUT_METRIC_HEALING = "points_and_healing" as const;

export type PerformanceAggregateRoleV2 = "DPS" | "TANK" | "HEALER";

export type PersistedDungeonPerformanceAggregateV2 =
  PersistedDungeonPerformanceAggregateV1;

export interface PersistedThroughputChannelV2 {
  metric:
    | typeof PERFORMANCE_THROUGHPUT_METRIC_DAMAGE
    | typeof PERFORMANCE_THROUGHPUT_METRIC_HEALING;
  dungeonAggregates: PersistedDungeonPerformanceAggregateV2[];
  bestPercentileAverage: number | null;
  medianPercentileAverage: number | null;
  totalLoggedRuns: number;
  totalMythicPlusScore: number | null;
  partition: number | null;
  zoneId: number | null;
  /** Specs observed on allStars / rankings rows (payload evidence). */
  observedSpecs: string[];
  /** How observed specs relate to the scoring target spec. */
  specBinding:
    | "EXACT_MATCH"
    | "COHERENT_UNPROVEN"
    | "MISMATCH_REJECTED";
  wclBestPerformanceAverage: number | null;
  wclMedianPerformanceAverage: number | null;
}

export interface PersistedPerformanceAggregateDiagnosticsV2 {
  adapterVersion: typeof CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION;
  metric: typeof CHARACTER_PERFORMANCE_AGGREGATE_METRIC;
  provenance: "AGGREGATE_ZONE_RANKINGS";
  role: PerformanceAggregateRoleV2;
  targetSpecSlug: string | null;
  damageDungeonCount: number;
  healingDungeonCount: number;
  expectedDungeonCount: number | null;
  specBindingPolicy: string;
  limitations: string[];
  errorMessage?: string;
}

/**
 * Valid reusable role-aware Performance aggregate.
 * ERROR / EMPTY / SCHEMA_UNSUPPORTED must never be persisted as a scoring cache hit.
 */
export interface PersistedCharacterPerformanceAggregateV2 {
  state: "OK";
  adapterVersion: typeof CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION;
  metric: typeof CHARACTER_PERFORMANCE_AGGREGATE_METRIC;
  role: PerformanceAggregateRoleV2;
  targetSpecSlug: string | null;
  zoneId: number;
  partition: number | null;
  damage: PersistedThroughputChannelV2;
  healing: PersistedThroughputChannelV2 | null;
  diagnostics: PersistedPerformanceAggregateDiagnosticsV2;
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
): PersistedDungeonPerformanceAggregateV2 {
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

function normalizeChannel(
  raw: unknown,
  expectedMetric:
    | typeof PERFORMANCE_THROUGHPUT_METRIC_DAMAGE
    | typeof PERFORMANCE_THROUGHPUT_METRIC_HEALING,
): PersistedThroughputChannelV2 {
  if (!isRecord(raw)) {
    throw new Error("invalid_throughput_channel: expected object");
  }
  if (raw.metric !== expectedMetric) {
    throw new Error(
      `invalid_throughput_channel: metric expected ${expectedMetric}, got ${String(raw.metric)}`,
    );
  }
  if (!Array.isArray(raw.dungeonAggregates)) {
    throw new Error("invalid_throughput_channel: dungeonAggregates");
  }
  const dungeonAggregates = dedupeDungeonAggregates(
    raw.dungeonAggregates.map(normalizeDungeon),
  );
  if (dungeonAggregates.length === 0) {
    throw new Error("invalid_throughput_channel: no usable dungeon aggregates");
  }
  const specBinding = raw.specBinding;
  if (
    specBinding !== "EXACT_MATCH" &&
    specBinding !== "COHERENT_UNPROVEN" &&
    specBinding !== "MISMATCH_REJECTED"
  ) {
    throw new Error("invalid_throughput_channel: specBinding");
  }
  if (specBinding === "MISMATCH_REJECTED") {
    throw new Error(
      "performance_aggregate_incompatible: channel specBinding MISMATCH_REJECTED",
    );
  }
  const observedSpecs = Array.isArray(raw.observedSpecs)
    ? raw.observedSpecs.filter((s): s is string => typeof s === "string")
    : [];

  return {
    metric: expectedMetric,
    dungeonAggregates,
    bestPercentileAverage: assertPercentile(
      raw.bestPercentileAverage,
      "bestPercentileAverage",
    ),
    medianPercentileAverage: assertPercentile(
      raw.medianPercentileAverage,
      "medianPercentileAverage",
    ),
    totalLoggedRuns:
      typeof raw.totalLoggedRuns === "number" &&
      Number.isFinite(raw.totalLoggedRuns)
        ? raw.totalLoggedRuns
        : (() => {
            throw new Error("invalid_throughput_channel: totalLoggedRuns");
          })(),
    totalMythicPlusScore: assertFiniteNumberOrNull(
      raw.totalMythicPlusScore,
      "totalMythicPlusScore",
    ),
    partition: assertFiniteNumberOrNull(raw.partition, "partition"),
    zoneId: assertFiniteNumberOrNull(raw.zoneId, "zoneId"),
    observedSpecs,
    specBinding,
    wclBestPerformanceAverage: assertFiniteNumberOrNull(
      raw.wclBestPerformanceAverage,
      "wclBestPerformanceAverage",
    ),
    wclMedianPerformanceAverage: assertFiniteNumberOrNull(
      raw.wclMedianPerformanceAverage,
      "wclMedianPerformanceAverage",
    ),
  };
}

export function assertPersistedCharacterPerformanceAggregateV2(
  value: unknown,
): PersistedCharacterPerformanceAggregateV2 {
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
  const role = value.role;
  if (role !== "DPS" && role !== "TANK" && role !== "HEALER") {
    throw new Error(`performance_aggregate_incompatible: role ${String(role)}`);
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

  const targetSpecSlug =
    value.targetSpecSlug == null
      ? null
      : typeof value.targetSpecSlug === "string"
        ? value.targetSpecSlug
        : (() => {
            throw new Error("performance_aggregate_incompatible: targetSpecSlug");
          })();

  const damage = normalizeChannel(
    value.damage,
    PERFORMANCE_THROUGHPUT_METRIC_DAMAGE,
  );

  let healing: PersistedThroughputChannelV2 | null = null;
  if (role === "HEALER") {
    if (value.healing == null) {
      throw new Error(
        "performance_aggregate_incompatible: healer requires healing channel",
      );
    }
    healing = normalizeChannel(
      value.healing,
      PERFORMANCE_THROUGHPUT_METRIC_HEALING,
    );
  } else if (value.healing != null) {
    throw new Error(
      "performance_aggregate_incompatible: healing channel only valid for HEALER",
    );
  }

  if (!isRecord(value.diagnostics)) {
    throw new Error("performance_aggregate_incompatible: diagnostics");
  }
  const diagnostics: PersistedPerformanceAggregateDiagnosticsV2 = {
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    provenance: "AGGREGATE_ZONE_RANKINGS",
    role,
    targetSpecSlug,
    damageDungeonCount: damage.dungeonAggregates.length,
    healingDungeonCount: healing?.dungeonAggregates.length ?? 0,
    expectedDungeonCount:
      value.diagnostics.expectedDungeonCount == null
        ? null
        : assertFiniteNumberOrNull(
            value.diagnostics.expectedDungeonCount,
            "diagnostics.expectedDungeonCount",
          ),
    specBindingPolicy:
      typeof value.diagnostics.specBindingPolicy === "string"
        ? value.diagnostics.specBindingPolicy
        : "payload_observed_specs_vs_target_spec",
    limitations: Array.isArray(value.diagnostics.limitations)
      ? value.diagnostics.limitations.filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    ...(typeof value.diagnostics.errorMessage === "string"
      ? { errorMessage: value.diagnostics.errorMessage }
      : {}),
  };

  return {
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    role,
    targetSpecSlug,
    zoneId: value.zoneId,
    partition,
    damage,
    healing,
    diagnostics,
  };
}

/**
 * Map V2 compact into DB column layout (damage dungeons + nested healing in global).
 */
export function toPerformanceAggregateDbColumnsV2(
  compact: PersistedCharacterPerformanceAggregateV2,
): {
  dungeonAggregates: PersistedDungeonPerformanceAggregateV2[];
  globalSummary: Record<string, unknown>;
  diagnostics: PersistedPerformanceAggregateDiagnosticsV2;
  metric: typeof CHARACTER_PERFORMANCE_AGGREGATE_METRIC;
} {
  return {
    dungeonAggregates: compact.damage.dungeonAggregates,
    globalSummary: {
      schema: "role-aware-throughput-v2",
      role: compact.role,
      targetSpecSlug: compact.targetSpecSlug,
      damage: {
        metric: compact.damage.metric,
        bestPercentileAverage: compact.damage.bestPercentileAverage,
        medianPercentileAverage: compact.damage.medianPercentileAverage,
        totalLoggedRuns: compact.damage.totalLoggedRuns,
        totalMythicPlusScore: compact.damage.totalMythicPlusScore,
        partition: compact.damage.partition,
        zoneId: compact.damage.zoneId,
        observedSpecs: compact.damage.observedSpecs,
        specBinding: compact.damage.specBinding,
        wclBestPerformanceAverage: compact.damage.wclBestPerformanceAverage,
        wclMedianPerformanceAverage: compact.damage.wclMedianPerformanceAverage,
      },
      healing: compact.healing
        ? {
            metric: compact.healing.metric,
            dungeonAggregates: compact.healing.dungeonAggregates,
            bestPercentileAverage: compact.healing.bestPercentileAverage,
            medianPercentileAverage: compact.healing.medianPercentileAverage,
            totalLoggedRuns: compact.healing.totalLoggedRuns,
            totalMythicPlusScore: compact.healing.totalMythicPlusScore,
            partition: compact.healing.partition,
            zoneId: compact.healing.zoneId,
            observedSpecs: compact.healing.observedSpecs,
            specBinding: compact.healing.specBinding,
            wclBestPerformanceAverage: compact.healing.wclBestPerformanceAverage,
            wclMedianPerformanceAverage:
              compact.healing.wclMedianPerformanceAverage,
          }
        : null,
    },
    diagnostics: compact.diagnostics,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
  };
}

/** Rebuild V2 compact from DB columns. */
export function compactFromPerformanceAggregateDbColumnsV2(input: {
  rankingVersion: string;
  metric: string;
  zoneId: number;
  partition: number | null;
  dungeonAggregates: unknown;
  globalSummary: unknown;
  diagnostics: unknown;
}): PersistedCharacterPerformanceAggregateV2 {
  if (!isRecord(input.globalSummary) || input.globalSummary.schema !== "role-aware-throughput-v2") {
    throw new Error(
      "performance_aggregate_incompatible: expected V2 globalSummary.schema",
    );
  }
  const damageMeta = input.globalSummary.damage;
  if (!isRecord(damageMeta)) {
    throw new Error("performance_aggregate_incompatible: globalSummary.damage");
  }
  const healingRaw = input.globalSummary.healing;
  return assertPersistedCharacterPerformanceAggregateV2({
    state: "OK",
    adapterVersion: input.rankingVersion,
    metric: input.metric,
    role: input.globalSummary.role,
    targetSpecSlug: input.globalSummary.targetSpecSlug ?? null,
    zoneId: input.zoneId,
    partition: input.partition,
    damage: {
      ...damageMeta,
      metric: PERFORMANCE_THROUGHPUT_METRIC_DAMAGE,
      dungeonAggregates: input.dungeonAggregates,
    },
    healing:
      healingRaw == null
        ? null
        : {
            ...(healingRaw as Record<string, unknown>),
            metric: PERFORMANCE_THROUGHPUT_METRIC_HEALING,
          },
    diagnostics: input.diagnostics,
  });
}

export function performanceAggregateContentHashMaterialV2(input: {
  rankingVersion: string;
  metric: string;
  zoneId: number;
  partitionKey: string;
  compact: PersistedCharacterPerformanceAggregateV2;
  sourceRequestFingerprint: string;
}): unknown {
  return {
    rankingVersion: input.rankingVersion,
    metric: input.metric,
    zoneId: input.zoneId,
    partitionKey: input.partitionKey,
    role: input.compact.role,
    targetSpecSlug: input.compact.targetSpecSlug,
    damage: input.compact.damage,
    healing: input.compact.healing,
    diagnostics: input.compact.diagnostics,
    sourceRequestFingerprint: input.sourceRequestFingerprint,
  };
}

export function hashPerformanceAggregateContentV2(
  input: Parameters<typeof performanceAggregateContentHashMaterialV2>[0],
): string {
  return hashCanonicalJson(performanceAggregateContentHashMaterialV2(input));
}
