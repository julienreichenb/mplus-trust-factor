import { clamp01 } from "../math.js";
import {
  COHORT_MIN_SHARED_HIGH_KEYS,
  COHORT_SATURATION_FRACTION,
  COHORT_TOP_N,
  MIN_USABLE_HIGH_KEY_RUNS,
  STRONG_TEAMMATE_GAP_ONSET,
} from "./constants.js";
import { buildAlignedRunGaps } from "./time-aligned.js";
import type {
  BoostShadowRatingSnapshotInput,
  BoostShadowRunInput,
  FeatureComputeResult,
} from "./types.js";

/**
 * Recurrence of the same substantially stronger teammates across the high-key set.
 * Requires time-aligned gap evidence. Repeated roster alone is not boosting evidence.
 */
export function computeRepeatedStrongerTeammateCohort(args: {
  highKeyRuns: BoostShadowRunInput[];
  subjectCharacterId: string;
  seasonId: string;
  ratingSnapshots?: BoostShadowRatingSnapshotInput[];
}): FeatureComputeResult {
  if (args.highKeyRuns.length < MIN_USABLE_HIGH_KEY_RUNS) {
    return { status: "omitted", reasonCode: "INSUFFICIENT_HIGH_KEYS" };
  }

  const { gaps, runsMissingSubjectRating } = buildAlignedRunGaps({
    runs: args.highKeyRuns,
    subjectCharacterId: args.subjectCharacterId,
    seasonId: args.seasonId,
    ratingSnapshots: args.ratingSnapshots,
  });

  if (gaps.length < MIN_USABLE_HIGH_KEY_RUNS) {
    return {
      status: "omitted",
      reasonCode:
        runsMissingSubjectRating > 0
          ? "NO_TIME_ALIGNED_SUBJECT_RATING"
          : "NO_TIME_ALIGNED_GAPS",
    };
  }

  const sharedByTeammate = new Map<string, number>();
  let fallbackIdentityShares = 0;
  for (const gap of gaps) {
    const strongKeys = new Set<string>();
    for (const t of gap.teammateGaps) {
      if (t.gap < STRONG_TEAMMATE_GAP_ONSET) continue;
      if (t.identityConfidence === "normalized_fallback") fallbackIdentityShares += 1;
      strongKeys.add(t.canonicalKey);
    }
    for (const key of strongKeys) {
      sharedByTeammate.set(key, (sharedByTeammate.get(key) ?? 0) + 1);
    }
  }

  const recurrent = [...sharedByTeammate.entries()]
    .filter(([, shared]) => shared >= COHORT_MIN_SHARED_HIGH_KEYS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, COHORT_TOP_N);

  const topCohortSharedHighKeys = recurrent[0]?.[1] ?? 0;
  const eligibleCount = gaps.length;
  const fraction =
    eligibleCount > 0 ? topCohortSharedHighKeys / eligibleCount : 0;
  const value = clamp01(fraction / COHORT_SATURATION_FRACTION);

  const coverage = gaps.length / args.highKeyRuns.length;
  const confidence = clamp01(
    0.3 +
      0.45 * coverage -
      (fallbackIdentityShares > 0 ? 0.15 : 0) +
      (runsMissingSubjectRating === 0 ? 0.1 : 0),
  );

  return {
    status: "computed",
    evidence: {
      value,
      confidence: Math.max(0, confidence),
      sampleSize: gaps.length,
      coverage,
    },
    diagnostics: { topCohortSharedHighKeys },
  };
}
