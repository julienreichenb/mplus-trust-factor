/**
 * Role-aware Performance aggregate adapter (V2).
 * Damage: points_and_damage. Healing: points_and_healing (healers only).
 * Query role/specName args are NOT trusted (04A live no-op); bind from payload specs.
 */

import { createHash } from "node:crypto";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  PERFORMANCE_THROUGHPUT_METRIC_DAMAGE,
  PERFORMANCE_THROUGHPUT_METRIC_HEALING,
  assertPersistedCharacterPerformanceAggregateV2,
  dedupeDungeonAggregates,
  normalizePerformanceSpecToken,
  toPerformanceAggregatePartitionKey,
  type PerformanceAggregateRoleV2,
  type PersistedCharacterPerformanceAggregateV2,
  type PersistedThroughputChannelV2,
} from "@mplus/contracts";
import {
  mergePointsAndDamage,
  normalizePointsAndDamage,
} from "../probe/performance-probe-logic.js";
import {
  POINTS_AND_DAMAGE_ADAPTER_VERSION,
  adaptPointsAndDamagePerformance,
  isPointsAndDamageSchema,
  type PointsAndDamagePerformanceRecord,
} from "./points-and-damage-performance.js";

export const ROLE_AWARE_THROUGHPUT_ADAPTER_VERSION =
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION;

export function buildRoleAwarePerformanceAggregateRequestFingerprint(input: {
  region: string;
  realmSlug: string;
  name: string;
  zoneId: number;
  partition: number | null;
  role: PerformanceAggregateRoleV2;
  specSlug: string | null;
}): string {
  const material = [
    "warcraftlogs",
    "fetchCharacterPerformanceAggregate",
    ROLE_AWARE_THROUGHPUT_ADAPTER_VERSION,
    CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    input.role,
    input.specSlug ?? "spec:null",
    String(input.zoneId),
    toPerformanceAggregatePartitionKey(input.partition),
    input.region.toLowerCase(),
    input.realmSlug.toLowerCase(),
    input.name.toLowerCase(),
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * Spec binding from payload evidence only (not GraphQL filter args).
 * - EXACT_MATCH: at least one observed spec equals target
 * - MISMATCH_REJECTED: observed specs present and none equal target
 * - COHERENT_UNPROVEN: no target or no observed specs
 */
export function resolveSpecBinding(input: {
  targetSpecSlug: string | null;
  observedSpecs: readonly string[];
}): PersistedThroughputChannelV2["specBinding"] {
  const target = normalizePerformanceSpecToken(input.targetSpecSlug);
  const observed = [
    ...new Set(
      input.observedSpecs
        .map((s) => normalizePerformanceSpecToken(s))
        .filter((s): s is string => s != null),
    ),
  ];
  if (target == null || observed.length === 0) return "COHERENT_UNPROVEN";
  if (observed.includes(target)) return "EXACT_MATCH";
  return "MISMATCH_REJECTED";
}

function collectObservedSpecs(raw: unknown): string[] {
  const specs = new Set<string>();
  const normalized = normalizePointsAndDamage(raw);
  for (const s of normalized.specRanks) {
    if (s.spec) specs.add(s.spec);
  }
  // Score ranking rows also carry specialization.
  for (const d of normalized.scoreDungeons) {
    // score dungeon rows don't expose spec on the mapped type — use raw
    void d;
  }
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const rankings = (raw as { rankings?: unknown }).rankings;
    if (Array.isArray(rankings)) {
      for (const row of rankings) {
        if (row != null && typeof row === "object") {
          const spec = (row as { spec?: unknown; bestSpec?: unknown }).spec;
          const bestSpec = (row as { bestSpec?: unknown }).bestSpec;
          if (typeof spec === "string") specs.add(spec);
          if (typeof bestSpec === "string") specs.add(bestSpec);
        }
      }
    }
  }
  return [...specs];
}

/**
 * Accept points_and_damage or points_and_healing JSON scalars (same throughput shape).
 */
export function isThroughputZoneRankingsSchema(
  raw: unknown,
  expectedMetric: "points_and_damage" | "points_and_healing",
): boolean {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const metric =
    typeof (raw as { metric?: unknown }).metric === "string"
      ? (raw as { metric: string }).metric
      : null;
  if (metric != null && metric !== expectedMetric) return false;
  const hasThroughputMap =
    (raw as { throughputRankings?: unknown }).throughputRankings != null &&
    (typeof (raw as { throughputRankings: unknown }).throughputRankings ===
      "object" ||
      Array.isArray((raw as { throughputRankings: unknown }).throughputRankings));
  const hasRankings = Array.isArray((raw as { rankings?: unknown }).rankings);
  if (metric === expectedMetric) return hasRankings || hasThroughputMap;
  // When metric omitted, require throughput map (pad/pah signature).
  return hasRankings && hasThroughputMap;
}

export function adaptThroughputChannel(input: {
  raw: unknown;
  expectedMetric: "points_and_damage" | "points_and_healing";
  targetSpecSlug: string | null;
}): {
  state: PointsAndDamagePerformanceRecord["state"];
  channel: PersistedThroughputChannelV2 | null;
  errorMessage?: string;
} {
  const { raw, expectedMetric, targetSpecSlug } = input;
  if (raw == null) {
    return {
      state: "EMPTY",
      channel: null,
      errorMessage: `${expectedMetric} zoneRankings payload was null`,
    };
  }
  if (!isThroughputZoneRankingsSchema(raw, expectedMetric)) {
    // Reuse pad adapter for damage metric strictness; healing uses same shape.
    if (
      expectedMetric === "points_and_damage" &&
      !isPointsAndDamageSchema(raw)
    ) {
      return {
        state: "SCHEMA_UNSUPPORTED",
        channel: null,
        errorMessage: `schema unsupported for ${expectedMetric}`,
      };
    }
    if (expectedMetric === "points_and_healing") {
      return {
        state: "SCHEMA_UNSUPPORTED",
        channel: null,
        errorMessage: `schema unsupported for ${expectedMetric}`,
      };
    }
  }

  // Force metric field for healer payloads before shared normalizer checks.
  const rawWithMetric =
    raw != null && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>), metric: expectedMetric }
      : raw;

  // Shared normalizer historically named for pad; shape is identical for pah.
  const adapted =
    expectedMetric === "points_and_damage"
      ? adaptPointsAndDamagePerformance({ raw: rawWithMetric })
      : adaptPointsAndDamagePerformance({
          raw: {
            ...(rawWithMetric as Record<string, unknown>),
            // Adapter schema gate expects points_and_damage — temporarily stamp.
            metric: "points_and_damage",
          },
        });

  if (adapted.state !== "OK" || adapted.dungeonAggregates.length === 0) {
    return {
      state: adapted.state === "OK" ? "ERROR" : adapted.state,
      channel: null,
      errorMessage:
        adapted.diagnostics.errorMessage ??
        `${expectedMetric} produced no usable dungeon aggregates`,
    };
  }

  const observedSpecs = collectObservedSpecs(raw);
  const specBinding = resolveSpecBinding({ targetSpecSlug, observedSpecs });
  if (specBinding === "MISMATCH_REJECTED") {
    return {
      state: "ERROR",
      channel: null,
      errorMessage: `${expectedMetric} observed specs [${observedSpecs.join(",")}] mismatch target ${targetSpecSlug}`,
    };
  }

  const dungeonAggregates = dedupeDungeonAggregates(
    adapted.dungeonAggregates.map((d) => ({
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

  const channel: PersistedThroughputChannelV2 = {
    metric:
      expectedMetric === "points_and_healing"
        ? PERFORMANCE_THROUGHPUT_METRIC_HEALING
        : PERFORMANCE_THROUGHPUT_METRIC_DAMAGE,
    dungeonAggregates,
    bestPercentileAverage: adapted.global?.bestDpsPercentileAverage ?? null,
    medianPercentileAverage: adapted.global?.medianDpsPercentileAverage ?? null,
    totalLoggedRuns: adapted.global?.totalLoggedRuns ?? 0,
    totalMythicPlusScore: adapted.global?.totalMythicPlusScore ?? null,
    partition: adapted.global?.partition ?? null,
    zoneId: adapted.global?.zoneId ?? null,
    observedSpecs,
    specBinding,
    wclBestPerformanceAverage:
      adapted.diagnostics.wclBestPerformanceAverage ?? null,
    wclMedianPerformanceAverage:
      adapted.diagnostics.wclMedianPerformanceAverage ?? null,
  };

  return { state: "OK", channel };
}

export function toPersistedRoleAwarePerformanceAggregate(input: {
  role: PerformanceAggregateRoleV2;
  targetSpecSlug: string | null;
  zoneId: number;
  partition: number | null;
  damage: PersistedThroughputChannelV2;
  healing: PersistedThroughputChannelV2 | null;
  expectedDungeonCount?: number | null;
  limitations?: string[];
}): PersistedCharacterPerformanceAggregateV2 {
  return assertPersistedCharacterPerformanceAggregateV2({
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    role: input.role,
    targetSpecSlug: input.targetSpecSlug,
    zoneId: input.zoneId,
    partition: input.partition,
    damage: input.damage,
    healing: input.healing,
    diagnostics: {
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      provenance: "AGGREGATE_ZONE_RANKINGS",
      role: input.role,
      targetSpecSlug: input.targetSpecSlug,
      damageDungeonCount: input.damage.dungeonAggregates.length,
      healingDungeonCount: input.healing?.dungeonAggregates.length ?? 0,
      expectedDungeonCount: input.expectedDungeonCount ?? null,
      specBindingPolicy:
        "payload_observed_specs_vs_target_spec; query role/specName not trusted",
      limitations: input.limitations ?? [],
    },
  });
}

export type RoleAwarePerformanceAggregateRecord =
  | {
      state: "OK";
      compact: PersistedCharacterPerformanceAggregateV2;
      rawPayload: unknown;
    }
  | {
      state: "ERROR" | "EMPTY" | "SCHEMA_UNSUPPORTED" | "SKIPPED";
      compact: null;
      rawPayload: unknown;
      errorMessage: string;
    };

export function buildRoleAwareAggregateFromRaw(input: {
  role: PerformanceAggregateRoleV2;
  targetSpecSlug: string | null;
  zoneId: number;
  partition: number | null;
  damageRaw: unknown;
  healingRaw: unknown | null;
}): RoleAwarePerformanceAggregateRecord {
  const damageAdapted = adaptThroughputChannel({
    raw: input.damageRaw,
    expectedMetric: "points_and_damage",
    targetSpecSlug: input.targetSpecSlug,
  });
  if (damageAdapted.state !== "OK" || damageAdapted.channel == null) {
    return {
      state: damageAdapted.state === "OK" ? "ERROR" : damageAdapted.state,
      compact: null,
      rawPayload: {
        damage: input.damageRaw,
        healing: input.healingRaw,
      },
      errorMessage: damageAdapted.errorMessage ?? "damage channel failed",
    };
  }

  let healing: PersistedThroughputChannelV2 | null = null;
  if (input.role === "HEALER") {
    const healingAdapted = adaptThroughputChannel({
      raw: input.healingRaw,
      expectedMetric: "points_and_healing",
      targetSpecSlug: input.targetSpecSlug,
    });
    if (healingAdapted.state !== "OK" || healingAdapted.channel == null) {
      return {
        state: healingAdapted.state === "OK" ? "ERROR" : healingAdapted.state,
        compact: null,
        rawPayload: {
          damage: input.damageRaw,
          healing: input.healingRaw,
        },
        errorMessage: healingAdapted.errorMessage ?? "healing channel failed",
      };
    }
    healing = healingAdapted.channel;
  }

  try {
    const compact = toPersistedRoleAwarePerformanceAggregate({
      role: input.role,
      targetSpecSlug: input.targetSpecSlug,
      zoneId: input.zoneId,
      partition: input.partition,
      damage: damageAdapted.channel,
      healing,
      limitations:
        damageAdapted.channel.specBinding === "COHERENT_UNPROVEN" ||
        healing?.specBinding === "COHERENT_UNPROVEN"
          ? ["spec_binding_coherent_unproven"]
          : [],
    });
    return {
      state: "OK",
      compact,
      rawPayload: {
        damage: input.damageRaw,
        healing: input.healingRaw,
      },
    };
  } catch (error) {
    return {
      state: "ERROR",
      compact: null,
      rawPayload: {
        damage: input.damageRaw,
        healing: input.healingRaw,
      },
      errorMessage: error instanceof Error ? error.message : "normalize failed",
    };
  }
}

// Keep pad adapter version import used for forensic reference.
void POINTS_AND_DAMAGE_ADAPTER_VERSION;
void mergePointsAndDamage;
