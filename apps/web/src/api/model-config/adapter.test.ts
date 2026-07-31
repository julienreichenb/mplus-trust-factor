import { describe, expect, it } from "vitest";
import {
  parsePersistedModelConfig,
  toPersistedConfig,
  validateModelConfig,
  validateModelConfigForm,
} from "./index";
import { PERSISTED_V6_SCORE_MODEL_CONFIG } from "./persisted-v6-fixture";
import { deepClone } from "../../lib/clone";

describe("parsePersistedModelConfig", () => {
  it("parses a real seeded v6 config without inventing mock fields", () => {
    const result = parsePersistedModelConfig(PERSISTED_V6_SCORE_MODEL_CONFIG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.form.weights.performance).toBe(0.35);
    expect(result.form.metricWeights.PERFORMANCE[0]?.metricKey).toBe(
      "performance.current_season_peak",
    );
    expect(result.form.metricWeights.UTILITY).toEqual([
      { metricKey: "utility.observed_contribution", weight: 1 },
    ]);
    expect(result.form.authenticityTags).toBeNull();
    expect(result.form.minConfidenceForGrade).toBe(0.35);
    expect(result.base).not.toHaveProperty("nestedMetricWeights");
    expect(result.base).toHaveProperty("eligibility");
    expect(result.base).toHaveProperty("overallFormula", "WEIGHTED_DIMENSIONS");
  });

  it("rejects malformed legacy configs with a diagnostic", () => {
    const result = parsePersistedModelConfig({
      nestedMetricWeights: { performance: { a: 1 } },
      confidenceParameters: { minRunsForFullConfidence: 20 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic).toMatch(/malformed|Unsupported/i);
  });
});

describe("toPersistedConfig", () => {
  it("preserves unedited canonical fields and emits metricWeights not nestedMetricWeights", () => {
    const parsed = parsePersistedModelConfig(PERSISTED_V6_SCORE_MODEL_CONFIG);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const form = deepClone(parsed.form);
    form.weights.performance = 0.34;
    form.weights.survival = 0.31;

    const saved = toPersistedConfig(form, parsed.base, { key: "default", version: 6 });
    expect(saved.metricWeights).toEqual(PERSISTED_V6_SCORE_MODEL_CONFIG.metricWeights);
    expect(saved).not.toHaveProperty("nestedMetricWeights");
    expect(saved).not.toHaveProperty("confidenceParameters");
    expect(saved).not.toHaveProperty("boostThresholds");
    expect(saved.eligibility).toEqual(PERSISTED_V6_SCORE_MODEL_CONFIG.eligibility);
    expect(saved.utilityPublicationEligibility).toEqual(
      PERSISTED_V6_SCORE_MODEL_CONFIG.utilityPublicationEligibility,
    );
    expect(saved.overallFormula).toBe("WEIGHTED_DIMENSIONS");
    expect(saved.weights).toMatchObject({ performance: 0.34, survival: 0.31 });
    expect(saved.key).toBe("default");
    expect(saved.version).toBe(6);
  });

  it("strips accidental mock-only keys from base on save", () => {
    const base = {
      ...deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
      nestedMetricWeights: { performance: { x: 1 } },
      boostThresholds: { suspicionSoft: 0.4, suspicionHard: 0.7 },
    } as Record<string, unknown>;
    const parsed = parsePersistedModelConfig(PERSISTED_V6_SCORE_MODEL_CONFIG);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const saved = toPersistedConfig(parsed.form, base);
    expect(saved).not.toHaveProperty("nestedMetricWeights");
    expect(saved).not.toHaveProperty("boostThresholds");
  });
});

describe("validateModelConfig", () => {
  it("accepts the persisted v6 fixture", () => {
    const result = validateModelConfig(PERSISTED_V6_SCORE_MODEL_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.weightSum).toBeCloseTo(1, 2);
  });

  it("rejects invalid weight sums without normalizing", () => {
    const parsed = parsePersistedModelConfig(PERSISTED_V6_SCORE_MODEL_CONFIG);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const bad = deepClone(parsed.form);
    bad.weights.performance = 0.9;
    const result = validateModelConfigForm(bad);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/sum/);
    expect(bad.weights.performance).toBe(0.9);
  });
});
