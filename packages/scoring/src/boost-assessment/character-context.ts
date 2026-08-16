import { PERCENTILE_BPS_P99, PERCENTILE_BPS_P99_9 } from "@mplus/contracts";
import { BOOST_ASSESSMENT_POLICY } from "./policy.js";
import type { SeasonHighKeyContext } from "./types.js";

/**
 * Exceptional operating level is a CHARACTER property from score-context
 * applied median-key percentile — not from individual high keys.
 */
export function isExceptionalOperatingLevel(
  context: SeasonHighKeyContext,
): boolean {
  if (context.exceptionalOperatingLevel === true) return true;
  const bps = context.subjectMedianKeyPercentileBps;
  if (bps == null || !Number.isFinite(bps)) return false;
  return bps >= BOOST_ASSESSMENT_POLICY.exceptionalPercentileBpsMin;
}

export function p99P999FromPoints(
  points: readonly { percentileBps: number; medianKeyThreshold: number }[],
): { p99: number | null; p999: number | null } {
  return {
    p99: points.find((p) => p.percentileBps === PERCENTILE_BPS_P99)?.medianKeyThreshold ?? null,
    p999: points.find((p) => p.percentileBps === PERCENTILE_BPS_P99_9)?.medianKeyThreshold ?? null,
  };
}
