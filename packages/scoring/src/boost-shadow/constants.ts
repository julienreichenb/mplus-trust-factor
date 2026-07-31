/**
 * Boost shadow Phase 1 — frozen evaluation constants (hypothesis ranges).
 * Not product thresholds. Never wired into production authenticity.
 */

export const BOOST_FEATURE_SCHEMA_VERSION = 1 as const;
export const BOOST_EXTRACTOR_VERSION = "boost-shadow-v1.0.0";
export const HIGH_KEY_POLICY_VERSION = "high-key-v1-eval";

/** Hypothesis: keys within subject season-best minus this distance are high-key candidates. */
export const HIGH_KEY_SUBJECT_RELATIVE_DISTANCE = 3;
/** Hypothesis: top-N by key level then score after relative filter. */
export const HIGH_KEY_TOP_N = 20;
/** Hypothesis: minimum eligible high-key runs for gap / cohort / concentration. */
export const MIN_USABLE_HIGH_KEY_RUNS = 3;

/** Hypothesis: progression window length (days) for velocity delta/time. */
export const PROGRESSION_WINDOW_DAYS = 14;
/** Hypothesis: minimum dated runs before computing velocity. */
export const VELOCITY_BASELINE_MIN_RUNS = 2;
/** Hypothesis: minimum dated-run coverage ratio. */
export const MIN_DATED_RUN_COVERAGE = 0.5;

/** Hypothesis: score-gap onset / saturation (rating points). */
export const SCORE_GAP_ONSET = 200;
export const SCORE_GAP_SATURATION = 1000;

/** Hypothesis: strong teammate gap onset for cohort classification. */
export const STRONG_TEAMMATE_GAP_ONSET = 200;
/** Hypothesis: min shared high keys with a strong teammate. */
export const COHORT_MIN_SHARED_HIGH_KEYS = 2;
/** Hypothesis: top-N recurrent strong teammates. */
export const COHORT_TOP_N = 3;
/** Hypothesis: cohort saturation as fraction of eligible high keys. */
export const COHORT_SATURATION_FRACTION = 0.5;

/** Hypothesis: min overlapping members for a roster core. */
export const CONCENTRATION_MIN_OVERLAP_MEMBERS = 2;
/** Hypothesis: core size upper bound when scoring concentration. */
export const CONCENTRATION_CORE_MAX = 4;

/** Hypothesis: verified-alt mythic rating freshness window (days). */
export const VERIFIED_ALT_FRESHNESS_DAYS = 14;
/** Hypothesis: mitigation margin onset / saturation (rating points). */
export const VERIFIED_ALT_MARGIN_ONSET = 0;
export const VERIFIED_ALT_MARGIN_SATURATION = 800;
