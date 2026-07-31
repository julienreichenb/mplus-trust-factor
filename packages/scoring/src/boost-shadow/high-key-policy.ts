import {
  HIGH_KEY_POLICY_VERSION,
  HIGH_KEY_SUBJECT_RELATIVE_DISTANCE,
  HIGH_KEY_TOP_N,
} from "./constants.js";
import type { BoostShadowRunInput } from "./types.js";

export type HighKeyExclusionReason =
  | "MISSING_COMPLETED_AT"
  | "SEASON_MISMATCH"
  | "BELOW_SUBJECT_RELATIVE_BAND"
  | "OUTSIDE_TOP_N";

export interface HighKeySetResult {
  highKeyPolicyVersion: typeof HIGH_KEY_POLICY_VERSION;
  eligible: BoostShadowRunInput[];
  runsEligible: number;
  runsExcluded: number;
  exclusionReasonCounts: Record<string, number>;
  subjectSeasonBestKey: number | null;
}

function bump(counts: Record<string, number>, reason: HighKeyExclusionReason): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

/**
 * Shared season-aware high-key policy for gap / cohort / concentration.
 * Features must not redefine high-key silently.
 */
export function selectHighKeySet(
  runs: BoostShadowRunInput[],
  seasonId: string,
): HighKeySetResult {
  const exclusionReasonCounts: Record<string, number> = {};
  const seasonRuns: BoostShadowRunInput[] = [];

  for (const run of runs) {
    if (run.seasonId !== seasonId) {
      bump(exclusionReasonCounts, "SEASON_MISMATCH");
      continue;
    }
    if (!run.completedAt) {
      bump(exclusionReasonCounts, "MISSING_COMPLETED_AT");
      continue;
    }
    seasonRuns.push(run);
  }

  let subjectSeasonBestKey: number | null = null;
  for (const run of seasonRuns) {
    if (subjectSeasonBestKey === null || run.keyLevel > subjectSeasonBestKey) {
      subjectSeasonBestKey = run.keyLevel;
    }
  }

  if (subjectSeasonBestKey === null) {
    return {
      highKeyPolicyVersion: HIGH_KEY_POLICY_VERSION,
      eligible: [],
      runsEligible: 0,
      runsExcluded: runs.length,
      exclusionReasonCounts,
      subjectSeasonBestKey: null,
    };
  }

  const minKey = Math.max(2, subjectSeasonBestKey - HIGH_KEY_SUBJECT_RELATIVE_DISTANCE);
  const relative: BoostShadowRunInput[] = [];
  for (const run of seasonRuns) {
    if (run.keyLevel < minKey) {
      bump(exclusionReasonCounts, "BELOW_SUBJECT_RELATIVE_BAND");
      continue;
    }
    relative.push(run);
  }

  const ranked = [...relative].sort((a, b) => {
    if (b.keyLevel !== a.keyLevel) return b.keyLevel - a.keyLevel;
    return (b.scoreValue ?? 0) - (a.scoreValue ?? 0);
  });

  const eligible = ranked.slice(0, HIGH_KEY_TOP_N);
  const outsideTopN = ranked.length - eligible.length;
  if (outsideTopN > 0) {
    exclusionReasonCounts.OUTSIDE_TOP_N = outsideTopN;
  }

  const excludedFromPolicy =
    Object.values(exclusionReasonCounts).reduce((a, b) => a + b, 0);

  return {
    highKeyPolicyVersion: HIGH_KEY_POLICY_VERSION,
    eligible,
    runsEligible: eligible.length,
    runsExcluded: excludedFromPolicy,
    exclusionReasonCounts,
    subjectSeasonBestKey,
  };
}
