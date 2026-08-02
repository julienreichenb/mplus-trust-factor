import { clamp } from "../../math.js";
import { PERFORMANCE_V2_MODEL_CONFIG } from "./constants.js";
import { adjustParseForDifficulty } from "./difficulty.js";
import { resolveValidatedParsePercentile } from "./role-adapter.js";
import type {
  PerformanceAdjustedParseV2,
  PerformanceDungeonScoreV2,
  PerformanceRunParseFactV2,
  SeasonDifficultyPolicyV2,
} from "./types.js";

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Score one dungeon from one or two selected valid parses.
 * Missing second run is never imputed as zero.
 */
export function computeDungeonPerformance(
  runs: PerformanceAdjustedParseV2[],
  config: typeof PERFORMANCE_V2_MODEL_CONFIG = PERFORMANCE_V2_MODEL_CONFIG,
): PerformanceDungeonScoreV2 | null {
  if (runs.length === 0) return null;

  const dungeonSlug = runs[0]!.dungeonSlug;
  const ordered = [...runs].sort((a, b) => a.slotId.localeCompare(b.slotId));

  if (ordered.length === 1) {
    const only = ordered[0]!;
    return {
      dungeonSlug,
      runCount: 1,
      peak: only.adjustedParse,
      floor: only.adjustedParse,
      consistency: null,
      dungeonPerformance: only.adjustedParse,
      runs: ordered,
      oneRunConfidenceCapped: true,
    };
  }

  const a = ordered[0]!;
  const b = ordered[1]!;
  const peak = Math.max(a.adjustedParse, b.adjustedParse);
  const floor = Math.min(a.adjustedParse, b.adjustedParse);
  // Consistency uses raw parses (spec §6 / §10).
  const consistency = clamp(100 - Math.abs(a.rawParsePercentile - b.rawParsePercentile), 0, 100);
  const { peak: wPeak, floor: wFloor, consistency: wCons } = config.dungeonWeights;
  const dungeonPerformance = wPeak * peak + wFloor * floor + wCons * consistency;

  return {
    dungeonSlug,
    runCount: 2,
    peak,
    floor,
    consistency,
    dungeonPerformance,
    runs: ordered.slice(0, 2),
    oneRunConfidenceCapped: false,
  };
}

/**
 * Adjust valid slot parse facts and aggregate equal-weight dungeon scores.
 * Does not re-select runs — caller supplies frozen-manifest-bound facts only.
 */
export function computeDetailedSeasonPerformance(input: {
  runParseFacts: PerformanceRunParseFactV2[];
  activeDungeonSlugs: string[];
  difficultyPolicy: SeasonDifficultyPolicyV2;
  runParseAllowed: boolean;
  config?: typeof PERFORMANCE_V2_MODEL_CONFIG;
}): {
  dungeons: PerformanceDungeonScoreV2[];
  detailedSeasonPerformance: number | null;
  validDetailedSlotCount: number;
  twoRunDungeonCount: number;
  oneRunDungeonCount: number;
} {
  const config = input.config ?? PERFORMANCE_V2_MODEL_CONFIG;
  if (!input.runParseAllowed) {
    return {
      dungeons: [],
      detailedSeasonPerformance: null,
      validDetailedSlotCount: 0,
      twoRunDungeonCount: 0,
      oneRunDungeonCount: 0,
    };
  }

  const active = new Set(input.activeDungeonSlugs);
  const byDungeon = new Map<string, PerformanceAdjustedParseV2[]>();

  for (const fact of input.runParseFacts) {
    if (!active.has(fact.dungeonSlug)) continue;
    const validated = resolveValidatedParsePercentile({
      parsePercentile: fact.parsePercentile,
      semantic: fact.semantic,
    });
    if (!validated.accepted || validated.parsePercentile == null) continue;

    const { difficultyMultiplier, adjustedParse } = adjustParseForDifficulty(
      validated.parsePercentile,
      fact.keyLevel,
      input.difficultyPolicy,
      config,
    );

    const adjusted: PerformanceAdjustedParseV2 = {
      slotId: fact.slotId,
      dungeonSlug: fact.dungeonSlug,
      keyLevel: fact.keyLevel,
      rawParsePercentile: validated.parsePercentile,
      semantic: fact.semantic,
      difficultyMultiplier,
      adjustedParse,
    };

    const list = byDungeon.get(fact.dungeonSlug) ?? [];
    list.push(adjusted);
    byDungeon.set(fact.dungeonSlug, list);
  }

  const dungeons: PerformanceDungeonScoreV2[] = [];
  for (const slug of input.activeDungeonSlugs) {
    const runs = byDungeon.get(slug);
    if (!runs || runs.length === 0) continue;
    // At most two slots per dungeon (manifest contract); ignore extras deterministically.
    const capped = [...runs].sort((a, b) => a.slotId.localeCompare(b.slotId)).slice(0, 2);
    const scored = computeDungeonPerformance(capped, config);
    if (scored) dungeons.push(scored);
  }

  const detailedSeasonPerformance = mean(dungeons.map((d) => d.dungeonPerformance));
  const validDetailedSlotCount = dungeons.reduce((s, d) => s + d.runCount, 0);
  const twoRunDungeonCount = dungeons.filter((d) => d.runCount === 2).length;
  const oneRunDungeonCount = dungeons.filter((d) => d.runCount === 1).length;

  return {
    dungeons,
    detailedSeasonPerformance,
    validDetailedSlotCount,
    twoRunDungeonCount,
    oneRunDungeonCount,
  };
}
