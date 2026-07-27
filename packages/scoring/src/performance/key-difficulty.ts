import { clamp01 } from "../math.js";

/**
 * Season-relative key difficulty for Performance v3.
 *
 * Primary path: piecewise interpolation across active-season regional key-level
 * anchors (or cutoff-calibrated anchors). Bounded fallback when cutoffs /
 * distribution are unavailable — documented, never a permanent hard ceiling.
 */

export type KeyDifficultyNormalizationSource =
  | "regional_distribution"
  | "season_cutoff_calibrated"
  | "bounded_fallback";

export interface KeyDifficultyAnchor {
  keyLevel: number;
  /** Season-relative difficulty percentile (0–100). */
  percentile: number;
}

/**
 * Documented bounded fallback for active-season key difficulty when regional
 * cutoffs / distribution are unavailable. Anchors are not a permanent ceiling;
 * Agent 27 may replace them with calibrated season tables.
 */
export const BOUNDED_KEY_DIFFICULTY_ANCHORS: readonly KeyDifficultyAnchor[] = [
  { keyLevel: 2, percentile: 5 },
  { keyLevel: 4, percentile: 15 },
  { keyLevel: 6, percentile: 28 },
  { keyLevel: 8, percentile: 40 },
  { keyLevel: 10, percentile: 52 },
  { keyLevel: 12, percentile: 65 },
  { keyLevel: 14, percentile: 76 },
  { keyLevel: 16, percentile: 85 },
  { keyLevel: 18, percentile: 92 },
  { keyLevel: 20, percentile: 96 },
  { keyLevel: 22, percentile: 98 },
  { keyLevel: 25, percentile: 99.5 },
] as const;

/** Soft cap used only by the bounded fallback (not a permanent product ceiling). */
export const BOUNDED_KEY_DIFFICULTY_SOFT_CAP = 25;

export interface SeasonKeyDifficultyContext {
  seasonSlug: string | null;
  region: string | null;
  /**
   * Optional regional key-level percentile anchors for the active season.
   * When present and valid (≥2 points), preferred over cutoffs/fallback.
   */
  regionalAnchors?: readonly KeyDifficultyAnchor[] | null;
  /**
   * Raider.IO (or equivalent) top-25% score cutoff for the active season/region.
   * Used only to calibrate soft difficulty bands — never as a parse percentile.
   */
  top25CutoffScore?: number | null;
  /**
   * Observed key levels from the active-season run pool (character or cohort).
   * Helps calibrate the soft ceiling when cutoffs exist but key distribution does not.
   */
  observedKeyLevels?: readonly number[] | null;
}

export interface KeyDifficultyResult {
  percentile: number | null;
  source: KeyDifficultyNormalizationSource;
  /** Lower when using bounded fallback or incomplete cutoff calibration. */
  confidence: number;
  anchorsUsed: KeyDifficultyAnchor[];
  reason: string | null;
}

function sortAnchors(anchors: readonly KeyDifficultyAnchor[]): KeyDifficultyAnchor[] {
  return [...anchors]
    .filter(
      (a) =>
        Number.isFinite(a.keyLevel) &&
        Number.isFinite(a.percentile) &&
        a.keyLevel >= 0 &&
        a.percentile >= 0 &&
        a.percentile <= 100,
    )
    .sort((a, b) => a.keyLevel - b.keyLevel);
}

/**
 * Piecewise-linear interpolation of key level → difficulty percentile.
 */
export function interpolateKeyDifficultyPercentile(
  keyLevel: number,
  anchors: readonly KeyDifficultyAnchor[],
): number | null {
  if (!Number.isFinite(keyLevel)) return null;
  const sorted = sortAnchors(anchors);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!.percentile;

  if (keyLevel <= sorted[0]!.keyLevel) return sorted[0]!.percentile;
  const last = sorted[sorted.length - 1]!;
  if (keyLevel >= last.keyLevel) return last.percentile;

  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i]!;
    const right = sorted[i + 1]!;
    if (keyLevel >= left.keyLevel && keyLevel <= right.keyLevel) {
      const span = right.keyLevel - left.keyLevel;
      if (span <= 0) return left.percentile;
      const t = (keyLevel - left.keyLevel) / span;
      return left.percentile + t * (right.percentile - left.percentile);
    }
  }
  return last.percentile;
}

function calibrateAnchorsFromCutoffs(input: {
  top25CutoffScore: number;
  observedKeyLevels: readonly number[];
}): KeyDifficultyAnchor[] {
  const observed = input.observedKeyLevels.filter((k) => Number.isFinite(k) && k > 0);
  const maxObserved = observed.length > 0 ? Math.max(...observed) : 16;
  // Soft ceiling: slightly above the highest observed push key, bounded.
  const softCeiling = Math.min(
    BOUNDED_KEY_DIFFICULTY_SOFT_CAP,
    Math.max(16, Math.ceil(maxObserved * 1.1)),
  );
  // Top-25% score implies the "challenging" band sits near p75 on the key curve.
  const challengingKey = Math.min(softCeiling, Math.max(10, Math.round(softCeiling * 0.75)));

  const base = BOUNDED_KEY_DIFFICULTY_ANCHORS.map((a) => ({ ...a }));
  // Stretch the upper half so challengingKey ≈ 75th percentile.
  return base.map((a) => {
    if (a.keyLevel <= 10) return a;
    if (a.keyLevel >= softCeiling) {
      return { keyLevel: softCeiling, percentile: 99 };
    }
    if (a.keyLevel === challengingKey || Math.abs(a.keyLevel - challengingKey) < 0.5) {
      return { keyLevel: a.keyLevel, percentile: 75 };
    }
    return a;
  });
}

/**
 * Normalize a selected-run key level to a season-relative difficulty percentile.
 * Missing key level → null (never zero-filled).
 */
export function computeKeyDifficultyPercentile(input: {
  keyLevel: number | null | undefined;
  timed?: boolean | null;
  context: SeasonKeyDifficultyContext;
}): KeyDifficultyResult {
  const keyLevel = input.keyLevel;
  if (keyLevel == null || !Number.isFinite(keyLevel)) {
    return {
      percentile: null,
      source: "bounded_fallback",
      confidence: 0,
      anchorsUsed: [],
      reason: "key_level_missing",
    };
  }

  const regional = sortAnchors(input.context.regionalAnchors ?? []);
  if (regional.length >= 2) {
    const percentile = interpolateKeyDifficultyPercentile(keyLevel, regional);
    return {
      percentile,
      source: "regional_distribution",
      confidence: percentile == null ? 0 : 0.9,
      anchorsUsed: regional,
      reason: null,
    };
  }

  const top25 = input.context.top25CutoffScore;
  if (top25 != null && Number.isFinite(top25) && top25 > 0) {
    const anchors = calibrateAnchorsFromCutoffs({
      top25CutoffScore: top25,
      observedKeyLevels: input.context.observedKeyLevels ?? [keyLevel],
    });
    const percentile = interpolateKeyDifficultyPercentile(keyLevel, anchors);
    // Timed state is context only — small confidence nudge, not a score replacement.
    const timedBoost = input.timed === true ? 0.02 : 0;
    return {
      percentile,
      source: "season_cutoff_calibrated",
      confidence: percentile == null ? 0 : clamp01(0.72 + timedBoost),
      anchorsUsed: sortAnchors(anchors),
      reason: null,
    };
  }

  const fallback = [...BOUNDED_KEY_DIFFICULTY_ANCHORS];
  const percentile = interpolateKeyDifficultyPercentile(keyLevel, fallback);
  return {
    percentile,
    source: "bounded_fallback",
    confidence: percentile == null ? 0 : 0.4,
    anchorsUsed: fallback,
    reason: "season_cutoffs_unavailable_bounded_fallback",
  };
}
