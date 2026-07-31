import { clamp01 } from "../math.js";
import { MIN_USABLE_HIGH_KEY_RUNS, SCORE_GAP_ONSET, SCORE_GAP_SATURATION } from "./constants.js";
import { buildAlignedRunGaps } from "./time-aligned.js";
import type {
  BoostShadowRatingSnapshotInput,
  BoostShadowRunInput,
  FeatureComputeResult,
} from "./types.js";

function normalizeGap(meanGap: number): number {
  if (meanGap <= SCORE_GAP_ONSET) return 0;
  return clamp01((meanGap - SCORE_GAP_ONSET) / (SCORE_GAP_SATURATION - SCORE_GAP_ONSET));
}

/**
 * Time-aligned Mythic+ rating gap vs teammates on high keys.
 * Current-score substitution is rejected by the alignment hierarchy.
 */
export function computeTeammateScoreGap(args: {
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

  const usable = gaps.filter((g) => g.meanPositiveGap != null || g.teammateGaps.length > 0);
  if (usable.length < MIN_USABLE_HIGH_KEY_RUNS) {
    const reason =
      runsMissingSubjectRating > 0
        ? "NO_TIME_ALIGNED_SUBJECT_RATING"
        : "NO_TIME_ALIGNED_GAPS";
    return {
      status: "omitted",
      reasonCode: reason,
      diagnostics: {
        meanAlignedTeammateGap: null,
      },
    };
  }

  const positiveMeans = usable
    .map((g) => g.meanPositiveGap)
    .filter((v): v is number => v != null);
  const meanAlignedTeammateGap =
    positiveMeans.length > 0
      ? positiveMeans.reduce((a, b) => a + b, 0) / positiveMeans.length
      : 0;

  const coverage = usable.length / args.highKeyRuns.length;
  const value = normalizeGap(meanAlignedTeammateGap);
  const confidence = clamp01(
    0.35 + 0.5 * coverage + (runsMissingSubjectRating === 0 ? 0.15 : 0),
  );

  return {
    status: "computed",
    evidence: {
      value,
      confidence,
      sampleSize: usable.length,
      coverage,
    },
    diagnostics: { meanAlignedTeammateGap },
  };
}
