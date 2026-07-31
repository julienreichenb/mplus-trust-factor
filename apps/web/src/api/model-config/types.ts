/** Canonical skill dimensions used by persisted metricWeights. */
export const METRIC_WEIGHT_DIMENSIONS = [
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
  "EXPERIENCE",
  "RAID",
] as const;

export type MetricWeightDimension = (typeof METRIC_WEIGHT_DIMENSIONS)[number];

export interface MetricWeightEntry {
  metricKey: string;
  weight: number;
  roles?: string[];
  excludeRoles?: string[];
}

export type DimensionMetricWeightsForm = Record<MetricWeightDimension, MetricWeightEntry[]>;

export interface DimensionWeightsForm {
  performance: number;
  survival: number;
  utility: number;
  experienceConsistency: number;
  mythicRaid: number;
}

export interface AuthenticityBlendForm {
  skillWeight: number;
  authenticityWeight: number;
}

export interface GradeThresholdsForm {
  S: number;
  A: number;
  B: number;
  C: number;
}

/** Editable authenticity tag thresholds when present on persisted config. */
export interface AuthenticityTagsForm {
  boostSuspectedBelow: number;
  atypicalBelow: number;
  minEvidenceStrength?: number;
}

/**
 * Frontend editable form state derived from persisted ScoreModel.config.
 * Does not include mock-only nestedMetricWeights / confidenceParameters / boostThresholds.
 */
export interface ModelConfigFormState {
  weights: DimensionWeightsForm;
  authenticityBlend: AuthenticityBlendForm;
  confidenceNeutralScore: number;
  gradeThresholds: GradeThresholdsForm;
  metricWeights: DimensionMetricWeightsForm;
  minConfidenceForGrade: number | null;
  authenticityTags: AuthenticityTagsForm | null;
}

export interface ModelConfigParseOk {
  ok: true;
  form: ModelConfigFormState;
  /** Deep clone of the original persisted object for merge-on-save. */
  base: Record<string, unknown>;
}

export interface ModelConfigParseFail {
  ok: false;
  diagnostic: string;
}

export type ModelConfigParseResult = ModelConfigParseOk | ModelConfigParseFail;

export interface PersistedConfigMeta {
  key?: string;
  version?: number;
}

/** Mock-only keys that must never be written back to persisted config. */
export const MOCK_ONLY_CONFIG_KEYS = [
  "nestedMetricWeights",
  "confidenceParameters",
  "boostThresholds",
] as const;
