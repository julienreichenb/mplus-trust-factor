import type { IsoDateTime } from "./identity.js";

export type ScoreDimension =
  | "PERFORMANCE"
  | "SURVIVAL"
  | "UTILITY"
  | "EXPERIENCE"
  | "RAID"
  | "AUTHENTICITY";

/** Letter grades plus `U` = UNRATED / insufficient confidence to present a reliable rating. */
export type Grade = "S" | "A" | "B" | "C" | "D" | "U";

export type ScoreScope = "CHARACTER" | "ROLE" | "CLASS" | "SPEC" | "ACCOUNT";

export interface MetricCoverage {
  present: number;
  expected: number;
  ratio: number;
}

export interface MetricObservationDTO {
  metricKey: string;
  dimension: ScoreDimension;
  rawValue: number | null;
  normalizedValue: number | null;
  confidence: number;
  observedAt: IsoDateTime;
  sourceProvider: string;
  coverage: MetricCoverage | null;
  context: unknown;
}

export interface ScoreModelConfig {
  key: string;
  version: number;
  weights: {
    performance: number;
    survival: number;
    utility: number;
    experienceConsistency: number;
    mythicRaid: number;
  };
  authenticityBlend: {
    skillWeight: number;
    authenticityWeight: number;
  };
  confidenceNeutralScore: number;
  gradeThresholds: {
    S: number;
    A: number;
    B: number;
    C: number;
  };
  /**
   * Below this overall confidence, grade is `U` (UNRATED / INSUFFICIENT_DATA)
   * rather than a letter grade that looks reliable.
   */
  minConfidenceForGrade?: number;
}

export type DimensionDataState =
  | "AVAILABLE"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "PROCESSING"
  | "ERROR";

export interface DimensionScoreDTO {
  dimension: ScoreDimension;
  /**
   * Public numeric score. Null when state is UNAVAILABLE / PROCESSING / ERROR —
   * never expose the internal confidence-neutral fallback (e.g. 50) as observed.
   */
  score: number | null;
  confidence: number;
  weight: number;
  /** Explicit availability semantics for API/UI (never infer from score alone). */
  state: DimensionDataState;
  /** Machine-readable reason when not AVAILABLE. */
  reason?: string | null;
  contributors: unknown;
}

export interface RedFlagDTO {
  key: string;
  label: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: number;
  public: boolean;
  evidence: unknown;
}

export type OverallScoreState = "DEFINITIVE" | "PROVISIONAL";

export interface RankingEligibilityDTO {
  eligible: boolean;
  scoreModelVersion: number;
  utilityEligible: boolean;
  reasons: string[];
}

export interface ScoreSnapshotDTO {
  characterId: string;
  seasonSlug: string;
  modelKey: string;
  modelVersion: number;
  scopeType: ScoreScope;
  scopeKey: string | null;
  overallScore: number;
  grade: Grade;
  skillScore: number;
  authenticityScore: number;
  confidence: number;
  /** Whether the overall grade meets minimum model-weight coverage for a definitive rating. */
  overallState?: OverallScoreState;
  availableModelWeight?: number;
  totalModelWeight?: number;
  modelCoverageRatio?: number;
  provisionalReason?: string | null;
  /** Complete-ranking eligibility (v6 + published Utility). Profiles remain viewable when false. */
  rankingEligibility?: RankingEligibilityDTO | null;
  calculatedAt: IsoDateTime;
  inputFingerprint: string;
  dimensions: DimensionScoreDTO[];
  redFlags: RedFlagDTO[];
  explanation: unknown;
}
