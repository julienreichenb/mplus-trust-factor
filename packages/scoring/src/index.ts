import type {
  Grade,
  MetricObservationDTO,
  ScoreModelConfig,
  ScoreSnapshotDTO,
  ScoreScope,
} from "@mplus/contracts";

export interface CalculateScoreInput {
  characterId: string;
  seasonSlug: string;
  model: ScoreModelConfig;
  scopeType: ScoreScope;
  scopeKey: string | null;
  observations: MetricObservationDTO[];
  calculatedAt: string;
  inputFingerprint: string;
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function toGrade(score: number, thresholds: ScoreModelConfig["gradeThresholds"]): Grade {
  if (score >= thresholds.S) return "S";
  if (score >= thresholds.A) return "A";
  if (score >= thresholds.B) return "B";
  if (score >= thresholds.C) return "C";
  return "D";
}

/**
 * Neutral deterministic placeholder.
 * Full scoring/boost engine is owned by Agent 4 (`packages/scoring/**`).
 */
export function calculateScore(input: CalculateScoreInput): ScoreSnapshotDTO {
  const { model } = input;
  const confidence =
    input.observations.length === 0
      ? 0
      : input.observations.reduce((sum, obs) => sum + obs.confidence, 0) /
        input.observations.length;

  const skillScore = 50;
  const authenticityScore = 50;
  const observedTrust =
    skillScore * (model.authenticityBlend.skillWeight +
      model.authenticityBlend.authenticityWeight * (authenticityScore / 100));
  const overallScore = clampScore(
    confidence * observedTrust + (1 - confidence) * model.confidenceNeutralScore,
  );

  return {
    characterId: input.characterId,
    seasonSlug: input.seasonSlug,
    modelKey: model.key,
    modelVersion: model.version,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    overallScore,
    grade: toGrade(overallScore, model.gradeThresholds),
    skillScore,
    authenticityScore,
    confidence,
    calculatedAt: input.calculatedAt,
    inputFingerprint: input.inputFingerprint,
    dimensions: [
      {
        dimension: "PERFORMANCE",
        score: 50,
        confidence,
        weight: model.weights.performance,
        contributors: [],
      },
      {
        dimension: "SURVIVAL",
        score: 50,
        confidence,
        weight: model.weights.survival,
        contributors: [],
      },
      {
        dimension: "UTILITY",
        score: 50,
        confidence,
        weight: model.weights.utility,
        contributors: [],
      },
      {
        dimension: "EXPERIENCE",
        score: 50,
        confidence,
        weight: model.weights.experienceConsistency,
        contributors: [],
      },
      {
        dimension: "RAID",
        score: 50,
        confidence,
        weight: model.weights.mythicRaid,
        contributors: [],
      },
    ],
    redFlags: [],
    explanation: {
      placeholder: true,
      ownedBy: "agent-4",
      note: "Neutral placeholder until scoring engine is implemented",
    },
  };
}
