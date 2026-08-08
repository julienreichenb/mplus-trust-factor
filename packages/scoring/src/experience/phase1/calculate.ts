/**
 * Experience Phase 1 — pure calculator.
 *
 * Combines previous-season relative standing, previous-season regional class
 * rank floor, and elite 0.1% cutoff history via max (not a weighted blend).
 * Provider-free.
 *
 * Availability: score 0 is valid when absence of history is resolved.
 * unavailable/null is reserved for provider/config/integrity failures.
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

/** Previous-season regional class rank → Experience floor (rank lower is better). */
export const EXPERIENCE_PHASE1_CLASS_RANK_FLOOR_ANCHORS = Object.freeze([
  Object.freeze({ maxRank: 5, floor: 100 }),
  Object.freeze({ maxRank: 10, floor: 97 }),
  Object.freeze({ maxRank: 20, floor: 94 }),
  Object.freeze({ maxRank: 50, floor: 90 }),
  Object.freeze({ maxRank: 100, floor: 85 }),
] as const);

export type ExperiencePhase1PreviousEvidence =
  | { state: "STANDING"; standing: PreviousSeasonRelativeStanding }
  | { state: "CONFIRMED_NO_ACTIVITY" }
  | { state: "UNAVAILABLE"; reason?: string };

/**
 * Elite evidence must distinguish a successful empty fetch from acquisition failure.
 * Legacy `{ confirmedCount }` / EliteCutoffHistoryEvidence is treated as OK.
 */
export type ExperiencePhase1EliteEvidence =
  | { state: "OK"; confirmedCount: number }
  | { state: "UNAVAILABLE"; reason?: string };

export type ExperiencePhase1UnavailableReason =
  | "NO_USABLE_EVIDENCE"
  | "PREVIOUS_EVIDENCE_UNAVAILABLE"
  | "ELITE_EVIDENCE_UNAVAILABLE";

export interface ExperiencePhase1Result {
  score: number | null;
  available: boolean;
  previousStandingScore: number | null;
  classRankFloor: number | null;
  classRankFloorApplied: boolean;
  eliteFloorApplied: boolean;
  confirmedEliteTitleCount: number;
  reason: ExperiencePhase1UnavailableReason | null;
}

export type CalculateExperiencePhase1EliteInput =
  | ExperiencePhase1EliteEvidence
  | Pick<EliteCutoffHistoryEvidence, "confirmedCount">
  | EliteCutoffHistoryEvidence;

export interface CalculateExperiencePhase1Input {
  previous: ExperiencePhase1PreviousEvidence;
  elite: CalculateExperiencePhase1EliteInput;
  /**
   * Previous-season regional class rank (`previous_mythic_plus_ranks.class.region`).
   * Overall regional rank must not be passed here.
   */
  previousRegionalClassRank?: number | null;
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
 * Map previous-season regional class rank onto an Experience floor.
 * Rank > 100 or missing / non-positive → no floor.
 */
export function scoreRegionalClassRankFloor(
  regionalClassRank: number | null | undefined,
): number | null {
  if (
    regionalClassRank == null ||
    !Number.isFinite(regionalClassRank) ||
    regionalClassRank <= 0
  ) {
    return null;
  }
  const rank = Math.trunc(regionalClassRank);
  for (const anchor of EXPERIENCE_PHASE1_CLASS_RANK_FLOOR_ANCHORS) {
    if (rank <= anchor.maxRank) return anchor.floor;
  }
  return null;
}

/**
 * Usable previous-season regional class rank from a normalized Raider.IO rank summary.
 * Rejects non-positive API placeholders (RIO often returns 0 when absent).
 */
export function usablePreviousRegionalClassRank(
  previousRanks: { classRank?: { region?: number | null } | null; region?: number | null } | null | undefined,
): number | null {
  const classRegion = previousRanks?.classRank?.region;
  if (classRegion == null || !Number.isFinite(classRegion) || classRegion <= 0) {
    return null;
  }
  return Math.trunc(classRegion);
}

export function normalizeExperiencePhase1EliteEvidence(
  elite: CalculateExperiencePhase1EliteInput,
): ExperiencePhase1EliteEvidence {
  if (
    elite != null &&
    typeof elite === "object" &&
    "state" in elite &&
    (elite as { state?: unknown }).state === "UNAVAILABLE"
  ) {
    const reason = (elite as { reason?: unknown }).reason;
    return {
      state: "UNAVAILABLE",
      reason: typeof reason === "string" ? reason : undefined,
    };
  }
  const rawCount = (elite as { confirmedCount?: unknown }).confirmedCount;
  const confirmedCount =
    typeof rawCount === "number" && Number.isFinite(rawCount)
      ? Math.max(0, rawCount | 0)
      : 0;
  return { state: "OK", confirmedCount };
}

function maxFinite(values: Array<number | null | undefined>): number | null {
  let best: number | null = null;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    best = best == null ? value : Math.max(best, value);
  }
  return best;
}

function availableResult(input: {
  score: number;
  previousStandingScore: number | null;
  classRankFloor: number | null;
  eliteFloor: number | null;
  confirmedEliteTitleCount: number;
}): ExperiencePhase1Result {
  const { score, previousStandingScore, classRankFloor, eliteFloor, confirmedEliteTitleCount } =
    input;
  return {
    score,
    available: true,
    previousStandingScore,
    classRankFloor,
    classRankFloorApplied:
      classRankFloor != null &&
      score === classRankFloor &&
      (previousStandingScore == null || previousStandingScore < score),
    eliteFloorApplied:
      eliteFloor != null &&
      score === eliteFloor &&
      (previousStandingScore == null || previousStandingScore < score),
    confirmedEliteTitleCount,
    reason: null,
  };
}

function unavailableResult(input: {
  reason: ExperiencePhase1UnavailableReason;
  previousStandingScore?: number | null;
  classRankFloor?: number | null;
  confirmedEliteTitleCount?: number;
}): ExperiencePhase1Result {
  return {
    score: null,
    available: false,
    previousStandingScore: input.previousStandingScore ?? null,
    classRankFloor: input.classRankFloor ?? null,
    classRankFloorApplied: false,
    eliteFloorApplied: false,
    confirmedEliteTitleCount: input.confirmedEliteTitleCount ?? 0,
    reason: input.reason,
  };
}

/**
 * Pure Experience Phase 1 calculator.
 *
 * Experience = max(previousStandingScore, classRankFloor, eliteTitleFloor)
 * among applicable proofs (missing floors omitted).
 *
 * Resolved empty history (CONFIRMED_NO_ACTIVITY + no class-rank floor + no elite)
 * yields score 0 with available=true. Technical failures stay unavailable/null.
 */
export function calculateExperiencePhase1(
  input: CalculateExperiencePhase1Input,
): ExperiencePhase1Result {
  const elite = normalizeExperiencePhase1EliteEvidence(input.elite);
  const confirmedEliteTitleCount =
    elite.state === "OK" ? elite.confirmedCount : 0;
  const eliteFloor =
    elite.state === "OK" && confirmedEliteTitleCount > 0
      ? EXPERIENCE_PHASE1_ELITE_FLOOR
      : null;
  const classRankFloor = scoreRegionalClassRankFloor(input.previousRegionalClassRank);

  let previousStandingScore: number | null = null;
  if (input.previous.state === "STANDING") {
    previousStandingScore = scorePreviousSeasonStanding(input.previous.standing);
  } else if (input.previous.state === "CONFIRMED_NO_ACTIVITY") {
    previousStandingScore = EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE;
  }

  const previousResolved = input.previous.state !== "UNAVAILABLE";
  const knownWithoutElite = maxFinite([previousStandingScore, classRankFloor]);

  // Elite acquisition failed: keep available only when elite cannot change the result.
  if (elite.state === "UNAVAILABLE") {
    if (knownWithoutElite != null && knownWithoutElite >= EXPERIENCE_PHASE1_ELITE_FLOOR) {
      return availableResult({
        score: knownWithoutElite,
        previousStandingScore,
        classRankFloor,
        eliteFloor: null,
        confirmedEliteTitleCount: 0,
      });
    }
    // Ambiguous: elite might raise the score to 90, or previous itself failed.
    if (!previousResolved && classRankFloor == null) {
      return unavailableResult({
        reason:
          input.previous.state === "UNAVAILABLE"
            ? "PREVIOUS_EVIDENCE_UNAVAILABLE"
            : "ELITE_EVIDENCE_UNAVAILABLE",
        previousStandingScore,
        classRankFloor,
      });
    }
    return unavailableResult({
      reason: "ELITE_EVIDENCE_UNAVAILABLE",
      previousStandingScore,
      classRankFloor,
    });
  }

  const candidates: number[] = [];
  if (previousStandingScore != null) candidates.push(previousStandingScore);
  if (classRankFloor != null) candidates.push(classRankFloor);
  if (eliteFloor != null) candidates.push(eliteFloor);

  if (candidates.length === 0) {
    // Previous unresolved and no alternate proof — cannot treat as score 0.
    return unavailableResult({
      reason:
        input.previous.state === "UNAVAILABLE"
          ? "PREVIOUS_EVIDENCE_UNAVAILABLE"
          : "NO_USABLE_EVIDENCE",
      previousStandingScore,
      classRankFloor,
      confirmedEliteTitleCount,
    });
  }

  return availableResult({
    score: Math.max(...candidates),
    previousStandingScore,
    classRankFloor,
    eliteFloor,
    confirmedEliteTitleCount,
  });
}
