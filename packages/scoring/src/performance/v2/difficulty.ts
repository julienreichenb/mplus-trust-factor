import { clamp } from "../../math.js";
import { PERFORMANCE_V2_MODEL_CONFIG, type PerformanceV2ModelConfig } from "./constants.js";
import type { SeasonDifficultyPolicyV2 } from "./types.js";

export interface DifficultyMultiplierKnot {
  keyLevel: number;
  multiplier: number;
}

/**
 * Build ordered difficulty knots from Season Difficulty Policy + model defaults.
 */
export function buildDifficultyMultiplierKnots(
  policy: Pick<SeasonDifficultyPolicyV2, "k50" | "k90" | "k99">,
  config: PerformanceV2ModelConfig = PERFORMANCE_V2_MODEL_CONFIG,
): DifficultyMultiplierKnot[] {
  const { difficultyMultipliers, lowKeyBaseline } = config;
  const knots: DifficultyMultiplierKnot[] = [
    { keyLevel: lowKeyBaseline, multiplier: difficultyMultipliers.atOrBelowLowBaseline },
    { keyLevel: policy.k50, multiplier: difficultyMultipliers.atK50 },
    { keyLevel: policy.k90, multiplier: difficultyMultipliers.atK90 },
    { keyLevel: policy.k99, multiplier: difficultyMultipliers.atK99 },
  ];
  // Stable sort; identical keys keep earlier (lower baseline) first then overwrite via lerp.
  return knots.sort((a, b) => a.keyLevel - b.keyLevel);
}

/**
 * Linear difficulty multiplier interpolation.
 * at/below low baseline → 0.75; at k50/k90/k99 as configured; above k99 → cap 1.15.
 */
export function interpolateDifficultyMultiplier(
  keyLevel: number,
  policy: Pick<SeasonDifficultyPolicyV2, "k50" | "k90" | "k99">,
  config: PerformanceV2ModelConfig = PERFORMANCE_V2_MODEL_CONFIG,
): number {
  if (!Number.isFinite(keyLevel) || keyLevel <= 0) {
    return config.difficultyMultipliers.atOrBelowLowBaseline;
  }

  const knots = buildDifficultyMultiplierKnots(policy, config);
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  const cap = config.difficultyMultipliers.aboveK99Cap;

  if (keyLevel <= first.keyLevel) return first.multiplier;
  if (keyLevel > last.keyLevel) return cap;

  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i]!;
    const b = knots[i + 1]!;
    if (keyLevel >= a.keyLevel && keyLevel <= b.keyLevel) {
      if (b.keyLevel === a.keyLevel) return b.multiplier;
      const t = (keyLevel - a.keyLevel) / (b.keyLevel - a.keyLevel);
      return a.multiplier + t * (b.multiplier - a.multiplier);
    }
  }

  return last.multiplier;
}

/**
 * Compress low-key extremes and amplify high-key deviations around neutral 50.
 * adjustedParse = clamp(50 + (parse - 50) × multiplier, 0, 100)
 */
export function adjustParseForDifficulty(
  parsePercentile: number,
  keyLevel: number,
  policy: Pick<SeasonDifficultyPolicyV2, "k50" | "k90" | "k99">,
  config: PerformanceV2ModelConfig = PERFORMANCE_V2_MODEL_CONFIG,
): { difficultyMultiplier: number; adjustedParse: number } {
  const difficultyMultiplier = interpolateDifficultyMultiplier(keyLevel, policy, config);
  const center = config.parseCenter;
  const adjustedParse = clamp(
    center + (parsePercentile - center) * difficultyMultiplier,
    0,
    100,
  );
  return { difficultyMultiplier, adjustedParse };
}
