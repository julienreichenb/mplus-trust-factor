/**
 * Canonical parse channel: equal-dungeon Best/Median → 45/55 score + cell coverage confidence.
 */

import { clamp, clamp01 } from "../../math.js";
import { PARSE_CHANNEL_WEIGHTS } from "./constants.js";
import type {
  ParseChannelScoreResult,
  PerformanceThroughputChannelFact,
} from "./types.js";

function meanOfValid(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

export function computeEqualDungeonPercentileAverages(
  channel: PerformanceThroughputChannelFact,
  activeDungeonSlugs: readonly string[],
): { bestAverage: number | null; medianAverage: number | null; dungeonsUsed: number } {
  const active = new Set(activeDungeonSlugs);
  const rows = channel.perDungeon.filter((d) => active.has(d.dungeonSlug));
  // One observation per dungeon slug (first wins after stable order).
  const bySlug = new Map<string, (typeof rows)[number]>();
  for (const row of [...rows].sort((a, b) =>
    a.dungeonSlug.localeCompare(b.dungeonSlug),
  )) {
    if (!bySlug.has(row.dungeonSlug)) bySlug.set(row.dungeonSlug, row);
  }
  const unique = [...bySlug.values()];
  return {
    bestAverage: meanOfValid(unique.map((d) => d.bestParsePercentile)),
    medianAverage: meanOfValid(unique.map((d) => d.medianParsePercentile)),
    dungeonsUsed: unique.length,
  };
}

/**
 * expectedCells = activeDungeonCount * 2 (Best + Median per dungeon).
 * availableCells = finite Best/Median fields among active dungeons only.
 */
export function countParseChannelCells(
  channel: PerformanceThroughputChannelFact,
  activeDungeonSlugs: readonly string[],
): { availableCells: number; expectedCells: number } {
  const expectedCells = Math.max(0, activeDungeonSlugs.length) * 2;
  const active = new Set(activeDungeonSlugs);
  const bySlug = new Map<string, PerformanceThroughputChannelFact["perDungeon"][number]>();
  for (const row of channel.perDungeon) {
    if (!active.has(row.dungeonSlug)) continue;
    if (!bySlug.has(row.dungeonSlug)) bySlug.set(row.dungeonSlug, row);
  }
  let availableCells = 0;
  for (const slug of activeDungeonSlugs) {
    const row = bySlug.get(slug);
    if (!row) continue;
    if (row.bestParsePercentile != null && Number.isFinite(row.bestParsePercentile)) {
      availableCells += 1;
    }
    if (
      row.medianParsePercentile != null &&
      Number.isFinite(row.medianParsePercentile)
    ) {
      availableCells += 1;
    }
  }
  return { availableCells, expectedCells };
}

export function computeParseChannelScore(
  channel: PerformanceThroughputChannelFact | null,
  activeDungeonSlugs: readonly string[],
  options?: {
    expectedPartition?: number | null;
    causePrefix?: string;
  },
): ParseChannelScoreResult {
  const prefix = options?.causePrefix ?? "parse";
  const expectedCells = Math.max(0, activeDungeonSlugs.length) * 2;
  if (channel == null) {
    return {
      score: null,
      confidence: 0,
      causes: [`${prefix}_channel_missing`],
      availableCells: 0,
      expectedCells,
      evidenceCoverage: 0,
      bestAverage: null,
      medianAverage: null,
      dungeonsUsed: 0,
      state: "UNAVAILABLE",
    };
  }

  if (channel.specBinding === "MISMATCH_REJECTED") {
    return {
      score: null,
      confidence: 0,
      causes: [`${prefix}_spec_mismatch`],
      availableCells: 0,
      expectedCells,
      evidenceCoverage: 0,
      bestAverage: null,
      medianAverage: null,
      dungeonsUsed: 0,
      state: "UNAVAILABLE",
    };
  }

  // Explicit expected partition vs proven channel partition → integrity mismatch.
  // Null/"current" expected does not invent a mismatch against an unproven numeric partition.
  if (
    options?.expectedPartition != null &&
    channel.partition != null &&
    channel.partition !== options.expectedPartition
  ) {
    return {
      score: null,
      confidence: 0,
      causes: [`${prefix}_partition_mismatch`],
      availableCells: 0,
      expectedCells,
      evidenceCoverage: 0,
      bestAverage: null,
      medianAverage: null,
      dungeonsUsed: 0,
      state: "UNAVAILABLE",
    };
  }

  const averages = computeEqualDungeonPercentileAverages(
    channel,
    activeDungeonSlugs,
  );
  const best = averages.bestAverage;
  const median = averages.medianAverage;
  const bestOk = best != null && Number.isFinite(best);
  const medianOk = median != null && Number.isFinite(median);

  let score: number | null = null;
  if (bestOk && medianOk) {
    score =
      PARSE_CHANNEL_WEIGHTS.bestAverage * best! +
      PARSE_CHANNEL_WEIGHTS.medianAverage * median!;
  } else if (bestOk) {
    score = best!;
  } else if (medianOk) {
    score = median!;
  }

  if (score == null) {
    return {
      score: null,
      confidence: 0,
      causes: [`${prefix}_no_usable_percentiles`],
      availableCells: 0,
      expectedCells,
      evidenceCoverage: 0,
      bestAverage: best,
      medianAverage: median,
      dungeonsUsed: averages.dungeonsUsed,
      state: "UNAVAILABLE",
    };
  }

  const cells = countParseChannelCells(channel, activeDungeonSlugs);
  const evidenceCoverage =
    cells.expectedCells <= 0
      ? 0
      : clamp01(cells.availableCells / cells.expectedCells);

  const causes: string[] = [];
  if (evidenceCoverage < 1) {
    causes.push(`${prefix}_coverage_incomplete`);
  }
  if (channel.specBinding === "COHERENT_UNPROVEN") {
    causes.push(`${prefix}_spec_binding_unproven`);
  }

  // Confidence = cell coverage; optional mild dampener for unproven spec binding only.
  // No freshness subsystem in 04B baseline.
  let confidence = evidenceCoverage;
  if (channel.specBinding === "COHERENT_UNPROVEN") {
    confidence *= 0.95;
  }
  confidence = clamp01(confidence);

  return {
    score: clamp(score, 0, 100),
    confidence,
    causes,
    availableCells: cells.availableCells,
    expectedCells: cells.expectedCells,
    evidenceCoverage,
    bestAverage: best,
    medianAverage: median,
    dungeonsUsed: averages.dungeonsUsed,
    state: "AVAILABLE",
  };
}
