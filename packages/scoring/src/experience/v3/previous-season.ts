import { clamp } from "../../math.js";
import type { ExperienceV3ModelConfig } from "./constants.js";
import type {
  ExperienceV3ComponentResult,
  ExperienceV3PreviousSeasonFact,
  PreviousSeasonNormalizationPolicyV3,
} from "./types.js";

/**
 * Map an absolute prior-season score onto 0–100 using versioned K thresholds.
 * Confirmed no activity → low (not zero). Provider failure / unknown → unavailable.
 */
export function normalizePreviousSeasonScore(
  score: number,
  policy: PreviousSeasonNormalizationPolicyV3,
  config: ExperienceV3ModelConfig,
): number {
  const { confirmedNoActivityScore, atOrBelowK50, atK90, atK99, aboveK99Cap } =
    config.previousSeason;
  const k50 = policy.k50;
  const k90 = Math.max(k50 + 1e-6, policy.k90);
  const k99 = Math.max(k90 + 1e-6, policy.k99);

  if (!(score > 0)) {
    return confirmedNoActivityScore;
  }
  if (score <= k50) {
    // Linear from near-floor at tiny scores up to atOrBelowK50 at K50.
    const t = clamp(score / k50, 0, 1);
    return confirmedNoActivityScore + t * (atOrBelowK50 - confirmedNoActivityScore);
  }
  if (score <= k90) {
    const t = (score - k50) / (k90 - k50);
    return atOrBelowK50 + t * (atK90 - atOrBelowK50);
  }
  if (score <= k99) {
    const t = (score - k90) / (k99 - k90);
    return atK90 + t * (atK99 - atK90);
  }
  const overshoot = (score - k99) / Math.max(1, k99 * 0.05);
  return clamp(atK99 + overshoot * (aboveK99Cap - atK99), 0, aboveK99Cap);
}

/**
 * Previous-season strength component.
 * PROVIDER_FAILURE / UNKNOWN → unavailable (not zero-filled).
 * CONFIRMED_NO_ACTIVITY → available low score.
 */
export function scorePreviousSeasonStrengthV3(
  fact: ExperienceV3PreviousSeasonFact,
  policy: PreviousSeasonNormalizationPolicyV3,
  config: ExperienceV3ModelConfig,
): ExperienceV3ComponentResult {
  const state = fact.evidenceState;

  if (state === "PROVIDER_FAILURE" || state === "UNKNOWN") {
    return {
      key: "previousSeasonStrength",
      available: false,
      score: null,
      confidence: 0,
      weight: 0,
      effectiveWeight: 0,
      evidenceState: state,
      detail: {
        reason:
          state === "PROVIDER_FAILURE"
            ? "provider_failure_not_equivalent_to_no_activity"
            : "previous_season_unknown",
        source: fact.source,
        rawScore: fact.score,
        policyId: policy.id,
        policyVersion: policy.version,
      },
    };
  }

  let normalized: number;
  if (state === "CONFIRMED_NO_ACTIVITY") {
    normalized = config.previousSeason.confirmedNoActivityScore;
  } else if (fact.score == null || !Number.isFinite(fact.score)) {
    // PARTIAL / HAS_VALUE without numeric score → unavailable rather than inventing.
    return {
      key: "previousSeasonStrength",
      available: false,
      score: null,
      confidence: 0,
      weight: 0,
      effectiveWeight: 0,
      evidenceState: state === "PARTIAL" ? "PARTIAL" : "UNKNOWN",
      detail: {
        reason: "missing_numeric_score",
        source: fact.source,
        policyId: policy.id,
        policyVersion: policy.version,
      },
    };
  } else {
    normalized = normalizePreviousSeasonScore(fact.score, policy, config);
  }

  const baseConfidence =
    state === "HAS_VALUE"
      ? clamp(fact.sourceConfidence * policy.confidence, 0, 1)
      : state === "CONFIRMED_NO_ACTIVITY"
        ? clamp(0.85 * policy.confidence, 0, 1)
        : clamp(
            fact.sourceConfidence *
              policy.confidence *
              config.previousSeason.partialConfidenceFactor,
            0,
            1,
          );

  return {
    key: "previousSeasonStrength",
    available: true,
    score: clamp(normalized, 0, 100),
    confidence: baseConfidence,
    weight: 0,
    effectiveWeight: 0,
    evidenceState: state,
    detail: {
      source: fact.source,
      rawScore: fact.score,
      seasonId: fact.seasonId,
      seasonSlug: fact.seasonSlug,
      policyId: policy.id,
      policyVersion: policy.version,
      k50: policy.k50,
      k90: policy.k90,
      k99: policy.k99,
    },
  };
}
