/**
 * Map persisted CharacterScore → ScoreSnapshotDTO for API reads when
 * publication is off / ScoreSnapshot rows are absent.
 */
import type { DimensionScoreDTO, Grade, ScoreSnapshotDTO } from "@mplus/contracts";

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
  calculatedAt: Date;
  dimensionDetails: unknown;
  season?: { slug: string } | null;
};

function dimState(score: number | null, reason: string | null): DimensionScoreDTO["state"] {
  if (reason) return "UNAVAILABLE";
  if (score == null || !Number.isFinite(score)) return "UNAVAILABLE";
  return "AVAILABLE";
}

function gradeFromScore(score: number | null, confidence: number | null): Grade {
  if (score == null || (confidence ?? 0) < 0.35) return "U";
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
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
  opts?: { modelKey?: string; modelVersion?: number },
): ScoreSnapshotDTO {
  const details =
    row.dimensionDetails && typeof row.dimensionDetails === "object"
      ? (row.dimensionDetails as Record<string, unknown>)
      : null;

  const perfReason = blockedReason(details, "PERFORMANCE");
  const utilReason = blockedReason(details, "UTILITY");
  const survReason = blockedReason(details, "SURVIVAL");

  const dimensions: DimensionScoreDTO[] = [
    {
      dimension: "PERFORMANCE",
      score: row.performance,
      confidence: row.performance != null ? (row.confidence ?? 0.5) : 0,
      weight: 0.35,
      state: dimState(row.performance, perfReason),
      reason: perfReason,
      contributors: [],
    },
    {
      dimension: "UTILITY",
      score: row.utility,
      confidence: row.utility != null ? (row.confidence ?? 0.5) : 0,
      weight: 0.25,
      state: dimState(row.utility, utilReason),
      reason: utilReason,
      contributors: [],
    },
    {
      dimension: "SURVIVAL",
      score: row.survival,
      confidence: row.survival != null ? (row.confidence ?? 0.5) : 0,
      weight: 0.25,
      state: dimState(row.survival, survReason),
      reason: survReason,
      contributors: [],
    },
    {
      dimension: "EXPERIENCE",
      score: row.experience,
      confidence: 0,
      weight: 0.15,
      state: "UNAVAILABLE",
      reason: "EXPERIENCE_NOT_YET_WIRED",
      contributors: [],
    },
  ];

  const usable = [row.performance, row.utility, row.survival].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  const overallScore =
    row.composite != null && Number.isFinite(row.composite)
      ? row.composite
      : usable.length > 0
        ? usable.reduce((a, b) => a + b, 0) / usable.length
        : 0;

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
    confidence: row.confidence ?? 0,
    grade: gradeFromScore(usable.length > 0 ? overallScore : null, row.confidence),
    overallState: usable.length < 3 ? "PROVISIONAL" : "DEFINITIVE",
    provisionalReason:
      usable.length < 3 ? "PARTIAL_DIMENSIONS_OR_UNPUBLISHED_CHARACTER_SCORE" : null,
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
    },
  };
}
