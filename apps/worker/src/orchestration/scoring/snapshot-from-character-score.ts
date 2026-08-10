/**
 * Map authoritative CharacterScore / scoreCharacter result → public ScoreSnapshotDTO.
 * Keeps API/UI shape while legacy placeholder calculateScore is removed.
 */
import type {
  DimensionScoreDTO,
  Grade,
  ScoreSnapshotDTO,
} from "@mplus/contracts";
import {
  computePartialComposite,
  contributorsFromLegacyConfidenceContext,
  defaultSkillDimensionWeights,
  productDimensionExplainabilityFields,
  type ExperiencePhase1Result,
} from "@mplus/scoring";
import type { ScoreCharacterResult } from "./score-character.js";
import { SCORING_VERSION } from "./score-character.js";

function dimensionState(
  score: number | null | undefined,
  confidence: number | null | undefined,
  blockedReason: string | null,
): DimensionScoreDTO["state"] {
  if (blockedReason) return "UNAVAILABLE";
  if (score == null || !Number.isFinite(score)) return "UNAVAILABLE";
  if ((confidence ?? 0) < 0.35) return "PARTIAL";
  return "AVAILABLE";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * @deprecated Prefer contributorsFromPublicScoreDrivers / productDimensionExplainabilityFields.
 * Retained for tests that assert the old limitation→context shape; no longer used for
 * NEW canonical explainability-backed scores (never maps limitations to negative).
 */
export function contributorsFromLimitations(
  limitations: readonly string[] | null | undefined,
): DimensionScoreDTO["contributors"] {
  return contributorsFromLegacyConfidenceContext(limitations);
}

function resolveExperiencePresentation(experience: ExperiencePhase1Result | null | undefined): {
  score: number | null;
  available: boolean;
  confidence: number | null;
  reason: string | null;
} {
  if (!experience) {
    return {
      score: null,
      available: false,
      confidence: null,
      reason: "EXPERIENCE_UNAVAILABLE",
    };
  }
  if (
    experience.available === true &&
    experience.score != null &&
    Number.isFinite(experience.score)
  ) {
    return {
      score: experience.score,
      available: true,
      confidence: experience.confidence ?? 1,
      reason: null,
    };
  }
  const reason = experience.reason ?? "EXPERIENCE_UNAVAILABLE";
  return {
    score: null,
    available: false,
    confidence: null,
    reason,
  };
}

export function scoreCharacterResultToSnapshotDto(input: {
  result: ScoreCharacterResult;
  characterId: string;
  seasonSlug: string;
  scoreModelKey: string;
  scoreModelVersion: number;
  calculatedAt: string;
  inputFingerprint: string;
  publicationEnabled: boolean;
  /** Optional model weights / thresholds when known at call site. */
  dimensionWeights?: {
    performance: number;
    survival: number;
    utility: number;
    experience: number;
  };
  gradeThresholds?: { S: number; A: number; B: number; C: number };
  minConfidenceForGrade?: number;
  /** Persisted composite / tier / confidence when CharacterScore was saved. */
  persisted?: {
    composite: number | null;
    confidence: number | null;
    tier: Grade | null;
    experience?: number | null;
  };
}): ScoreSnapshotDTO {
  const { orchestration, explainability } = input.result;
  const perf = orchestration.dimensions.performance;
  const util = orchestration.dimensions.utility;
  const surv = orchestration.dimensions.survival;
  const blocked = new Map(
    orchestration.dimensions.blocked.map((b) => [b.dimension, b.reason]),
  );
  const experiencePresentation = resolveExperiencePresentation(input.result.experience);

  // Prefer already-persisted Experience column when present so snapshot cannot
  // disagree with CharacterScore on the Experience score/availability.
  const experienceScore =
    input.persisted?.experience !== undefined
      ? input.persisted.experience
      : experiencePresentation.score;
  const experienceAvailable =
    experienceScore != null && Number.isFinite(experienceScore);
  const experienceReason = experienceAvailable
    ? null
    : experiencePresentation.reason;
  const experienceConfidence = experienceAvailable
    ? experiencePresentation.confidence
    : null;

  const weights = input.dimensionWeights ?? defaultSkillDimensionWeights();
  const partial = computePartialComposite(
    [
      {
        key: "performance",
        score: perf?.score ?? null,
        available: perf?.score != null && Number.isFinite(perf.score),
        baseWeight: weights.performance,
        confidence: perf?.confidence ?? null,
        confidenceCauses:
          perf?.confidenceBreakdown?.causes ?? perf?.limitations ?? null,
      },
      {
        key: "survival",
        score: surv?.score ?? null,
        available: surv?.score != null && Number.isFinite(surv.score),
        baseWeight: weights.survival,
        confidence: surv?.confidence ?? null,
        confidenceCauses:
          surv?.confidenceBreakdown?.causes ??
          surv?.explanation?.limitations ??
          null,
      },
      {
        key: "utility",
        score: util?.score ?? null,
        available: util?.score != null && Number.isFinite(util.score),
        baseWeight: weights.utility,
        confidence: util?.confidence ?? null,
        confidenceCauses:
          util?.confidenceBreakdown?.causes ??
          util?.explanation?.confidenceReasons ??
          null,
      },
      {
        key: "experience",
        score: experienceScore,
        available: experienceAvailable,
        baseWeight: weights.experience,
        confidence: experienceConfidence,
        confidenceCauses: input.result.experience?.confidenceCauses ?? null,
      },
    ],
    {
      gradeThresholds: input.gradeThresholds ?? { S: 90, A: 80, B: 65, C: 50 },
      minConfidenceForGrade: input.minConfidenceForGrade ?? 0.35,
    },
  );

  const overallScore =
    input.persisted?.composite ?? partial.composite ?? 0;
  const confidence = input.persisted?.confidence ?? partial.confidence;
  const grade: Grade = partial.grade;

  // Same public projector as CharacterScore API reads — never rebuild from limitations.
  const perfExplain = productDimensionExplainabilityFields(
    explainability,
    "PERFORMANCE",
  );
  const utilExplain = productDimensionExplainabilityFields(
    explainability,
    "UTILITY",
  );
  const survExplain = productDimensionExplainabilityFields(
    explainability,
    "SURVIVAL",
  );
  const expExplain = productDimensionExplainabilityFields(
    explainability,
    "EXPERIENCE",
  );

  const dimensions: DimensionScoreDTO[] = [
    {
      dimension: "PERFORMANCE",
      score: perf?.score ?? null,
      confidence: clamp01(perf?.confidence ?? 0),
      weight: weights.performance,
      state: dimensionState(
        perf?.score,
        perf?.confidence,
        blocked.get("PERFORMANCE") ?? null,
      ),
      reason: blocked.get("PERFORMANCE") ?? null,
      contributors: perfExplain.contributors,
      explainability: perfExplain.explainability,
    },
    {
      dimension: "UTILITY",
      score: util?.score ?? null,
      confidence: clamp01(util?.confidence ?? 0),
      weight: weights.utility,
      state: dimensionState(
        util?.score,
        util?.confidence,
        blocked.get("UTILITY") ?? null,
      ),
      reason: blocked.get("UTILITY") ?? null,
      contributors: utilExplain.contributors,
      explainability: utilExplain.explainability,
    },
    {
      dimension: "SURVIVAL",
      score: surv?.score ?? null,
      confidence: clamp01(surv?.confidence ?? 0),
      weight: weights.survival,
      state: dimensionState(
        surv?.score,
        surv?.confidence,
        blocked.get("SURVIVAL") ?? null,
      ),
      reason: blocked.get("SURVIVAL") ?? null,
      contributors: survExplain.contributors,
      explainability: survExplain.explainability,
    },
    {
      dimension: "EXPERIENCE",
      score: experienceScore,
      confidence: experienceAvailable ? clamp01(experienceConfidence ?? 1) : 0,
      weight: weights.experience,
      state: dimensionState(
        experienceScore,
        experienceConfidence,
        experienceReason,
      ),
      reason: experienceReason,
      contributors: expExplain.contributors,
      explainability: expExplain.explainability,
    },
  ];

  const availableCount = partial.availableCount;
  const incomplete = orchestration.incomplete || availableCount < 4;
  const overallState: NonNullable<ScoreSnapshotDTO["overallState"]> =
    availableCount === 0
      ? "PROVISIONAL"
      : incomplete
        ? "PROVISIONAL"
        : "DEFINITIVE";

  return {
    characterId: input.characterId,
    seasonSlug: input.seasonSlug,
    modelKey: input.scoreModelKey,
    modelVersion: input.scoreModelVersion,
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore,
    skillScore: overallScore,
    authenticityScore: 100,
    confidence,
    grade,
    overallState,
    provisionalReason: incomplete
      ? partial.explanation.unavailableKeys.length > 0
        ? `PARTIAL_DIMENSIONS:${partial.explanation.unavailableKeys.join(",")}`
        : `PARTIAL_EVIDENCE:selected=${orchestration.selectedSlotCount}/${orchestration.expectedSlotCount}`
      : null,
    dimensions,
    calculatedAt: input.calculatedAt,
    inputFingerprint: input.inputFingerprint,
    redFlags: [],
    explanation: {
      scoringVersion: input.result.scoringVersion ?? SCORING_VERSION,
      characterScoreId: input.result.characterScoreId,
      providerCalls: input.result.providerCalls,
      publicationEnabled: input.publicationEnabled,
      incomplete: orchestration.incomplete,
      cacheMisses: orchestration.cacheMisses.length,
      fightFailures: orchestration.fightFailures.length,
      targetDigestFailures: orchestration.targetDigestFailures.length,
      blocked: orchestration.dimensions.blocked,
      partialComposite: partial.explanation,
      availabilityCoverage: partial.availabilityCoverage,
      effectiveWeights: partial.effectiveWeights,
      experience: input.result.experience,
      explainabilityFingerprint: explainability.fingerprint,
      selectedRuns: orchestration.characterDigests.map((d) => ({
        slotId: d.slotId,
        dungeonSlug: d.dungeonSlug,
        reportCode: d.digest.reportCode,
        fightId: d.digest.fightId,
        reportRevision: d.digest.reportRevision,
      })),
    },
    rankingEligibility: {
      eligible: availableCount > 0 && grade !== "U",
      scoreModelVersion: input.scoreModelVersion,
      reasons: availableCount === 0 ? ["NO_AVAILABLE_DIMENSIONS"] : incomplete ? ["PARTIAL_DIMENSIONS"] : [],
      utilityEligible: util?.score != null,
    },
  };
}

export function scoringDisabledSnapshotDto(input: {
  characterId: string;
  seasonSlug: string;
  scoreModelKey: string;
  scoreModelVersion: number;
  calculatedAt: string;
  inputFingerprint: string;
}): ScoreSnapshotDTO {
  return {
    characterId: input.characterId,
    seasonSlug: input.seasonSlug,
    modelKey: input.scoreModelKey,
    modelVersion: input.scoreModelVersion,
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore: 0,
    skillScore: 0,
    authenticityScore: 0,
    confidence: 0,
    grade: "U",
    overallState: "PROVISIONAL",
    provisionalReason: "SCORING_DISABLED",
    dimensions: (
      ["PERFORMANCE", "UTILITY", "SURVIVAL", "EXPERIENCE"] as const
    ).map((dimension) => ({
      dimension,
      score: null,
      confidence: 0,
      weight: 0.25,
      state: "UNAVAILABLE" as const,
      reason: "SCORING_DISABLED",
      contributors: [],
    })),
    calculatedAt: input.calculatedAt,
    inputFingerprint: input.inputFingerprint,
    redFlags: [],
    explanation: { scoringDisabled: true },
    rankingEligibility: {
      eligible: false,
      scoreModelVersion: input.scoreModelVersion,
      reasons: ["SCORING_DISABLED"],
      utilityEligible: false,
    },
  };
}
