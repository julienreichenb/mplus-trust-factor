/**
 * Experience — multi-season historical standing (Agent 03C).
 *
 * Contextualizes Blizzard HAS_VALUE ratings against COMPLETE same-region
 * population policies (03A). Score = MAX(discrete native-band standing scores).
 * Unsupported seasons (no COMPLETE policy) are retained as facts, never scored.
 * Provider-free.
 */

import type { RegionCode } from "@mplus/contracts";
import {
  estimatePreviousSeasonStanding,
  NATIVE_BAND_STANDING_SCORES,
  type NativeCutoffBand,
  type NativeCutoffQuantile,
  type PreviousSeasonRelativeStanding,
  type SeasonPopulationPolicy,
} from "./season-population-policy.js";

export type HistoricalSeasonRatingInput = {
  seasonId: string;
  seasonSlug: string;
  blizzardSeasonId: number;
  rating: number | null;
  state: "HAS_VALUE" | "CONFIRMED_NO_ACTIVITY";
  source: "BLIZZARD";
};

export type HistoricalStandingProof = {
  seasonId: string;
  seasonSlug: string;
  blizzardSeasonId: number;
  rating: number;
  nativeBand: NativeCutoffBand;
  standingScore: number;
  standing: PreviousSeasonRelativeStanding;
  thresholdsUsed: Array<{ quantile: NativeCutoffQuantile; score: number }>;
  populationPolicyVersion: string;
  region: RegionCode;
  /** Raider.IO / provider season slug from the population policy (display). */
  policySeasonSlug: string;
};

export type UncontextualizedHistoricalSeason = {
  seasonId: string;
  seasonSlug: string;
  blizzardSeasonId: number;
  rating: number | null;
  state: "HAS_VALUE" | "CONFIRMED_NO_ACTIVITY";
  reason:
    | "MISSING_POPULATION_POLICY"
    | "INCOMPLETE_POLICY"
    | "REGION_MISMATCH"
    | "STANDING_ESTIMATE_FAILED"
    | "INVALID_RATING";
};

export type HistoricalStandingComputation = {
  historicalStandingScore: number | null;
  winning: HistoricalStandingProof | null;
  proofs: HistoricalStandingProof[];
  uncontextualized: UncontextualizedHistoricalSeason[];
  /** True when only season-level CONFIRMED_NO_ACTIVITY rows exist (no HAS_VALUE).
   * Diagnostic only — does NOT prove whole-history absence / global E=0. */
  confirmedNoActivityOnly: boolean;
};

const REQUIRED_QUANTILES: NativeCutoffQuantile[] = [
  "p999",
  "p990",
  "p900",
  "p750",
  "p600",
];

/** COMPLETE same-region policy with all five native cutoff anchors. */
export function isCompleteRegionalPopulationPolicy(
  policy: SeasonPopulationPolicy,
  regionCode: RegionCode,
): boolean {
  if (policy.region !== regionCode) return false;
  if (policy.quality !== "COMPLETE") return false;
  const present = new Set(policy.anchors.map((a) => a.nativeQuantile));
  return REQUIRED_QUANTILES.every((q) => present.has(q));
}

/**
 * Build scoreable historical standing proofs and take MAX.
 * Weak seasons never reduce a stronger proven season.
 */
export function computeHistoricalStanding(input: {
  ratings: HistoricalSeasonRatingInput[];
  /** seasonId → population policy (already parsed); missing → uncontextualized. */
  policyBySeasonId: Map<string, SeasonPopulationPolicy | null>;
  regionCode: RegionCode;
}): HistoricalStandingComputation {
  const proofs: HistoricalStandingProof[] = [];
  const uncontextualized: UncontextualizedHistoricalSeason[] = [];
  let hasValueCount = 0;
  let confirmedNoActivityCount = 0;

  for (const row of input.ratings) {
    if (row.state === "CONFIRMED_NO_ACTIVITY") {
      confirmedNoActivityCount += 1;
      continue;
    }
    if (row.state !== "HAS_VALUE") continue;
    hasValueCount += 1;

    if (row.rating == null || !Number.isFinite(row.rating) || row.rating < 0) {
      uncontextualized.push({
        seasonId: row.seasonId,
        seasonSlug: row.seasonSlug,
        blizzardSeasonId: row.blizzardSeasonId,
        rating: row.rating,
        state: row.state,
        reason: "INVALID_RATING",
      });
      continue;
    }

    const policy = input.policyBySeasonId.get(row.seasonId) ?? null;
    if (!policy) {
      uncontextualized.push({
        seasonId: row.seasonId,
        seasonSlug: row.seasonSlug,
        blizzardSeasonId: row.blizzardSeasonId,
        rating: row.rating,
        state: row.state,
        reason: "MISSING_POPULATION_POLICY",
      });
      continue;
    }
    if (policy.region !== input.regionCode) {
      uncontextualized.push({
        seasonId: row.seasonId,
        seasonSlug: row.seasonSlug,
        blizzardSeasonId: row.blizzardSeasonId,
        rating: row.rating,
        state: row.state,
        reason: "REGION_MISMATCH",
      });
      continue;
    }
    if (!isCompleteRegionalPopulationPolicy(policy, input.regionCode)) {
      uncontextualized.push({
        seasonId: row.seasonId,
        seasonSlug: row.seasonSlug,
        blizzardSeasonId: row.blizzardSeasonId,
        rating: row.rating,
        state: row.state,
        reason: "INCOMPLETE_POLICY",
      });
      continue;
    }

    const estimated = estimatePreviousSeasonStanding(row.rating, policy);
    if (!estimated.ok) {
      uncontextualized.push({
        seasonId: row.seasonId,
        seasonSlug: row.seasonSlug,
        blizzardSeasonId: row.blizzardSeasonId,
        rating: row.rating,
        state: row.state,
        reason: "STANDING_ESTIMATE_FAILED",
      });
      continue;
    }

    proofs.push({
      seasonId: row.seasonId,
      seasonSlug: row.seasonSlug,
      blizzardSeasonId: row.blizzardSeasonId,
      rating: row.rating,
      nativeBand: estimated.standing.nativeBand,
      standingScore: estimated.standing.standingScore,
      standing: estimated.standing,
      thresholdsUsed: estimated.standing.thresholdsUsed,
      populationPolicyVersion: estimated.standing.policyVersion,
      region: estimated.standing.region,
      policySeasonSlug: estimated.standing.seasonSlug,
    });
  }

  proofs.sort((a, b) => {
    if (b.standingScore !== a.standingScore) return b.standingScore - a.standingScore;
    return b.blizzardSeasonId - a.blizzardSeasonId;
  });

  const winning = proofs[0] ?? null;
  return {
    historicalStandingScore: winning?.standingScore ?? null,
    winning,
    proofs,
    uncontextualized,
    confirmedNoActivityOnly:
      hasValueCount === 0 && confirmedNoActivityCount > 0,
  };
}

/** Discrete native-band score for a matched quantile (locked table). */
export function nativeBandStandingScore(band: NativeCutoffBand): number {
  return NATIVE_BAND_STANDING_SCORES[band];
}
