import type { IsoDateTime } from "./identity.js";

export type ScoreDimension =
  | "PERFORMANCE"
  | "SURVIVAL"
  | "UTILITY"
  | "EXPERIENCE"
  | "RAID"
  | "AUTHENTICITY";

export type Grade = "S" | "A" | "B" | "C" | "D";

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
}

export interface DimensionScoreDTO {
  dimension: ScoreDimension;
  score: number;
  confidence: number;
  weight: number;
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
  calculatedAt: IsoDateTime;
  inputFingerprint: string;
  dimensions: DimensionScoreDTO[];
  redFlags: RedFlagDTO[];
  explanation: unknown;
}
