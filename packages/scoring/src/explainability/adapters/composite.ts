import type { CompositeExplainabilityV1 } from "@mplus/contracts";
import type { PartialCompositeResult } from "../../composite/partial-composite.js";

export function adaptCompositeExplainability(
  result: PartialCompositeResult | null | undefined,
): CompositeExplainabilityV1 {
  if (result == null) {
    return {
      score: null,
      confidence: 0,
      grade: "U",
      availableDimensions: [],
      unavailableDimensions: [
        "performance",
        "survival",
        "utility",
        "experience",
      ],
      effectiveWeights: {},
      availabilityCoverage: 0,
    };
  }

  const availableDimensions = (
    Object.keys(result.effectiveWeights) as Array<
      keyof typeof result.effectiveWeights
    >
  ).filter((key) => result.effectiveWeights[key] != null);

  return {
    score: result.composite,
    confidence: result.confidence,
    grade: result.grade,
    availableDimensions: [...availableDimensions].sort(),
    unavailableDimensions: [...result.explanation.unavailableKeys].sort(),
    effectiveWeights: Object.fromEntries(
      availableDimensions.map((key) => [key, result.effectiveWeights[key] ?? 0]),
    ),
    availabilityCoverage: result.availabilityCoverage,
    confidenceFormulaVersion: result.explanation.formulaVersion,
  };
}
