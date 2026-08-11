/**
 * Project role-aware Performance calculator + aggregate evidence into public
 * PerformanceSummaryDTO (no WCL re-fetch, no score recomputation).
 */

import type {
  PerformanceRoleAwareSummaryDTO,
  PerformanceSummaryDTO,
  PersistedCharacterPerformanceAggregateV2,
  PersistedDungeonPerformanceAggregateV2,
} from "@mplus/contracts";
import type {
  ParseChannelScoreResult,
  RoleAwarePerformanceComputeResult,
  RoleAwarePerformanceWeightsApplied,
} from "./types.js";

/** Sanitized calculator evidence persisted on CharacterScore.dimensionDetails.performance.roleAware. */
export interface PersistedRoleAwarePerformanceEvidence {
  role: "DPS" | "TANK" | "HEALER";
  activeDungeonSlugs: string[];
  damageParse: PersistedParseChannelEvidence | null;
  healingParse: PersistedParseChannelEvidence | null;
  weightsApplied: RoleAwarePerformanceWeightsApplied;
  coverage: RoleAwarePerformanceComputeResult["coverage"];
}

export interface PersistedParseChannelEvidence {
  score: number | null;
  confidence: number;
  bestAverage: number | null;
  medianAverage: number | null;
  availableCells: number;
  expectedCells: number;
}

function sanitizeParseChannel(
  channel: ParseChannelScoreResult | null,
): PersistedParseChannelEvidence | null {
  if (!channel) return null;
  return {
    score: channel.score,
    confidence: channel.confidence,
    bestAverage: channel.bestAverage,
    medianAverage: channel.medianAverage,
    availableCells: channel.availableCells,
    expectedCells: channel.expectedCells,
  };
}

export function extractPersistedRoleAwarePerformanceEvidence(input: {
  roleAware: RoleAwarePerformanceComputeResult;
  activeDungeonSlugs: readonly string[];
}): PersistedRoleAwarePerformanceEvidence {
  const role = input.roleAware.role;
  if (role !== "DPS" && role !== "TANK" && role !== "HEALER") {
    throw new Error(`unsupported_role_for_public_summary:${role}`);
  }
  return {
    role,
    activeDungeonSlugs: [...input.activeDungeonSlugs],
    damageParse: sanitizeParseChannel(input.roleAware.damageParse),
    healingParse: sanitizeParseChannel(input.roleAware.healingParse),
    weightsApplied: input.roleAware.weightsApplied,
    coverage: input.roleAware.coverage,
  };
}

function toPublicDungeon(
  dungeon: PersistedDungeonPerformanceAggregateV2,
): PerformanceRoleAwareSummaryDTO["damage"]["dungeons"][number] {
  return {
    dungeonSlug: dungeon.dungeonSlug,
    dungeonName: dungeon.dungeonName,
    bestParsePercentile: dungeon.bestParsePercentile,
    medianParsePercentile: dungeon.medianParsePercentile,
    loggedRunCount: dungeon.loggedRunCount,
  };
}

function orderedDungeonSlugs(
  activeDungeonSlugs: readonly string[],
  damageDungeons: readonly PersistedDungeonPerformanceAggregateV2[],
  healingDungeons: readonly PersistedDungeonPerformanceAggregateV2[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const slug of activeDungeonSlugs) {
    if (!seen.has(slug)) {
      seen.add(slug);
      ordered.push(slug);
    }
  }
  for (const dungeon of [...damageDungeons, ...healingDungeons]) {
    if (!seen.has(dungeon.dungeonSlug)) {
      seen.add(dungeon.dungeonSlug);
      ordered.push(dungeon.dungeonSlug);
    }
  }
  return ordered;
}

function channelDungeonsForSlugs(
  aggregates: readonly PersistedDungeonPerformanceAggregateV2[],
  slugs: readonly string[],
): PerformanceRoleAwareSummaryDTO["damage"]["dungeons"] {
  const bySlug = new Map(aggregates.map((dungeon) => [dungeon.dungeonSlug, dungeon]));
  return slugs
    .map((slug) => bySlug.get(slug))
    .filter((dungeon): dungeon is PersistedDungeonPerformanceAggregateV2 => dungeon != null)
    .map(toPublicDungeon);
}

function isPersistedV2Compact(value: unknown): value is PersistedCharacterPerformanceAggregateV2 {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.adapterVersion === "role-aware-throughput-v2" &&
    record.state === "OK" &&
    typeof record.damage === "object"
  );
}

function isPersistedRoleAwareEvidence(
  value: unknown,
): value is PersistedRoleAwarePerformanceEvidence {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.role === "DPS" || record.role === "TANK" || record.role === "HEALER") &&
    Array.isArray(record.activeDungeonSlugs) &&
    typeof record.weightsApplied === "object" &&
    typeof record.coverage === "object"
  );
}

export function buildRoleAwarePerformanceSummary(input: {
  evidence: PersistedRoleAwarePerformanceEvidence;
  compact: PersistedCharacterPerformanceAggregateV2;
  performanceScore: number | null;
  confidence: number;
}): PerformanceSummaryDTO {
  const { evidence, compact, performanceScore, confidence } = input;
  const damageAggregates = compact.damage.dungeonAggregates;
  const healingAggregates = compact.healing?.dungeonAggregates ?? [];
  const orderedSlugs = orderedDungeonSlugs(
    evidence.activeDungeonSlugs,
    damageAggregates,
    healingAggregates,
  );

  const damageChannel: PerformanceRoleAwareSummaryDTO["damage"] = {
    score: evidence.damageParse?.score ?? null,
    confidence: evidence.damageParse?.confidence ?? 0,
    bestAverage: evidence.damageParse?.bestAverage ?? null,
    medianAverage: evidence.damageParse?.medianAverage ?? null,
    availableCells: evidence.damageParse?.availableCells ?? 0,
    expectedCells: evidence.damageParse?.expectedCells ?? 0,
    dungeons: channelDungeonsForSlugs(damageAggregates, orderedSlugs),
  };

  const healingChannel: PerformanceRoleAwareSummaryDTO["healing"] =
    evidence.role === "HEALER" && evidence.healingParse
      ? {
          score: evidence.healingParse.score,
          confidence: evidence.healingParse.confidence,
          bestAverage: evidence.healingParse.bestAverage,
          medianAverage: evidence.healingParse.medianAverage,
          availableCells: evidence.healingParse.availableCells,
          expectedCells: evidence.healingParse.expectedCells,
          dungeons: channelDungeonsForSlugs(healingAggregates, orderedSlugs),
        }
      : null;

  const roleAware: PerformanceRoleAwareSummaryDTO = {
    role: evidence.role,
    performanceScore,
    weightsApplied: evidence.weightsApplied,
    damage: damageChannel,
    healing: healingChannel,
  };

  const expectedDungeonCount =
    compact.diagnostics.expectedDungeonCount ?? evidence.coverage.activeDungeonCount;

  return {
    currentSeason: {
      peakScore: damageChannel.bestAverage,
      consistencyScore: damageChannel.medianAverage,
      score: performanceScore,
      confidence,
      // Public DTO: `dungeonCount` is the number of represented active dungeons.
      // `availableCells` remains Best/Median cell coverage inside roleAware.
      dungeonCount: damageChannel.dungeons.length,
      availableDungeonCount: damageChannel.availableCells,
      expectedDungeonCount,
      totalLoggedRuns: compact.damage.totalLoggedRuns,
      partition: compact.partition,
      zoneId: compact.zoneId,
      latestObservedAt: null,
      provenance: "AGGREGATE_ZONE_RANKINGS",
      dungeons: damageChannel.dungeons.map((dungeon) => ({
        ...dungeon,
        bestRun: null,
        latestRun: null,
      })),
    },
    historical: null,
    roleAware,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function projectPerformanceSummaryFromDimensionDetails(
  details: Record<string, unknown> | null,
  performanceScore: number | null,
  performanceConfidence: number | null,
): PerformanceSummaryDTO | null {
  if (!details) return null;
  const perfBlock = asRecord(details.performance);
  if (!perfBlock) return null;
  const roleAwareEvidence = perfBlock.roleAware;
  if (!isPersistedRoleAwareEvidence(roleAwareEvidence)) return null;

  const aggBlock = asRecord(details.performanceAggregate);
  if (!aggBlock) return null;
  const compact = aggBlock.compact;
  if (!isPersistedV2Compact(compact)) return null;

  const confidence =
    typeof perfBlock.confidence === "number" && Number.isFinite(perfBlock.confidence)
      ? perfBlock.confidence
      : (performanceConfidence ?? 0);

  return buildRoleAwarePerformanceSummary({
    evidence: roleAwareEvidence,
    compact,
    performanceScore,
    confidence,
  });
}

/** Attach published snapshot selected-run refs without replacing role-aware throughput cells. */
export function mergePublishedSelectedRunsIntoPerformanceSummary(
  operational: PerformanceSummaryDTO,
  published: PerformanceSummaryDTO | null | undefined,
): PerformanceSummaryDTO {
  if (!published?.currentSeason.dungeons.length) return operational;
  const runRefsBySlug = new Map(
    published.currentSeason.dungeons.map((dungeon) => [
      dungeon.dungeonSlug,
      { bestRun: dungeon.bestRun, latestRun: dungeon.latestRun },
    ]),
  );
  return {
    ...operational,
    currentSeason: {
      ...operational.currentSeason,
      dungeons: operational.currentSeason.dungeons.map((dungeon) => {
        const refs = runRefsBySlug.get(dungeon.dungeonSlug);
        if (!refs) return dungeon;
        return {
          ...dungeon,
          bestRun: refs.bestRun,
          latestRun: refs.latestRun,
        };
      }),
    },
  };
}
