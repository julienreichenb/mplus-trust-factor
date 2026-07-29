/**
 * Experience V2 — accumulated Mythic+ exposure, independent of execution quality.
 *
 * Score 50 meaning: moderate current-season coverage — roughly half the active
 * dungeon pool completed across ~3 key bands (half of 6), with either recent
 * activity or prior-season public history. Not a population percentile.
 */

export const EXPERIENCE_V2_SCHEMA_VERSION = "experience-v2";
export const EXPERIENCE_V2_ANALYSIS_VERSION = "experience-v2.1";
export const EXPERIENCE_V2_MODEL_LABEL = "v2";

/** Meaningful key-level bands for breadth (not peak-key skill). */
export const EXPERIENCE_KEY_BANDS = [
  { id: "2-4", min: 2, max: 4 },
  { id: "5-7", min: 5, max: 7 },
  { id: "8-9", min: 8, max: 9 },
  { id: "10-11", min: 10, max: 11 },
  { id: "12-14", min: 12, max: 14 },
  { id: "15+", min: 15, max: 99 },
] as const;

/**
 * Denominator for key_band_breadth — equals the defined band count (6).
 * Formula: clamp01(bandsTouched / KEY_BAND_COUNT) * 100 (never exceeds 100).
 */
export const KEY_BAND_COUNT = EXPERIENCE_KEY_BANDS.length;

/** @deprecated Use KEY_BAND_COUNT — saturation equals the defined band set. */
export const KEY_BAND_SATURATION = KEY_BAND_COUNT;

/**
 * Raider.IO public profile prior-season depth when requesting
 * `mythic_plus_scores_by_season:current:previous` — at most one prior season.
 */
export const PRIOR_SEASON_RIO_DEPTH = 1;

/**
 * Max prior seasons credited when durable local history (snapshots/runs in
 * non-current seasons) is consolidated with the RIO previous signal.
 */
export const PRIOR_SEASON_LOCAL_CAP = 3;

/** Recency: full credit within this many days of last relevant run. */
export const RECENCY_FULL_DAYS = 14;
/** Recency: linear decay down to floor by this many days. */
export const RECENCY_DECAY_DAYS = 90;
/** Soft floor for stale-but-known history (never abrupt zero). */
export const RECENCY_FLOOR = 20;
/** Absolute floor after long inactivity. */
export const RECENCY_HARD_FLOOR = 12;

/**
 * Default Experience V2 metric weights (sum = 1.0).
 * Trust dimension weight remains experienceConsistency = 0.10.
 */
export const EXPERIENCE_V2_METRIC_WEIGHTS = [
  { metricKey: "experience.dungeon_breadth", weight: 0.3 },
  { metricKey: "experience.key_band_breadth", weight: 0.22 },
  { metricKey: "experience.participation_depth", weight: 0.2 },
  { metricKey: "experience.historical_seasons", weight: 0.18 },
  { metricKey: "experience.activity_recency", weight: 0.1 },
] as const;

export type ExperienceHistoryProvenance =
  | "CONFIRMED_ABSENCE"
  | "HAS_HISTORY"
  | "PARTIAL_SOURCES"
  | "PROVIDER_FAILURE";
