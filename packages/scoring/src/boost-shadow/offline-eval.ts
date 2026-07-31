import type { BoostFeatureFactsV1 } from "./types.js";
import { BOOST_SHADOW_ISOLATION } from "./isolation.js";

/**
 * Offline / in-memory evaluation output — never persisted to production tables.
 */
export interface BoostShadowOfflineEvaluationV1 {
  evaluationKind: "boost_shadow_offline_v1";
  evaluatedAt: string;
  isolation: typeof BOOST_SHADOW_ISOLATION;
  facts: BoostFeatureFactsV1;
  /** Compare-only placeholder; Phase 1 does not read production authenticity. */
  productionAuthenticityCompare: null;
  /** Private aggregates for backtest harnesses (Phase 2+). */
  summary: {
    computedFeatureCount: number;
    omittedFeatureCount: number;
    omittedReasonCounts: Record<string, number>;
    featureValues: Record<string, number | null>;
  };
}

export function buildOfflineEvaluation(
  facts: BoostFeatureFactsV1,
  evaluatedAt: string = facts.calculatedAt,
): BoostShadowOfflineEvaluationV1 {
  const featureValues: Record<string, number | null> = {
    progressionVelocity: facts.features.progressionVelocity?.value ?? null,
    teammateScoreGap: facts.features.teammateScoreGap?.value ?? null,
    repeatedStrongerTeammateCohort:
      facts.features.repeatedStrongerTeammateCohort?.value ?? null,
    highKeyGroupConcentration: facts.features.highKeyGroupConcentration?.value ?? null,
    verifiedAltExperienceMitigation:
      facts.features.verifiedAltExperienceMitigation?.value ?? null,
  };

  const omittedReasonCounts: Record<string, number> = {};
  for (const m of facts.missing) {
    omittedReasonCounts[m.reasonCode] = (omittedReasonCounts[m.reasonCode] ?? 0) + 1;
  }

  const computedFeatureCount = Object.values(facts.features).filter(Boolean).length;

  return {
    evaluationKind: "boost_shadow_offline_v1",
    evaluatedAt,
    isolation: BOOST_SHADOW_ISOLATION,
    facts,
    productionAuthenticityCompare: null,
    summary: {
      computedFeatureCount,
      omittedFeatureCount: facts.missing.length,
      omittedReasonCounts,
      featureValues,
    },
  };
}
