import { PERFORMANCE_V2_MODEL_CONFIG, type PerformanceV2ModelConfig } from "./constants.js";
import type {
  PerformanceProfileAggregateFactV2,
  PerformanceProfileDungeonAggregateV2,
} from "./types.js";

function meanOfValid(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/**
 * Profile stabilizer: 0.45 × best + 0.55 × median.
 * When only one signal exists, use it without inventing the other.
 */
export function computeProfilePerformance(
  profile: PerformanceProfileAggregateFactV2 | null,
  config: PerformanceV2ModelConfig = PERFORMANCE_V2_MODEL_CONFIG,
): number | null {
  if (profile == null) return null;
  const best = profile.bestDpsPercentileAverage;
  const median = profile.medianDpsPercentileAverage;
  const bestOk = best != null && Number.isFinite(best);
  const medianOk = median != null && Number.isFinite(median);
  if (!bestOk && !medianOk) return null;
  if (bestOk && medianOk) {
    return (
      config.profileWeights.bestAverage * best! +
      config.profileWeights.medianAverage * median!
    );
  }
  return bestOk ? best! : median!;
}

/**
 * Equal-weight active-dungeon recompute of the same stabilizer for diagnostics.
 */
export function computeEqualDungeonProfilePerformance(
  perDungeon: PerformanceProfileDungeonAggregateV2[],
  activeDungeonSlugs: string[],
  config: PerformanceV2ModelConfig = PERFORMANCE_V2_MODEL_CONFIG,
): number | null {
  const active = new Set(activeDungeonSlugs);
  const rows = perDungeon.filter((d) => active.has(d.dungeonSlug));
  const bestAvg = meanOfValid(rows.map((d) => d.bestParsePercentile));
  const medianAvg = meanOfValid(rows.map((d) => d.medianParsePercentile));
  if (bestAvg == null && medianAvg == null) return null;
  if (bestAvg != null && medianAvg != null) {
    return (
      config.profileWeights.bestAverage * bestAvg +
      config.profileWeights.medianAverage * medianAvg
    );
  }
  return bestAvg ?? medianAvg;
}
