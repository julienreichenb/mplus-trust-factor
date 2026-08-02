/**
 * Shadow DimensionComputation payload builder for Utility V2.
 * Persistence wiring remains worker-owned / shared integration.
 */

import type {
  UtilityV2ComputeResult,
  UtilityV2ShadowDimensionPayload,
} from "./types.js";

export function toUtilityV2ShadowDimensionPayload(input: {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  result: UtilityV2ComputeResult;
  computedAt: Date;
}): UtilityV2ShadowDimensionPayload {
  return {
    characterId: input.characterId,
    seasonId: input.seasonId,
    manifestId: input.manifestId,
    scoreModelId: input.scoreModelId,
    dimension: "UTILITY",
    algorithmVersion: input.result.algorithmVersion,
    inputFingerprint: input.result.inputFingerprint,
    score: input.result.score,
    confidence: input.result.confidence,
    state: "SHADOW",
    metrics: {
      ...input.result.metrics,
      availabilityState: input.result.availabilityState,
      publicationBlocked: true,
    },
    explanation: input.result.explanation,
    computedAt: input.computedAt,
  };
}
