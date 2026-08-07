/**
 * Map persisted CharacterScore → ScoreSnapshotDTO for API reads when
 * publication is off / ScoreSnapshot rows are absent.
 */
import type { DimensionScoreDTO, Grade, ScoreSnapshotDTO } from "@mplus/contracts";
import {
  computePartialComposite,
  defaultSkillDimensionWeights,
} from "@mplus/scoring";

export type CharacterScoreReadRow = {
  id: string;
  characterId: string;
  seasonId: string;
  scoringVersion: string;
  performance: number | null;
  utility: number | null;
  survival: number | null;
  experience: number | null;
  composite: number | null;
  confidence: number | null;
  tier?: string | null;
  calculatedAt: Date;
  dimensionDetails: unknown;
  season?: { slug: string } | null;
};

function dimState(score: number | null, reason: string | null): DimensionScoreDTO["state"] {
  if (reason) return "UNAVAILABLE";
  if (score == null || !Number.isFinite(score)) return "UNAVAILABLE";
  return "AVAILABLE";
}

function blockedReason(
  details: Record<string, unknown> | null,
  dimension: string,
): string | null {
  const blocked = details?.blocked;
  if (!Array.isArray(blocked)) return null;
  const hit = blocked.find(
    (b) =>
      b &&
      typeof b === "object" &&
      (b as { dimension?: string }).dimension === dimension,
  ) as { reason?: string } | undefined;
  return typeof hit?.reason === "string" ? hit.reason : null;
}

export function mapCharacterScoreToSnapshotDto(
  row: CharacterScoreReadRow,
  opts?: {
    modelKey?: string;
    modelVersion?: number;
    dimensionWeights?: {
      performance: number;
      survival: number;
      utility: number;
      experience: number;
    };
    gradeThresholds?: { S: number; A: number; B: number; C: number };
    minConfidenceForGrade?: number;
  },
): ScoreSnapshotDTO {
  const details =
    row.dimensionDetails && typeof row.dimensionDetails === "object"
      ? (row.dimensionDetails as Record<string, unknown>)
      : null;

  const perfReason = blockedReason(details, "PERFORMANCE");
  const utilReason = blockedReason(details, "UTILITY");
  const survReason = blockedReason(details, "SURVIVAL");
  const expReason =
    blockedReason(details, "EXPERIENCE") ??
    (row.experience == null ? "EXPERIENCE_NOT_YET_WIRED" : null);

  const weights = opts?.dimensionWeights ?? defaultSkillDimensionWeights();

  const partial = computePartialComposite(
    [
      {
        key: "performance",
        score: row.performance,
        available: row.performance != null && Number.isFinite(row.performance) && !perfReason,
        baseWeight: weights.performance,
        confidence: row.performance != null ? (row.confidence ?? 0.5) : null,
      },
      {
        key: "survival",
        score: row.survival,
        available: row.survival != null && Number.isFinite(row.survival) && !survReason,
        baseWeight: weights.survival,
        confidence: row.survival != null ? (row.confidence ?? 0.5) : null,
      },
      {
        key: "utility",
        score: row.utility,
        available: row.utility != null && Number.isFinite(row.utility) && !utilReason,
        baseWeight: weights.utility,
        confidence: row.utility != null ? (row.confidence ?? 0.5) : null,
      },
      {
        key: "experience",
        score: row.experience,
        available: row.experience != null && Number.isFinite(row.experience) && !expReason,
        baseWeight: weights.experience,
        confidence: row.experience != null ? (row.confidence ?? 0.5) : null,
      },
    ],
    {
      gradeThresholds: opts?.gradeThresholds ?? { S: 90, A: 80, B: 65, C: 50 },
      minConfidenceForGrade: opts?.minConfidenceForGrade ?? 0.35,
    },
  );

  const dimensions: DimensionScoreDTO[] = [
    {
      dimension: "PERFORMANCE",
      score: row.performance,
      confidence: row.performance != null ? (row.confidence ?? 0.5) : 0,
      weight: weights.performance,
      state: dimState(row.performance, perfReason),
      reason: perfReason,
      contributors: [],
    },
    {
      dimension: "UTILITY",
      score: row.utility,
      confidence: row.utility != null ? (row.confidence ?? 0.5) : 0,
      weight: weights.utility,
      state: dimState(row.utility, utilReason),
      reason: utilReason,
      contributors: [],
    },
    {
      dimension: "SURVIVAL",
      score: row.survival,
      confidence: row.survival != null ? (row.confidence ?? 0.5) : 0,
      weight: weights.survival,
      state: dimState(row.survival, survReason),
      reason: survReason,
      contributors: [],
    },
    {
      dimension: "EXPERIENCE",
      score: row.experience,
      confidence: row.experience != null ? (row.confidence ?? 0.5) : 0,
      weight: weights.experience,
      state: dimState(row.experience, expReason),
      reason: expReason,
      contributors: [],
    },
  ];

  const overallScore =
    row.composite != null && Number.isFinite(row.composite)
      ? row.composite
      : partial.composite ?? 0;
  const confidence =
    row.confidence != null && Number.isFinite(row.confidence)
      ? row.confidence
      : partial.confidence;
  // Always recompute letter grade from current partial-composite rules.
  // Persisted tier=U from the old confidence-floor path must not override a
  // calculable P/U/S composite on the product read path.
  const grade: Grade = partial.grade;

  return {
    characterId: row.characterId,
    seasonSlug: row.season?.slug ?? "",
    modelKey: opts?.modelKey ?? "character-score",
    modelVersion: opts?.modelVersion ?? 1,
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore,
    skillScore: overallScore,
    authenticityScore: 100,
    confidence,
    grade,
    overallState:
      partial.availableCount === 0
        ? "PROVISIONAL"
        : partial.availableCount < 4
          ? "PROVISIONAL"
          : "DEFINITIVE",
    provisionalReason:
      partial.availableCount === 0
        ? "NO_AVAILABLE_DIMENSIONS"
        : partial.availableCount < 4
          ? `PARTIAL_DIMENSIONS:${partial.explanation.unavailableKeys.join(",")}`
          : null,
    dimensions,
    calculatedAt: row.calculatedAt.toISOString(),
    inputFingerprint: `character-score:${row.id}`,
    redFlags: [],
    explanation: {
      scoringVersion: row.scoringVersion,
      characterScoreId: row.id,
      source: "character_score",
      composite: row.composite,
      experience: row.experience,
      performance: row.performance,
      utility: row.utility,
      survival: row.survival,
      partialComposite: partial.explanation,
      availabilityCoverage: partial.availabilityCoverage,
      effectiveWeights: partial.effectiveWeights,
      missingDimensionsExcluded:
        "Unavailable dimensions are excluded; remaining weights are renormalized.",
    },
  };
}
