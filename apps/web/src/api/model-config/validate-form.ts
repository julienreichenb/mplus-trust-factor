import type { ModelValidationResult } from "../types";
import { parsePersistedModelConfig } from "./adapter";
import { METRIC_WEIGHT_DIMENSIONS, type ModelConfigFormState } from "./types";

const WEIGHT_SUM_EPSILON = 0.01;

/**
 * Local form validation aligned with server validateConfig (weights / blend / grades)
 * plus per-dimension metricWeights sum checks.
 * Does not silently normalize invalid weights.
 */
export function validateModelConfigForm(form: ModelConfigFormState): ModelValidationResult {
  const errors: string[] = [];
  const w = form.weights;
  const weightSum =
    Number(w.performance) +
    Number(w.survival) +
    Number(w.utility) +
    Number(w.experienceConsistency) +
    Number(w.mythicRaid);

  if (Math.abs(weightSum - 1) > WEIGHT_SUM_EPSILON) {
    errors.push(`weights must sum to ~1 (got ${weightSum.toFixed(4)})`);
  }

  const blendSum =
    Number(form.authenticityBlend.skillWeight) + Number(form.authenticityBlend.authenticityWeight);
  if (Math.abs(blendSum - 1) > WEIGHT_SUM_EPSILON) {
    errors.push(`authenticityBlend weights must sum to ~1 (got ${blendSum.toFixed(4)})`);
  }

  const { S, A, B, C } = form.gradeThresholds;
  if (!(S >= A && A >= B && B >= C)) {
    errors.push("gradeThresholds must be non-increasing: S >= A >= B >= C");
  }

  for (const dim of METRIC_WEIGHT_DIMENSIONS) {
    const defs = form.metricWeights[dim];
    if (!defs || defs.length === 0) {
      errors.push(`metricWeights.${dim} must be non-empty`);
      continue;
    }
    const mSum = defs.reduce((sum, d) => sum + Number(d.weight), 0);
    if (Math.abs(mSum - 1) > WEIGHT_SUM_EPSILON) {
      errors.push(`metricWeights.${dim} must sum to 1 (got ${mSum.toFixed(4)})`);
    }
  }

  if (form.authenticityTags) {
    if (!(form.authenticityTags.boostSuspectedBelow < form.authenticityTags.atypicalBelow)) {
      errors.push("authenticityTags: boostSuspectedBelow must be < atypicalBelow");
    }
  }

  return { valid: errors.length === 0, errors, weightSum };
}

/** Validate form state or raw persisted JSON via the parse boundary. */
export function validateModelConfig(config: unknown): ModelValidationResult {
  if (isFormState(config)) {
    return validateModelConfigForm(config);
  }
  const parsed = parsePersistedModelConfig(config);
  if (!parsed.ok) {
    return { valid: false, errors: [parsed.diagnostic], weightSum: 0 };
  }
  return validateModelConfigForm(parsed.form);
}

function isFormState(config: unknown): config is ModelConfigFormState {
  if (config === null || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;
  return (
    "weights" in c &&
    "metricWeights" in c &&
    "authenticityBlend" in c &&
    "gradeThresholds" in c &&
    "confidenceNeutralScore" in c &&
    "minConfidenceForGrade" in c &&
    "authenticityTags" in c &&
    (c.minConfidenceForGrade === null || typeof c.minConfidenceForGrade === "number") &&
    (c.authenticityTags === null || typeof c.authenticityTags === "object")
  );
}
