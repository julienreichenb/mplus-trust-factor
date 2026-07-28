import { describe, expect, it } from "vitest";
import { createDefaultModelV3, validateScoreModelConfig } from "../index.js";

describe("createDefaultModelV3", () => {
  it("validates Wave 4 global and metric weights", () => {
    const model = createDefaultModelV3();
    const result = validateScoreModelConfig(model);
    expect(result.ok, result.errors.join("; ")).toBe(true);
    expect(model.weights.performance).toBe(0.35);
    expect(model.weights.survival).toBe(0.3);
    expect(model.weights.utility).toBe(0.25);
    expect(model.weights.experienceConsistency).toBe(0.1);
    expect(model.weights.mythicRaid).toBe(0);
    expect(model.metricWeights.PERFORMANCE).toEqual([
      { metricKey: "performance.v3.run_performance", weight: 1 },
    ]);
  });
});
