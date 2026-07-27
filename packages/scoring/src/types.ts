import type {
  Grade,
  MetricObservationDTO,
  RedFlagDTO,
  ScoreDimension,
  ScoreModelConfig,
  ScoreScope,
} from "@mplus/contracts";

export type Role = "DPS" | "TANK" | "HEALER";

export type NormalizationType =
  | "identity"
  | "percentile"
  | "logistic"
  | "piecewise"
  | "winsorize"
  | "season_decay";

export interface MetricWeightDef {
  metricKey: string;
  weight: number;
  /** When set, metric is only used for these roles. */
  roles?: Role[];
  /** Exclude metric for these roles (e.g. raw HPS for tanks). */
  excludeRoles?: Role[];
}

export interface DimensionMetricWeights {
  PERFORMANCE: MetricWeightDef[];
  SURVIVAL: MetricWeightDef[];
  UTILITY: MetricWeightDef[];
  EXPERIENCE: MetricWeightDef[];
  RAID: MetricWeightDef[];
}

export interface NormalizationSpec {
  type: NormalizationType;
  /** For logistic: midpoint and steepness. */
  midpoint?: number;
  steepness?: number;
  /** Piecewise [[raw, score], ...] sorted by raw ascending. */
  points?: Array<[number, number]>;
  /** Winsorize bounds on raw before identity clamp. */
  winsorizeMin?: number;
  winsorizeMax?: number;
  /** Invert after normalize (lower-better raw → higher score). */
  invert?: boolean;
}

export interface AuthenticityFeatureWeights {
  progressionKeyJump: number;
  compressedBestRunWindow: number;
  lowVolumeForScore: number;
  repeatedStrongerTeammates: number;
  topRunRosterConcentration: number;
  weakTargetPerformance: number;
  highDeathsLowContribution: number;
  ratingPerformanceDivergence: number;
  lackIntermediateProgression: number;
}

export interface AuthenticityMitigationWeights {
  confirmedEliteMain: number;
  probableReroll: number;
  strongPriorSeasonSameRole: number;
  strongPersonalTopRunPerformance: number;
  independentGroupDiversity: number;
}

export interface AuthenticityTagThresholds {
  boostSuspectedBelow: number;
  atypicalBelow: number;
  /** Minimum sum of absolute evidence contributions to emit boost/atypical tags. */
  minEvidenceStrength: number;
}

export interface ConfidenceBlendWeights {
  dimensionConfidence: number;
  sourceCoverage: number;
  freshness: number;
  selectedRunCoverage: number;
}

export interface HistoricalDecayWeights {
  currentSeason: number;
  previousSeason: number;
  olderSeasons: number;
}

/**
 * Full v1 model config. Extends the slim public ScoreModelConfig fields.
 * Rich sections are scoring-package-local until a coordinated contract upgrade.
 */
export interface ScoreModelConfigV1 extends ScoreModelConfig {
  metricWeights: DimensionMetricWeights;
  normalization: Record<string, NormalizationSpec>;
  historicalDecay: HistoricalDecayWeights;
  minCoverageForExtreme: number;
  extremeCapLow: number;
  extremeCapHigh: number;
  sampleSizeHalfLife: number;
  confidenceBlend: ConfidenceBlendWeights;
  authenticityFeatures: AuthenticityFeatureWeights;
  authenticityMitigations: AuthenticityMitigationWeights;
  authenticityTags: AuthenticityTagThresholds;
  /** Metric keys suppressed by role (merged with excludeRoles on defs). */
  roleMetricExclusions: Partial<Record<Role, string[]>>;
}

export interface ScoringContext {
  role: Role;
  classSlug?: string | null;
  specSlug?: string | null;
  /** 0–1 freshness of underlying sources. */
  freshness?: number;
  /** 0–1 coverage of selected detailed runs. */
  selectedRunCoverage?: number;
  /** Mechanic catalog version used when deriving survival/utility facts (provenance). */
  mechanicCatalogVersion?: string | null;
  authenticity?: AuthenticityFeatureInput;
}

/** Raw feature values typically 0–1 severity (higher = more suspicious or stronger mitigation). */
export interface AuthenticityFeatureInput {
  progressionKeyJump?: number;
  compressedBestRunWindow?: number;
  lowVolumeForScore?: number;
  repeatedStrongerTeammates?: number;
  topRunRosterConcentration?: number;
  weakTargetPerformance?: number;
  highDeathsLowContribution?: number;
  ratingPerformanceDivergence?: number;
  lackIntermediateProgression?: number;
  confirmedEliteMain?: number;
  probableReroll?: number;
  strongPriorSeasonSameRole?: number;
  strongPersonalTopRunPerformance?: number;
  independentGroupDiversity?: number;
  /** When true, progression-jump features are mitigated; performance evidence is not erased. */
  isConfirmedReroll?: boolean;
  isProbableReroll?: boolean;
}

export interface MetricScoreResult {
  metricKey: string;
  dimension: ScoreDimension;
  rawValue: number | null;
  normalizedValue: number | null;
  weight: number;
  available: boolean;
  confidence: number;
  contribution: number | null;
  sourceProvider: string | null;
}

export interface DimensionScoreResult {
  dimension: ScoreDimension;
  rawScore: number;
  adjustedScore: number;
  confidence: number;
  coverage: number;
  weight: number;
  contributors: MetricScoreResult[];
  missing: MetricScoreResult[];
}

export interface AuthenticityEvidence {
  featureKey: string;
  kind: "suspicion" | "mitigation";
  rawValue: number;
  normalizedSeverity: number;
  confidence: number;
  contribution: number;
}

export interface AuthenticityResult {
  authenticityScore: number;
  evidence: AuthenticityEvidence[];
  evidenceStrength: number;
  tags: string[];
  redFlags: RedFlagDTO[];
}

export interface FinalTrustResult {
  skillScore: number;
  authenticityScore: number;
  observedTrust: number;
  confidence: number;
  overallScore: number;
  grade: Grade;
}

export interface ExplanationContributor {
  metricKey: string;
  dimension: ScoreDimension;
  score: number;
  deltaFromNeutral: number;
  weight: number;
}

export interface ScoreExplanation {
  topPositive: ExplanationContributor[];
  topNegative: ExplanationContributor[];
  missingHighImpact: Array<{ metricKey: string; dimension: ScoreDimension; weight: number }>;
  sourceCategories: string[];
  authenticityHighlights: AuthenticityEvidence[];
  publicSummary: string;
  adminDetail: string;
  modelKey: string;
  modelVersion: number;
  mechanicCatalogVersion: string | null;
}

export interface CalculateScoreEngineInput {
  characterId: string;
  seasonSlug: string;
  model: ScoreModelConfigV1;
  scopeType: ScoreScope;
  scopeKey: string | null;
  observations: MetricObservationDTO[];
  context: ScoringContext;
  calculatedAt: string;
  /** If omitted, computed from inputs + model. */
  inputFingerprint?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export const SKILL_DIMENSIONS: Array<Exclude<ScoreDimension, "AUTHENTICITY">> = [
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
  "EXPERIENCE",
  "RAID",
];

export const DIMENSION_WEIGHT_KEYS: Record<
  Exclude<ScoreDimension, "AUTHENTICITY">,
  keyof ScoreModelConfig["weights"]
> = {
  PERFORMANCE: "performance",
  SURVIVAL: "survival",
  UTILITY: "utility",
  EXPERIENCE: "experienceConsistency",
  RAID: "mythicRaid",
};
