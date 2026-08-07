/**
 * Experience Phase 1 — pure calculator.
 *
 * Combines previous-season relative standing with elite 0.1% cutoff history.
 * Provider-free. Not wired into production scoring.
 */

import type { EliteCutoffHistoryEvidence } from "./elite-cutoff-history.js";
import type { PreviousSeasonRelativeStanding } from "./season-population-policy.js";

export const EXPERIENCE_PHASE1_ELITE_FLOOR = 90;
export const EXPERIENCE_PHASE1_BELOW_TOP40_SCORE = 25;
export const EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE = 0;

/** Standing → Experience score anchors (topPercent lower is better). */
export const EXPERIENCE_PHASE1_STANDING_SCORE_ANCHORS = Object.freeze([
  Object.freeze({ topPercent: 0.1, score: 100 }),
  Object.freeze({ topPercent: 1, score: 90 }),
  Object.freeze({ topPercent: 10, score: 75 }),
  Object.freeze({ topPercent: 25, score: 60 }),
  Object.freeze({ topPercent: 40, score: 45 }),
] as const);

export type ExperiencePhase1PreviousEvidence =
  | { state: "STANDING"; standing: PreviousSeasonRelativeStanding }
  | { state: "CONFIRMED_NO_ACTIVITY" }
  | { state: "UNAVAILABLE"; reason?: string };

export type ExperiencePhase1UnavailableReason =
  | "NO_USABLE_EVIDENCE"
  | "PREVIOUS_EVIDENCE_UNAVAILABLE";

export interface ExperiencePhase1Result {
  score: number | null;
  available: boolean;
  previousStandingScore: number | null;
  eliteFloorApplied: boolean;
  confirmedEliteTitleCount: number;
  reason: ExperiencePhase1UnavailableReason | null;
}

export interface CalculateExperiencePhase1Input {
  previous: ExperiencePhase1PreviousEvidence;
  elite: Pick<EliteCutoffHistoryEvidence, "confirmedCount"> | EliteCutoffHistoryEvidence;
}

/**
 * Map an estimated population topPercent onto 0–100 using piecewise-linear anchors.
 * Does not extrapolate beyond top 40% (caller uses below-range floor separately).
 */
export function scoreFromEstimatedTopPercent(estimatedTopPercent: number): number {
  if (!Number.isFinite(estimatedTopPercent)) {
    return EXPERIENCE_PHASE1_BELOW_TOP40_SCORE;
  }
  const anchors = EXPERIENCE_PHASE1_STANDING_SCORE_ANCHORS;
  if (estimatedTopPercent <= anchors[0]!.topPercent) {
    return anchors[0]!.score;
  }
  const last = anchors[anchors.length - 1]!;
  if (estimatedTopPercent >= last.topPercent) {
    return last.score;
  }
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const lo = anchors[i]!;
    const hi = anchors[i + 1]!;
    if (estimatedTopPercent >= lo.topPercent && estimatedTopPercent <= hi.topPercent) {
      const span = hi.topPercent - lo.topPercent;
      if (span === 0) return lo.score;
      const t = (estimatedTopPercent - lo.topPercent) / span;
      return lo.score + t * (hi.score - lo.score);
    }
  }
  return EXPERIENCE_PHASE1_BELOW_TOP40_SCORE;
}

/**
 * Convert a PreviousSeasonRelativeStanding into a previous-standing Experience score.
 */
export function scorePreviousSeasonStanding(
  standing: PreviousSeasonRelativeStanding,
): number {
  if (
    standing.estimatedTopPercent == null ||
    standing.method === "BELOW_SUPPORTED_RANGE" ||
    standing.band === "BELOW_TOP_40" ||
    standing.band === "BELOW_SUPPORTED_RANGE"
  ) {
    return EXPERIENCE_PHASE1_BELOW_TOP40_SCORE;
  }
  return scoreFromEstimatedTopPercent(standing.estimatedTopPercent);
}

/**
 * Pure Experience Phase 1 calculator.
 */
export function calculateExperiencePhase1(
  input: CalculateExperiencePhase1Input,
): ExperiencePhase1Result {
  const confirmedEliteTitleCount = Math.max(0, input.elite.confirmedCount | 0);
  const hasElite = confirmedEliteTitleCount > 0;
  const eliteFloor = hasElite ? EXPERIENCE_PHASE1_ELITE_FLOOR : null;

  let previousStandingScore: number | null = null;

  if (input.previous.state === "STANDING") {
    previousStandingScore = scorePreviousSeasonStanding(input.previous.standing);
  } else if (input.previous.state === "CONFIRMED_NO_ACTIVITY") {
    previousStandingScore = EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE;
  }

  if (previousStandingScore != null) {
    const score =
      eliteFloor != null
        ? Math.max(previousStandingScore, eliteFloor)
        : previousStandingScore;
    return {
      score,
      available: true,
      previousStandingScore,
      eliteFloorApplied: eliteFloor != null && score === eliteFloor && previousStandingScore < eliteFloor,
      confirmedEliteTitleCount,
      reason: null,
    };
  }

  // Previous evidence unavailable.
  if (eliteFloor != null) {
    return {
      score: eliteFloor,
      available: true,
      previousStandingScore: null,
      eliteFloorApplied: true,
      confirmedEliteTitleCount,
      reason: null,
    };
  }

  return {
    score: null,
    available: false,
    previousStandingScore: null,
    eliteFloorApplied: false,
    confirmedEliteTitleCount: 0,
    reason:
      input.previous.state === "UNAVAILABLE"
        ? "PREVIOUS_EVIDENCE_UNAVAILABLE"
        : "NO_USABLE_EVIDENCE",
  };
}
