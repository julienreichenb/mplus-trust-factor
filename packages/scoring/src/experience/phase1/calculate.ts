/**
 * Experience Phase 1 — pure calculator.
 *
 * Combines historical standing (MAX of contextualized closed-season native-band
 * scores), previous-season regional class rank floor, and elite 0.1% cutoff
 * history via max (not a weighted blend). Provider-free.
 *
 * Availability: score 0 is valid when absence of history is resolved.
 * unavailable/null is reserved for provider/config/integrity failures.
 */

import type { EliteCutoffHistoryEvidence } from "./elite-cutoff-history.js";
import type { HistoricalStandingProof } from "./historical-standing.js";
import {
  EXPERIENCE_PHASE1_BELOW_P600_SCORE,
  NATIVE_BAND_STANDING_SCORES,
  type NativeCutoffBand,
  type NativeCutoffQuantile,
  type PreviousSeasonRelativeStanding,
} from "./season-population-policy.js";

export const EXPERIENCE_PHASE1_ELITE_FLOOR = 90;
/** @deprecated Prefer EXPERIENCE_PHASE1_BELOW_P600_SCORE / NATIVE_BAND_STANDING_SCORES.below_p600. */
export const EXPERIENCE_PHASE1_BELOW_TOP40_SCORE = EXPERIENCE_PHASE1_BELOW_P600_SCORE;
export const EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE = 0;

/**
 * Diagnostic / legacy mapping of native bands → standing scores.
 * Scoring uses PreviousSeasonRelativeStanding.standingScore (discrete native bands).
 */
export const EXPERIENCE_PHASE1_STANDING_SCORE_ANCHORS = Object.freeze([
  Object.freeze({ topPercent: 0.1, score: NATIVE_BAND_STANDING_SCORES.p999, nativeBand: "p999" as const }),
  Object.freeze({ topPercent: 1, score: NATIVE_BAND_STANDING_SCORES.p990, nativeBand: "p990" as const }),
  Object.freeze({ topPercent: 10, score: NATIVE_BAND_STANDING_SCORES.p900, nativeBand: "p900" as const }),
  Object.freeze({ topPercent: 25, score: NATIVE_BAND_STANDING_SCORES.p750, nativeBand: "p750" as const }),
  Object.freeze({ topPercent: 40, score: NATIVE_BAND_STANDING_SCORES.p600, nativeBand: "p600" as const }),
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
  | "HISTORICAL_EVIDENCE_UNAVAILABLE"
  | "ELITE_EVIDENCE_UNAVAILABLE";

/** Machine-readable standing provenance (no UI). */
export interface ExperiencePhase1StandingProvenance {
  historicalRating: number | null;
  /** Original acquisition source (not cache hit). */
  ratingSource: "BLIZZARD" | "RAIDERIO_FALLBACK" | null;
  exactHistoricalSeasonSlug: string | null;
  populationPolicyVersion: string | null;
  matchedNativeBand: NativeCutoffBand | null;
  thresholdsUsed: Array<{ quantile: NativeCutoffQuantile; score: number }> | null;
  /** Specific previous-acquisition reason when Experience is unavailable. */
  acquisitionReason?: string | null;
  /** Winning historical season identity (Agent 03C). */
  winningSeasonId?: string | null;
  winningSeasonSlug?: string | null;
  winningBlizzardSeasonId?: number | null;
  /** Count of closed seasons successfully contextualized against COMPLETE policy. */
  contextualizedHistoricalSeasonCount?: number;
}

export interface ExperiencePhase1Result {
  score: number | null;
  available: boolean;
  /**
   * Explicit Experience confidence in [0, 1] when available.
   * Resolved historical evidence (including confirmed absence → score 0) is
   * confidence 1 — do not invent uncertainty around successful resolution.
   * Null when unavailable (provider/config/integrity failure).
   */
  confidence: number | null;
  /** Machine-readable causes for confidence < 1 and/or unavailability. */
  confidenceCauses: string[];
  /**
   * MAX of contextualized historical native-band standing scores (Agent 03C).
   * Alias of previousStandingScore for backward compatibility.
   */
  historicalStandingScore: number | null;
  /**
   * @deprecated Prefer historicalStandingScore — same value (compat alias).
   */
  previousStandingScore: number | null;
  classRankFloor: number | null;
  classRankFloorApplied: boolean;
  /** Raw regional class rank used for the floor (when applied/available). */
  previousRegionalClassRank?: number | null;
  eliteFloorApplied: boolean;
  confirmedEliteTitleCount: number;
  reason: ExperiencePhase1UnavailableReason | null;
  /** Optional standing provenance attached by the worker acquisition path. */
  standingProvenance?: ExperiencePhase1StandingProvenance | null;
  /** Winning historical standing proof when historicalStandingScore is set. */
  winningHistoricalProof?: HistoricalStandingProof | null;
  /** Number of seasons that contributed a contextualized standing score. */
  contextualizedHistoricalSeasonCount?: number;
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
  /** Optional winning proof metadata attached to the result (not used in max). */
  winningHistoricalProof?: HistoricalStandingProof | null;
  contextualizedHistoricalSeasonCount?: number;
}

/**
 * @deprecated Agent 04 removed percentile interpolation. Maps legacy topPercent
 * diagnostics onto the nearest native-band standing score (no interpolation).
 */
export function scoreFromEstimatedTopPercent(estimatedTopPercent: number): number {
  if (!Number.isFinite(estimatedTopPercent)) {
    return EXPERIENCE_PHASE1_BELOW_P600_SCORE;
  }
  const anchors = EXPERIENCE_PHASE1_STANDING_SCORE_ANCHORS;
  if (estimatedTopPercent <= anchors[0]!.topPercent) {
    return anchors[0]!.score;
  }
  for (let i = 0; i < anchors.length; i += 1) {
    const cur = anchors[i]!;
    const next = anchors[i + 1];
    if (next == null) {
      return estimatedTopPercent <= cur.topPercent
        ? cur.score
        : EXPERIENCE_PHASE1_BELOW_P600_SCORE;
    }
    if (estimatedTopPercent <= next.topPercent) {
      // Snap to the weaker (higher topPercent) band boundary — no mid-band lerp.
      return next.score;
    }
  }
  return EXPERIENCE_PHASE1_BELOW_P600_SCORE;
}

/**
 * Convert a PreviousSeasonRelativeStanding into a previous-standing Experience score.
 * Uses discrete native-band standingScore (no interpolation).
 */
export function scorePreviousSeasonStanding(
  standing: PreviousSeasonRelativeStanding,
): number {
  if (typeof standing.standingScore === "number" && Number.isFinite(standing.standingScore)) {
    return standing.standingScore;
  }
  if (standing.nativeBand != null && standing.nativeBand in NATIVE_BAND_STANDING_SCORES) {
    return NATIVE_BAND_STANDING_SCORES[standing.nativeBand];
  }
  return EXPERIENCE_PHASE1_BELOW_P600_SCORE;
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
  previousRegionalClassRank?: number | null;
  /** Optional provenance tags (e.g. confirmed_absence) — never lower confidence. */
  confidenceCauses?: string[];
  winningHistoricalProof?: HistoricalStandingProof | null;
  contextualizedHistoricalSeasonCount?: number;
}): ExperiencePhase1Result {
  const { score, previousStandingScore, classRankFloor, eliteFloor, confirmedEliteTitleCount } =
    input;
  return {
    score,
    available: true,
    confidence: 1,
    confidenceCauses: [...(input.confidenceCauses ?? [])],
    historicalStandingScore: previousStandingScore,
    previousStandingScore,
    classRankFloor,
    classRankFloorApplied:
      classRankFloor != null &&
      score === classRankFloor &&
      (previousStandingScore == null || previousStandingScore < score),
    previousRegionalClassRank: input.previousRegionalClassRank ?? null,
    eliteFloorApplied:
      eliteFloor != null &&
      score === eliteFloor &&
      (previousStandingScore == null || previousStandingScore < score),
    confirmedEliteTitleCount,
    reason: null,
    winningHistoricalProof: input.winningHistoricalProof ?? null,
    contextualizedHistoricalSeasonCount: input.contextualizedHistoricalSeasonCount ?? 0,
  };
}

function unavailableResult(input: {
  reason: ExperiencePhase1UnavailableReason;
  previousStandingScore?: number | null;
  classRankFloor?: number | null;
  confirmedEliteTitleCount?: number;
  previousRegionalClassRank?: number | null;
  winningHistoricalProof?: HistoricalStandingProof | null;
  contextualizedHistoricalSeasonCount?: number;
}): ExperiencePhase1Result {
  const previousStandingScore = input.previousStandingScore ?? null;
  return {
    score: null,
    available: false,
    confidence: null,
    confidenceCauses: [input.reason.toLowerCase()],
    historicalStandingScore: previousStandingScore,
    previousStandingScore,
    classRankFloor: input.classRankFloor ?? null,
    classRankFloorApplied: false,
    previousRegionalClassRank: input.previousRegionalClassRank ?? null,
    eliteFloorApplied: false,
    confirmedEliteTitleCount: input.confirmedEliteTitleCount ?? 0,
    reason: input.reason,
    winningHistoricalProof: input.winningHistoricalProof ?? null,
    contextualizedHistoricalSeasonCount: input.contextualizedHistoricalSeasonCount ?? 0,
  };
}

/**
 * Pure Experience Phase 1 calculator.
 *
 * Experience = max(historicalStandingScore, classRankFloor, eliteTitleFloor)
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
  const winningHistoricalProof = input.winningHistoricalProof ?? null;
  const contextualizedHistoricalSeasonCount =
    input.contextualizedHistoricalSeasonCount ??
    (winningHistoricalProof != null ? 1 : 0);
  const previousRegionalClassRank =
    input.previousRegionalClassRank != null &&
    Number.isFinite(input.previousRegionalClassRank) &&
    input.previousRegionalClassRank > 0
      ? Math.trunc(input.previousRegionalClassRank)
      : null;

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
        previousRegionalClassRank,
        winningHistoricalProof,
        contextualizedHistoricalSeasonCount,
      });
    }
    // Ambiguous: elite might raise the score to 90, or previous itself failed.
    if (!previousResolved && classRankFloor == null) {
      return unavailableResult({
        reason:
          input.previous.state === "UNAVAILABLE"
            ? "HISTORICAL_EVIDENCE_UNAVAILABLE"
            : "ELITE_EVIDENCE_UNAVAILABLE",
        previousStandingScore,
        classRankFloor,
        previousRegionalClassRank,
        winningHistoricalProof,
        contextualizedHistoricalSeasonCount,
      });
    }
    return unavailableResult({
      reason: "ELITE_EVIDENCE_UNAVAILABLE",
      previousStandingScore,
      classRankFloor,
      previousRegionalClassRank,
      winningHistoricalProof,
      contextualizedHistoricalSeasonCount,
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
          ? "HISTORICAL_EVIDENCE_UNAVAILABLE"
          : "NO_USABLE_EVIDENCE",
      previousStandingScore,
      classRankFloor,
      confirmedEliteTitleCount,
      previousRegionalClassRank,
      winningHistoricalProof,
      contextualizedHistoricalSeasonCount,
    });
  }

  return availableResult({
    score: Math.max(...candidates),
    previousStandingScore,
    classRankFloor,
    eliteFloor,
    confirmedEliteTitleCount,
    previousRegionalClassRank,
    winningHistoricalProof,
    contextualizedHistoricalSeasonCount,
  });
}
