import { PERCENTILE_BPS_P99 } from "@mplus/contracts";
import {
  BOOST_ASSESSMENT_POLICY,
  type SeasonHighKeyContext,
} from "@mplus/scoring";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function seasonHighKeyContextFromApplied(
  applied: unknown,
  timedRunCountUsedForMedian: number,
): SeasonHighKeyContext {
  const root = asRecord(applied);
  const key = asRecord(root?.key);
  if (!key || key.status !== "AVAILABLE") {
    return {
      available: false,
      contextRevisionId: typeof root?.contextRevisionId === "string" ? root.contextRevisionId : null,
      contextRevisionKey: typeof root?.contextRevisionKey === "string" ? root.contextRevisionKey : "none",
      distributionSnapshotId:
        typeof root?.distributionSnapshotId === "string" ? root.distributionSnapshotId : null,
      p99KeyThreshold: null,
      p999KeyThreshold: null,
      appliedAnchorPercentileLabel: null,
      subjectMedianTimedKey: null,
      subjectMedianKeyPercentileBps: null,
      subjectMedianKeyPercentileLabel: null,
      timedRunCountUsedForMedian,
      exceptionalOperatingLevel: false,
      canonicalSelectionComplete: false,
      missingReason: "MISSING_SEASON_CONTEXT",
    };
  }
  const appliedBps =
    typeof key.appliedAnchorPercentileBps === "number" ? key.appliedAnchorPercentileBps : null;
  const p99 =
    typeof key.appliedAnchorKeyThreshold === "number" ? key.appliedAnchorKeyThreshold : null;
  const label =
    typeof key.appliedAnchorPercentileLabel === "string" ? key.appliedAnchorPercentileLabel : null;
  return {
    available: true,
    contextRevisionId: typeof root?.contextRevisionId === "string" ? root.contextRevisionId : null,
    contextRevisionKey: typeof root?.contextRevisionKey === "string" ? root.contextRevisionKey : "none",
    distributionSnapshotId:
      typeof key.distributionSnapshotId === "string" ? key.distributionSnapshotId : null,
    p99KeyThreshold: key.appliedAnchorPercentileBps === PERCENTILE_BPS_P99 ? p99 : p99,
    p999KeyThreshold:
      typeof key.nextAnchorKeyThreshold === "number" ? key.nextAnchorKeyThreshold : null,
    appliedAnchorPercentileLabel: label,
    subjectMedianTimedKey: typeof key.medianKeyLevel === "number" ? key.medianKeyLevel : null,
    subjectMedianKeyPercentileBps: appliedBps,
    subjectMedianKeyPercentileLabel: label,
    timedRunCountUsedForMedian,
    exceptionalOperatingLevel:
      appliedBps != null && appliedBps >= BOOST_ASSESSMENT_POLICY.exceptionalPercentileBpsMin,
    canonicalSelectionComplete: true,
  };
}
