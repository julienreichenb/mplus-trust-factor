import { clamp } from "../../math.js";
import type { ExperienceV3ModelConfig } from "./constants.js";
import type {
  ExperienceV3ComponentResult,
  ExperienceV3HistoricalRankFact,
  HistoricalRankPolicyV3,
} from "./types.js";

/**
 * Map historical percentile / rank onto 0–100.
 * Percentile is "top X%" (lower is better); null percentile uses rank/population.
 */
export function normalizeHistoricalRankScore(
  fact: ExperienceV3HistoricalRankFact,
  config: ExperienceV3ModelConfig,
): number {
  if (fact.top10ClassSpecRegion) {
    return config.historicalRank.top10ClassSpecRegionScore;
  }

  let percentile = fact.percentile;
  if (
    (percentile == null || !Number.isFinite(percentile)) &&
    fact.rank != null &&
    fact.population != null &&
    fact.population > 0 &&
    fact.rank > 0
  ) {
    percentile = (fact.rank / fact.population) * 100;
  }

  if (percentile == null || !Number.isFinite(percentile)) {
    return config.historicalRank.confirmedFloor;
  }

  // percentile: 0.1 means top 0.1%.
  if (percentile <= 0.1) return config.historicalRank.top01PercentScore;
  if (percentile <= 1) return config.historicalRank.top1PercentScore;
  if (percentile <= 5) return config.historicalRank.top5PercentScore;
  if (percentile <= 10) return config.historicalRank.top10PercentScore;

  // Weaker ranks still contribute mildly above floor when confirmed.
  const t = clamp((25 - percentile) / 15, 0, 1);
  return (
    config.historicalRank.confirmedFloor +
    t * (config.historicalRank.top10PercentScore - config.historicalRank.confirmedFloor)
  );
}

/**
 * Exceptional historical ranking — optional component.
 * Missing / unknown / provider failure → unavailable (renormalize elsewhere).
 */
export function scoreHistoricalRankV3(
  fact: ExperienceV3HistoricalRankFact | null,
  policy: HistoricalRankPolicyV3,
  config: ExperienceV3ModelConfig,
): ExperienceV3ComponentResult {
  if (fact == null) {
    return {
      key: "historicalRank",
      available: false,
      score: null,
      confidence: 0,
      weight: 0,
      effectiveWeight: 0,
      evidenceState: "UNKNOWN",
      detail: {
        optional: true,
        reason: "historical_rank_not_provided",
        policyId: policy.id,
        policyVersion: policy.version,
        sourcePriority: policy.sourcePriority,
      },
    };
  }

  const state = fact.evidenceState;
  if (
    state === "PROVIDER_FAILURE" ||
    state === "UNKNOWN" ||
    state === "CONFIRMED_NO_ACTIVITY"
  ) {
    // Confirmed absence of exceptional rank → component unavailable (optional), not zero penalty.
    return {
      key: "historicalRank",
      available: false,
      score: null,
      confidence: 0,
      weight: 0,
      effectiveWeight: 0,
      evidenceState: state,
      detail: {
        optional: true,
        reason:
          state === "CONFIRMED_NO_ACTIVITY"
            ? "no_exceptional_historical_rank"
            : state === "PROVIDER_FAILURE"
              ? "provider_failure"
              : "historical_rank_unknown",
        source: fact.source,
        policyId: policy.id,
        policyVersion: policy.version,
      },
    };
  }

  if (
    !fact.top10ClassSpecRegion &&
    fact.percentile == null &&
    (fact.rank == null || fact.population == null)
  ) {
    return {
      key: "historicalRank",
      available: false,
      score: null,
      confidence: 0,
      weight: 0,
      effectiveWeight: 0,
      evidenceState: state === "PARTIAL" ? "PARTIAL" : "UNKNOWN",
      detail: {
        optional: true,
        reason: "insufficient_rank_fields",
        source: fact.source,
        policyId: policy.id,
        policyVersion: policy.version,
      },
    };
  }

  const normalized = normalizeHistoricalRankScore(fact, config);
  const sourcePriorityBonus =
    policy.sourcePriority.indexOf(fact.source) === 0
      ? 1
      : policy.sourcePriority.indexOf(fact.source) === 1
        ? 0.92
        : 0.8;

  return {
    key: "historicalRank",
    available: true,
    score: clamp(normalized, 0, 100),
    confidence: clamp(
      fact.sourceConfidence * policy.confidence * sourcePriorityBonus,
      0,
      1,
    ),
    weight: 0,
    effectiveWeight: 0,
    evidenceState: state,
    detail: {
      optional: true,
      source: fact.source,
      seasonId: fact.seasonId,
      seasonSlug: fact.seasonSlug,
      region: fact.region,
      classSlug: fact.classSlug,
      specSlug: fact.specSlug,
      role: fact.role,
      rank: fact.rank,
      population: fact.population,
      percentile: fact.percentile,
      top10ClassSpecRegion: fact.top10ClassSpecRegion,
      policyId: policy.id,
      policyVersion: policy.version,
    },
  };
}
