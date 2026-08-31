/**
 * Pure classification for relevant-character background refresh.
 */
import { decideScoreRefresh, type ScoreRefreshDecisionInput } from "@mplus/config";

export type RelevantCharacterClass = "NEW" | "STALE" | "FRESH";

export function classifyRelevantCharacterRefresh(input: ScoreRefreshDecisionInput): RelevantCharacterClass {
  const decision = decideScoreRefresh(input);
  if (decision.action === "ENQUEUE" && decision.reason === "NO_PUBLISHED_SCORE") {
    return "NEW";
  }
  if (decision.action === "ENQUEUE" && decision.reason === "SCORE_TTL_EXPIRED") {
    return "STALE";
  }
  if (decision.action === "REUSE_ACTIVE_JOB") {
    return "FRESH";
  }
  if (decision.action === "NONE" && decision.reason === "WITHIN_SCORE_TTL") {
    return "FRESH";
  }
  if (decision.action === "BACKOFF") {
    return "FRESH";
  }
  if (decision.action === "ENQUEUE") {
    return "STALE";
  }
  return "FRESH";
}

export function priorityForRelevantClass(
  characterClass: RelevantCharacterClass,
): "normal" | "low" {
  return characterClass === "NEW" ? "normal" : "low";
}
