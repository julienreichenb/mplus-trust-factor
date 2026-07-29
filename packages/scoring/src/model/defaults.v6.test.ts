import { describe, expect, it } from "vitest";
import {
  createDefaultModelV5,
  createDefaultModelV6,
  DEFAULT_V6_UTILITY_PUBLICATION_ELIGIBILITY,
} from "./defaults.js";

describe("model v6 utilityPublicationEligibility", () => {
  it("includes Utility publication gates on v6", () => {
    const v6 = createDefaultModelV6();
    expect(v6.version).toBe(6);
    expect(v6.utilityPublicationEligibility).toEqual(DEFAULT_V6_UTILITY_PUBLICATION_ELIGIBILITY);
    expect(v6.overallFormula).toBe("WEIGHTED_DIMENSIONS");
    expect(v6.metricWeights.UTILITY).toEqual([
      { metricKey: "utility.observed_contribution", weight: 1 },
    ]);
  });

  it("keeps v5 without Utility publication gates and with combat-facts Utility metrics", () => {
    const v5 = createDefaultModelV5();
    expect(v5.version).toBe(5);
    expect(v5.utilityPublicationEligibility).toBeUndefined();
    expect(v5.overallFormula).toBe("LEGACY_AUTHENTICITY_CONFIDENCE_BLEND");
    expect(v5.metricWeights.SURVIVAL).toEqual(createDefaultModelV6().metricWeights.SURVIVAL);
    expect(v5.metricWeights.UTILITY.some((m) => m.metricKey === "utility.interrupts")).toBe(true);
  });

  it("does not take Utility gates from environment", () => {
    process.env.UTILITY_MIN_ANALYZED_RUNS = "99";
    process.env.UTILITY_MIN_CONFIDENCE = "0.99";
    const v6 = createDefaultModelV6();
    expect(v6.utilityPublicationEligibility?.minAnalyzedRuns).toBe(3);
    expect(v6.utilityPublicationEligibility?.minConfidence).toBe(0.45);
    delete process.env.UTILITY_MIN_ANALYZED_RUNS;
    delete process.env.UTILITY_MIN_CONFIDENCE;
  });
});
