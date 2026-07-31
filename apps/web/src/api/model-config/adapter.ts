import { deepClone } from "../../lib/clone";
import {
  METRIC_WEIGHT_DIMENSIONS,
  MOCK_ONLY_CONFIG_KEYS,
  type AuthenticityTagsForm,
  type DimensionMetricWeightsForm,
  type DimensionWeightsForm,
  type MetricWeightEntry,
  type ModelConfigFormState,
  type ModelConfigParseResult,
  type PersistedConfigMeta,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseWeights(raw: unknown): DimensionWeightsForm | null {
  if (!isRecord(raw)) return null;
  const {
    performance,
    survival,
    utility,
    experienceConsistency,
    mythicRaid,
  } = raw;
  if (
    !isFiniteNumber(performance) ||
    !isFiniteNumber(survival) ||
    !isFiniteNumber(utility) ||
    !isFiniteNumber(experienceConsistency) ||
    !isFiniteNumber(mythicRaid)
  ) {
    return null;
  }
  return { performance, survival, utility, experienceConsistency, mythicRaid };
}

function parseMetricWeightEntry(raw: unknown): MetricWeightEntry | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.metricKey !== "string" || raw.metricKey.length === 0) return null;
  if (!isFiniteNumber(raw.weight)) return null;
  const entry: MetricWeightEntry = {
    metricKey: raw.metricKey,
    weight: raw.weight,
  };
  if (Array.isArray(raw.roles) && raw.roles.every((r) => typeof r === "string")) {
    entry.roles = raw.roles as string[];
  }
  if (Array.isArray(raw.excludeRoles) && raw.excludeRoles.every((r) => typeof r === "string")) {
    entry.excludeRoles = raw.excludeRoles as string[];
  }
  return entry;
}

function parseMetricWeights(raw: unknown): DimensionMetricWeightsForm | null {
  if (!isRecord(raw)) return null;
  const out = {} as DimensionMetricWeightsForm;
  for (const dim of METRIC_WEIGHT_DIMENSIONS) {
    const list = raw[dim];
    if (!Array.isArray(list) || list.length === 0) return null;
    const entries: MetricWeightEntry[] = [];
    for (const item of list) {
      const parsed = parseMetricWeightEntry(item);
      if (!parsed) return null;
      entries.push(parsed);
    }
    out[dim] = entries;
  }
  return out;
}

function parseAuthenticityTags(raw: unknown): AuthenticityTagsForm | null {
  if (!isRecord(raw)) return null;
  if (!isFiniteNumber(raw.boostSuspectedBelow) || !isFiniteNumber(raw.atypicalBelow)) {
    return null;
  }
  const tags: AuthenticityTagsForm = {
    boostSuspectedBelow: raw.boostSuspectedBelow,
    atypicalBelow: raw.atypicalBelow,
  };
  if (isFiniteNumber(raw.minEvidenceStrength)) {
    tags.minEvidenceStrength = raw.minEvidenceStrength;
  }
  return tags;
}

/**
 * Boundary: persisted ScoreModel.config JSON → editable form state.
 * Does not inject scoring-package defaults or mock-only UI fields.
 */
export function parsePersistedModelConfig(raw: unknown): ModelConfigParseResult {
  if (!isRecord(raw)) {
    return { ok: false, diagnostic: "Configuration is not a JSON object." };
  }

  const weights = parseWeights(raw.weights);
  if (!weights) {
    return {
      ok: false,
      diagnostic:
        "Unsupported or malformed configuration: missing or invalid dimension weights (performance, survival, utility, experienceConsistency, mythicRaid).",
    };
  }

  if (!isRecord(raw.authenticityBlend)) {
    return {
      ok: false,
      diagnostic: "Unsupported or malformed configuration: missing authenticityBlend.",
    };
  }
  const { skillWeight, authenticityWeight } = raw.authenticityBlend;
  if (!isFiniteNumber(skillWeight) || !isFiniteNumber(authenticityWeight)) {
    return {
      ok: false,
      diagnostic: "Unsupported or malformed configuration: invalid authenticityBlend weights.",
    };
  }

  if (!isFiniteNumber(raw.confidenceNeutralScore)) {
    return {
      ok: false,
      diagnostic: "Unsupported or malformed configuration: missing confidenceNeutralScore.",
    };
  }

  if (!isRecord(raw.gradeThresholds)) {
    return {
      ok: false,
      diagnostic: "Unsupported or malformed configuration: missing gradeThresholds.",
    };
  }
  const { S, A, B, C } = raw.gradeThresholds;
  if (!isFiniteNumber(S) || !isFiniteNumber(A) || !isFiniteNumber(B) || !isFiniteNumber(C)) {
    return {
      ok: false,
      diagnostic: "Unsupported or malformed configuration: invalid gradeThresholds.",
    };
  }

  const metricWeights = parseMetricWeights(raw.metricWeights);
  if (!metricWeights) {
    return {
      ok: false,
      diagnostic:
        "Unsupported or malformed configuration: metricWeights must define non-empty PERFORMANCE, SURVIVAL, UTILITY, EXPERIENCE, and RAID arrays of { metricKey, weight }.",
    };
  }

  const form: ModelConfigFormState = {
    weights,
    authenticityBlend: { skillWeight, authenticityWeight },
    confidenceNeutralScore: raw.confidenceNeutralScore,
    gradeThresholds: { S, A, B, C },
    metricWeights,
    minConfidenceForGrade: isFiniteNumber(raw.minConfidenceForGrade)
      ? raw.minConfidenceForGrade
      : null,
    authenticityTags: parseAuthenticityTags(raw.authenticityTags),
  };

  return { ok: true, form, base: deepClone(raw) };
}

/**
 * Boundary: form state → persisted config for save/validate/backtest.
 * Preserves unknown canonical fields from base; only overlays UI-exposed fields.
 */
export function toPersistedConfig(
  form: ModelConfigFormState,
  base: Record<string, unknown>,
  meta?: PersistedConfigMeta,
): Record<string, unknown> {
  const next = deepClone(base);

  for (const key of MOCK_ONLY_CONFIG_KEYS) {
    delete next[key];
  }

  next.weights = deepClone(form.weights);
  next.authenticityBlend = deepClone(form.authenticityBlend);
  next.confidenceNeutralScore = form.confidenceNeutralScore;
  next.gradeThresholds = deepClone(form.gradeThresholds);
  next.metricWeights = deepClone(form.metricWeights);

  if (form.minConfidenceForGrade !== null) {
    next.minConfidenceForGrade = form.minConfidenceForGrade;
  }

  if (form.authenticityTags !== null) {
    const existing = isRecord(next.authenticityTags) ? next.authenticityTags : {};
    next.authenticityTags = {
      ...existing,
      boostSuspectedBelow: form.authenticityTags.boostSuspectedBelow,
      atypicalBelow: form.authenticityTags.atypicalBelow,
      ...(form.authenticityTags.minEvidenceStrength !== undefined
        ? { minEvidenceStrength: form.authenticityTags.minEvidenceStrength }
        : {}),
    };
  }

  if (meta?.key !== undefined && (typeof next.key !== "string" || !next.key)) {
    next.key = meta.key;
  }
  if (
    meta?.version !== undefined &&
    (typeof next.version !== "number" || !Number.isFinite(next.version))
  ) {
    next.version = meta.version;
  }

  return next;
}
