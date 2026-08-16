/**
 * Public qualitative presentation of 0–100 component scores.
 * Display-only — not a scoring policy, band, or Trust dimension.
 */

export const QUALITATIVE_SCORE_LABELS = [
  "VERY GOOD",
  "GOOD",
  "BAD",
  "VERY BAD",
] as const;

export type QualitativeScoreLabel = (typeof QUALITATIVE_SCORE_LABELS)[number];

export const QUALITATIVE_SCORE_PRESENTATION_VERSION =
  "qualitative-score-presentation-v1" as const;

/**
 * Presentation cut-points on the existing 0–100 component scale.
 * Neutral point in explainability is 50; these cuts are display-only.
 */
export const QUALITATIVE_SCORE_CUTS = {
  veryGoodMin: 75,
  goodMin: 50,
  badMin: 25,
} as const;

export function presentQualitativeScoreLabel(
  value: number | null | undefined,
): QualitativeScoreLabel | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= QUALITATIVE_SCORE_CUTS.veryGoodMin) return "VERY GOOD";
  if (value >= QUALITATIVE_SCORE_CUTS.goodMin) return "GOOD";
  if (value >= QUALITATIVE_SCORE_CUTS.badMin) return "BAD";
  return "VERY BAD";
}
