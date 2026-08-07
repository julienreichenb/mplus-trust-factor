/**
 * Experience Phase 1 — season population policy + relative standing estimator.
 *
 * Provider-free pure logic. Converts regional Mythic+ cutoff anchors into a
 * deterministic SeasonPopulationPolicy and estimates previous-season relative
 * standing from an official Blizzard Mythic+ rating.
 *
 * Not wired into Experience V3 or production scoring.
 */

import type { RaiderIoCutoffThreshold, RaiderIoSeasonCutoffs, RegionCode } from "@mplus/contracts";

export const SEASON_POPULATION_POLICY_VERSION = "season-population-policy-v1" as const;

export type SeasonPopulationAnchorKey =
  | "top_0_1_percent"
  | "top_1_percent"
  | "top_10_percent"
  | "top_25_percent"
  | "top_40_percent";

export interface SeasonPopulationAnchor {
  key: SeasonPopulationAnchorKey;
  /**
   * Percentage of the population at or above this rating (lower is better).
   * Examples: 0.1 = top 0.1%, 1 = top 1%, 10 = top 10%.
   */
  topPercent: number;
  score: number;
  quantilePopulationCount: number | null;
  totalPopulationCount: number | null;
}

export type SeasonPopulationPolicyQuality = "COMPLETE" | "PARTIAL" | "INSUFFICIENT";

export interface SeasonPopulationPolicy {
  version: typeof SEASON_POPULATION_POLICY_VERSION;
  source: "RAIDER_IO_SEASON_CUTOFFS";
  region: RegionCode;
  seasonSlug: string;
  sourceUpdatedAt: string | null;
  anchors: SeasonPopulationAnchor[];
  quality: SeasonPopulationPolicyQuality;
}

export type PreviousSeasonStandingBand =
  | "TOP_0_1_OR_BETTER"
  | "TOP_1"
  | "TOP_10"
  | "TOP_25"
  | "TOP_40"
  | "BELOW_TOP_40"
  | "BELOW_SUPPORTED_RANGE";

export type PreviousSeasonStandingMethod =
  | "EXACT_ANCHOR"
  | "INTERPOLATED"
  | "CAPPED_AT_BEST_ANCHOR"
  | "BELOW_SUPPORTED_RANGE";

export interface PreviousSeasonRelativeStanding {
  rating: number;
  band: PreviousSeasonStandingBand;
  /**
   * Estimated % of population at or above the player's rating (lower is better).
   * null when anchors do not support a credible estimate (e.g. below weakest cutoff).
   */
  estimatedTopPercent: number | null;
  method: PreviousSeasonStandingMethod;
  betterAnchor: SeasonPopulationAnchor | null;
  worseAnchor: SeasonPopulationAnchor | null;
  policyVersion: string;
  region: RegionCode;
  seasonSlug: string;
}

export type BuildSeasonPopulationPolicyResult =
  | { ok: true; policy: SeasonPopulationPolicy }
  | {
      ok: false;
      reason: "NON_MONOTONIC_THRESHOLDS" | "MISSING_SEASON_SLUG";
    };

export type StandingEstimationResult =
  | { ok: true; standing: PreviousSeasonRelativeStanding }
  | {
      ok: false;
      reason: "INSUFFICIENT_POLICY" | "INVALID_RATING" | "NON_MONOTONIC_POLICY";
    };

/** Explicit cutoff → topPercent map (do not parse strings). */
const CUTOFF_SPECS = [
  { field: "top0_1Percent" as const, key: "top_0_1_percent" as const, topPercent: 0.1 },
  { field: "top1Percent" as const, key: "top_1_percent" as const, topPercent: 1 },
  { field: "top10Percent" as const, key: "top_10_percent" as const, topPercent: 10 },
  { field: "top25Percent" as const, key: "top_25_percent" as const, topPercent: 25 },
  { field: "top40Percent" as const, key: "top_40_percent" as const, topPercent: 40 },
] as const;

function isUsableScore(score: number): boolean {
  return Number.isFinite(score) && score >= 0;
}

function populationCountOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function thresholdToAnchor(
  threshold: RaiderIoCutoffThreshold | null,
  key: SeasonPopulationAnchorKey,
  topPercent: number,
): SeasonPopulationAnchor | null {
  if (!threshold || !isUsableScore(threshold.score)) return null;
  return {
    key,
    topPercent,
    score: threshold.score,
    quantilePopulationCount: populationCountOrNull(threshold.quantilePopulationCount),
    totalPopulationCount: populationCountOrNull(threshold.totalPopulationCount),
  };
}

/**
 * Stronger → weaker by topPercent (0.1 before 40). Stable for equal topPercent.
 */
function compareAnchorsStrongestFirst(a: SeasonPopulationAnchor, b: SeasonPopulationAnchor): number {
  if (a.topPercent !== b.topPercent) return a.topPercent - b.topPercent;
  return a.key.localeCompare(b.key);
}

/**
 * Higher Mythic+ score is stronger. Among present anchors (strongest→weakest),
 * each next score must be ≤ previous score (equality allowed).
 */
export function isMonotonicPopulationAnchors(anchors: readonly SeasonPopulationAnchor[]): boolean {
  const ordered = [...anchors].sort(compareAnchorsStrongestFirst);
  for (let i = 1; i < ordered.length; i += 1) {
    const stronger = ordered[i - 1]!;
    const weaker = ordered[i]!;
    if (weaker.score > stronger.score) return false;
  }
  return true;
}

function qualityFromAnchorCount(count: number): SeasonPopulationPolicyQuality {
  if (count >= 5) return "COMPLETE";
  if (count >= 2) return "PARTIAL";
  return "INSUFFICIENT";
}

/**
 * Build a deterministic SeasonPopulationPolicy from normalized Raider.IO season cutoffs.
 * Does not invent missing anchors. Rejects non-monotonic threshold evidence.
 */
export function buildSeasonPopulationPolicy(
  cutoffs: RaiderIoSeasonCutoffs,
  options?: { seasonSlug?: string },
): BuildSeasonPopulationPolicyResult {
  const seasonSlug = (options?.seasonSlug ?? cutoffs.seasonSlug ?? "").trim();
  if (!seasonSlug) {
    return { ok: false, reason: "MISSING_SEASON_SLUG" };
  }

  const anchors: SeasonPopulationAnchor[] = [];
  for (const spec of CUTOFF_SPECS) {
    const anchor = thresholdToAnchor(cutoffs[spec.field], spec.key, spec.topPercent);
    if (anchor) anchors.push(anchor);
  }
  anchors.sort(compareAnchorsStrongestFirst);

  if (anchors.length >= 2 && !isMonotonicPopulationAnchors(anchors)) {
    return { ok: false, reason: "NON_MONOTONIC_THRESHOLDS" };
  }

  return {
    ok: true,
    policy: {
      version: SEASON_POPULATION_POLICY_VERSION,
      source: "RAIDER_IO_SEASON_CUTOFFS",
      region: cutoffs.region,
      seasonSlug,
      sourceUpdatedAt: cutoffs.updatedAt,
      anchors,
      quality: qualityFromAnchorCount(anchors.length),
    },
  };
}

function bandForMetTopPercent(topPercent: number): PreviousSeasonStandingBand {
  if (topPercent <= 0.1) return "TOP_0_1_OR_BETTER";
  if (topPercent <= 1) return "TOP_1";
  if (topPercent <= 10) return "TOP_10";
  if (topPercent <= 25) return "TOP_25";
  if (topPercent <= 40) return "TOP_40";
  return "BELOW_SUPPORTED_RANGE";
}

function belowWeakestBand(weakest: SeasonPopulationAnchor): PreviousSeasonStandingBand {
  // Complete top-40 floor uses BELOW_TOP_40; weaker partial floors stay explicit.
  if (weakest.key === "top_40_percent" && weakest.topPercent === 40) {
    return "BELOW_TOP_40";
  }
  return "BELOW_SUPPORTED_RANGE";
}

/**
 * Piecewise-linear interpolation between two score/topPercent anchors.
 * t = (better.score - rating) / (better.score - worse.score)
 * estimated = better.topPercent + t * (worse.topPercent - better.topPercent)
 */
export function interpolateTopPercent(
  rating: number,
  better: SeasonPopulationAnchor,
  worse: SeasonPopulationAnchor,
): number {
  const scoreSpan = better.score - worse.score;
  if (scoreSpan === 0) {
    // Zero-width: prefer stronger percentile (already ensured by caller for exact match).
    return Math.min(better.topPercent, worse.topPercent);
  }
  const t = (better.score - rating) / scoreSpan;
  const clampedT = Math.min(1, Math.max(0, t));
  const estimated =
    better.topPercent + clampedT * (worse.topPercent - better.topPercent);
  const lo = Math.min(better.topPercent, worse.topPercent);
  const hi = Math.max(better.topPercent, worse.topPercent);
  return Math.min(hi, Math.max(lo, estimated));
}

/**
 * Estimate previous-season relative standing from an official Blizzard Mythic+ rating
 * and a SeasonPopulationPolicy. Does not produce an Experience 0–100 score.
 */
export function estimatePreviousSeasonStanding(
  rating: number,
  policy: SeasonPopulationPolicy,
): StandingEstimationResult {
  if (!Number.isFinite(rating) || rating < 0) {
    return { ok: false, reason: "INVALID_RATING" };
  }
  if (policy.quality === "INSUFFICIENT" || policy.anchors.length < 2) {
    return { ok: false, reason: "INSUFFICIENT_POLICY" };
  }
  if (!isMonotonicPopulationAnchors(policy.anchors)) {
    return { ok: false, reason: "NON_MONOTONIC_POLICY" };
  }

  const anchors = [...policy.anchors].sort(compareAnchorsStrongestFirst);
  const strongest = anchors[0]!;
  const weakest = anchors[anchors.length - 1]!;

  const base = {
    rating,
    policyVersion: policy.version,
    region: policy.region,
    seasonSlug: policy.seasonSlug,
  };

  // Cap at strongest known anchor — no extrapolation beyond provider evidence.
  if (rating > strongest.score) {
    return {
      ok: true,
      standing: {
        ...base,
        band: bandForMetTopPercent(strongest.topPercent),
        estimatedTopPercent: strongest.topPercent,
        method: "CAPPED_AT_BEST_ANCHOR",
        betterAnchor: strongest,
        worseAnchor: null,
      },
    };
  }

  // Exact match: if multiple anchors share this score, pick the strongest (lowest topPercent).
  const exactMatches = anchors.filter((a) => a.score === rating);
  if (exactMatches.length > 0) {
    const exact = exactMatches[0]!; // already strongest-first
    return {
      ok: true,
      standing: {
        ...base,
        band: bandForMetTopPercent(exact.topPercent),
        estimatedTopPercent: exact.topPercent,
        method: "EXACT_ANCHOR",
        betterAnchor: exact,
        worseAnchor: exact,
      },
    };
  }

  // Below weakest available cutoff — no extrapolation toward 100%.
  if (rating < weakest.score) {
    return {
      ok: true,
      standing: {
        ...base,
        band: belowWeakestBand(weakest),
        estimatedTopPercent: null,
        method: "BELOW_SUPPORTED_RANGE",
        betterAnchor: null,
        worseAnchor: weakest,
      },
    };
  }

  // Find bracketing pair: better.score >= rating >= worse.score with better stronger than worse.
  // Skip zero-width score intervals when seeking a usable interpolation pair.
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const better = anchors[i]!;
    // Advance to the next anchor with a strictly lower score for interpolation width.
    let j = i + 1;
    while (j < anchors.length && anchors[j]!.score === better.score) {
      j += 1;
    }
    if (j >= anchors.length) break;
    const worse = anchors[j]!;

    if (rating <= better.score && rating >= worse.score) {
      const estimatedTopPercent = interpolateTopPercent(rating, better, worse);
      // Band from strongest threshold the rating meets (better side when at/above better;
      // otherwise the worse threshold is the strongest met among the pair for band labeling
      // when rating is strictly below better — use threshold semantics: strongest met overall).
      const met = anchors.filter((a) => rating >= a.score);
      const strongestMet = met[0] ?? worse;
      return {
        ok: true,
        standing: {
          ...base,
          band: bandForMetTopPercent(strongestMet.topPercent),
          estimatedTopPercent,
          method: "INTERPOLATED",
          betterAnchor: better,
          worseAnchor: worse,
        },
      };
    }
  }

  // Should be unreachable for monotonic policies; fail closed.
  return { ok: false, reason: "INSUFFICIENT_POLICY" };
}
