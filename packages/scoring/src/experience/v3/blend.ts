import { clamp, safeDivide } from "../../math.js";
import type { ExperienceV3ModelConfig } from "./constants.js";
import type {
  ExperienceV3ComponentKey,
  ExperienceV3ComponentResult,
} from "./types.js";

const COMPONENT_WEIGHT_KEYS: Record<
  ExperienceV3ComponentKey,
  keyof ExperienceV3ModelConfig["componentWeights"]
> = {
  currentExposure: "currentExposure",
  previousSeasonStrength: "previousSeasonStrength",
  eliteHistory: "eliteHistory",
  historicalRank: "historicalRank",
};

/**
 * Assign configured weights and renormalize over available components only.
 * Unavailable optional components are excluded — never zero-filled into the blend.
 */
export function blendExperienceComponentsV3(
  components: ExperienceV3ComponentResult[],
  config: ExperienceV3ModelConfig,
): {
  score: number | null;
  components: ExperienceV3ComponentResult[];
  availableWeightSum: number;
  renormalized: boolean;
} {
  const withWeights = components.map((c) => {
    const weightKey = COMPONENT_WEIGHT_KEYS[c.key];
    const weight = config.componentWeights[weightKey];
    return { ...c, weight };
  });

  const available = withWeights.filter((c) => c.available && c.score != null);
  const availableWeightSum = available.reduce((s, c) => s + c.weight, 0);

  if (availableWeightSum <= 0 || available.length === 0) {
    return {
      score: null,
      components: withWeights.map((c) => ({ ...c, effectiveWeight: 0 })),
      availableWeightSum: 0,
      renormalized: false,
    };
  }

  const configuredSum =
    config.componentWeights.currentExposure +
    config.componentWeights.previousSeasonStrength +
    config.componentWeights.eliteHistory +
    config.componentWeights.historicalRank;
  const renormalized = Math.abs(availableWeightSum - configuredSum) > 1e-9;

  let blended = 0;
  const result = withWeights.map((c) => {
    if (!c.available || c.score == null) {
      return { ...c, effectiveWeight: 0 };
    }
    const effectiveWeight = c.weight / availableWeightSum;
    blended += c.score * effectiveWeight;
    return { ...c, effectiveWeight };
  });

  return {
    score: clamp(blended, 0, 100),
    components: result,
    availableWeightSum,
    renormalized,
  };
}

export function effectiveWeightOrZero(
  components: ExperienceV3ComponentResult[],
  key: ExperienceV3ComponentKey,
): number {
  return components.find((c) => c.key === key)?.effectiveWeight ?? 0;
}

export function componentScoreOrNull(
  components: ExperienceV3ComponentResult[],
  key: ExperienceV3ComponentKey,
): number | null {
  const c = components.find((x) => x.key === key);
  return c?.available ? (c.score ?? null) : null;
}

export function coverageRatio(present: number, expected: number): number {
  return clamp(safeDivide(present, Math.max(1, expected), 0), 0, 1);
}
