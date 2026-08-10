import type {
  DimensionExplainabilityV1,
  ScoreExplainabilityV1,
} from "@mplus/contracts";
import { stableSha256 } from "../model-config/stable-hash.js";

/**
 * Build a deterministic fingerprint payload excluding timestamps, DB ids,
 * provider counters, and privileged report/fight identifiers.
 */
export function fingerprintPayloadFromExplainability(
  explainability: Omit<ScoreExplainabilityV1, "fingerprint">,
): unknown {
  const dimPayload = (d: DimensionExplainabilityV1) => ({
    dimension: d.dimension,
    score: d.score,
    availability: d.availability,
    scoreStory: {
      drivers: d.scoreStory.drivers.map((driver) => ({
        code: driver.code,
        labelKey: driver.labelKey,
        direction: driver.direction,
        value: driver.value,
        normalizedValue: driver.normalizedValue,
        weight: driver.weight,
        contribution: driver.contribution,
        materiality: driver.materiality,
        params: driver.params,
        // evidence intentionally omitted — may hold operational/privileged noise
      })),
    },
    confidenceStory: {
      value: d.confidenceStory.value,
      band: d.confidenceStory.band,
      reasons: d.confidenceStory.reasons.map((reason) => ({
        code: reason.code,
        labelKey: reason.labelKey,
        params: reason.params,
      })),
      components: d.confidenceStory.components.map((component) => ({
        key: component.key,
        value: component.value,
      })),
    },
  });

  return {
    schemaVersion: explainability.schemaVersion,
    labelCatalogVersion: explainability.labelCatalogVersion,
    materialityPolicyVersion: explainability.materialityPolicyVersion,
    dimensions: {
      PERFORMANCE: dimPayload(explainability.dimensions.PERFORMANCE),
      SURVIVAL: dimPayload(explainability.dimensions.SURVIVAL),
      UTILITY: dimPayload(explainability.dimensions.UTILITY),
      EXPERIENCE: dimPayload(explainability.dimensions.EXPERIENCE),
    },
    composite: {
      score: explainability.composite.score,
      confidence: explainability.composite.confidence,
      grade: explainability.composite.grade,
      availableDimensions: explainability.composite.availableDimensions,
      unavailableDimensions: explainability.composite.unavailableDimensions,
      effectiveWeights: explainability.composite.effectiveWeights,
      availabilityCoverage: explainability.composite.availabilityCoverage,
      confidenceFormulaVersion: explainability.composite.confidenceFormulaVersion ?? null,
    },
  };
}

export function fingerprintScoreExplainability(
  explainability: Omit<ScoreExplainabilityV1, "fingerprint">,
): string {
  return stableSha256(fingerprintPayloadFromExplainability(explainability));
}
