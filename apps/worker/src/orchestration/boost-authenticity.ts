import type { RaiderIoBoostSupportFacts } from "@mplus/contracts";
import type { AuthenticityFeatureInput } from "@mplus/scoring";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Maps Raider.IO boost-support facts into scoring authenticity feature severities (0–1). */
export function mapBoostFactsToAuthenticity(
  facts: RaiderIoBoostSupportFacts,
): AuthenticityFeatureInput {
  const currentScore = facts.currentSeasonScore ?? 0;
  const topRecurrence = [...facts.teammateRecurrence].sort(
    (a, b) => b.sharedRunCount - a.sharedRunCount,
  )[0];

  let repeatedStrongerTeammates = 0;
  if (topRecurrence && topRecurrence.sharedRunCount >= 2) {
    const teammateAvg = topRecurrence.averageTeammateScore ?? 0;
    if (currentScore > 0 && teammateAvg > currentScore * 1.1) {
      repeatedStrongerTeammates = clamp01(topRecurrence.sharedRunCount / 8);
    }
  }

  const lowVolumeForScore =
    facts.representedRunCount < 20
      ? clamp01((20 - facts.representedRunCount) / 20)
      : 0;

  const topRunRosterConcentration = topRecurrence
    ? clamp01(topRecurrence.sharedRunCount / Math.max(facts.runs.length, 1))
    : 0;

  let progressionKeyJump = 0;
  if (facts.previousSeasonScore !== null && facts.currentSeasonScore !== null) {
    const jump = facts.currentSeasonScore - facts.previousSeasonScore;
    if (jump > 600) {
      progressionKeyJump = clamp01(jump / 1800);
    }
  }

  const isProbableReroll =
    facts.previousSeasonScore === null && currentScore >= 2200 && facts.representedRunCount < 30;

  return {
    repeatedStrongerTeammates,
    lowVolumeForScore,
    topRunRosterConcentration,
    progressionKeyJump,
    lackIntermediateProgression: facts.historyIncomplete ? 0.35 : 0,
    isProbableReroll,
    probableReroll: isProbableReroll ? 0.55 : 0,
  };
}
