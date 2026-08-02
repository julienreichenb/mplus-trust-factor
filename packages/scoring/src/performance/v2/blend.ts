import { clamp01 } from "../../math.js";
import { PERFORMANCE_V2_MODEL_CONFIG } from "./constants.js";

/**
 * slotCoverage = validDetailedSlots / expectedSlots
 * detailedWeight = 0 when coverage is 0;
 * else min(0.85, 0.25 + 0.60 × coverage^1.5)
 */
export function computeDetailedWeight(
  validDetailedSlotCount: number,
  expectedSlotCount: number,
  config: typeof PERFORMANCE_V2_MODEL_CONFIG = PERFORMANCE_V2_MODEL_CONFIG,
): { slotCoverage: number; detailedWeight: number } {
  const expected = Math.max(0, expectedSlotCount);
  const slotCoverage =
    expected === 0 ? 0 : clamp01(Math.max(0, validDetailedSlotCount) / expected);

  if (slotCoverage === 0) {
    return { slotCoverage, detailedWeight: 0 };
  }

  const { detailedWeightFloor, detailedWeightSlope, detailedWeightCoverageExponent, detailedWeightCap } =
    config.blend;
  const curved =
    detailedWeightFloor +
    detailedWeightSlope * Math.pow(slotCoverage, detailedWeightCoverageExponent);
  return {
    slotCoverage,
    detailedWeight: Math.min(detailedWeightCap, curved),
  };
}

/**
 * Blend detailed + profile. If only one source exists, use it alone
 * (caller reduces confidence separately).
 */
export function blendPerformanceSources(input: {
  detailedSeasonPerformance: number | null;
  profilePerformance: number | null;
  detailedWeight: number;
}): { score: number | null; effectiveDetailedWeight: number; sourcesUsed: "both" | "detailed" | "profile" | "none" } {
  const detailedOk =
    input.detailedSeasonPerformance != null &&
    Number.isFinite(input.detailedSeasonPerformance);
  const profileOk =
    input.profilePerformance != null && Number.isFinite(input.profilePerformance);

  if (!detailedOk && !profileOk) {
    return { score: null, effectiveDetailedWeight: 0, sourcesUsed: "none" };
  }
  if (detailedOk && !profileOk) {
    return {
      score: input.detailedSeasonPerformance!,
      effectiveDetailedWeight: 1,
      sourcesUsed: "detailed",
    };
  }
  if (!detailedOk && profileOk) {
    return {
      score: input.profilePerformance!,
      effectiveDetailedWeight: 0,
      sourcesUsed: "profile",
    };
  }

  const w = clamp01(input.detailedWeight);
  const score =
    w * input.detailedSeasonPerformance! + (1 - w) * input.profilePerformance!;
  return { score, effectiveDetailedWeight: w, sourcesUsed: "both" };
}
