/**
 * Scoring V2 fact-extractor identity stamps (provider/worker layer).
 * Calculator packages remain provider-free; these labels identify persisted RunFactSets.
 */

export const PERFORMANCE_V2_EXTRACTOR_FAMILY = "performance" as const;
export const PERFORMANCE_V2_EXTRACTOR_VERSION = "performance-facts-v2.0.0" as const;
export const PERFORMANCE_V2_FACT_SCHEMA_VERSION = "performance-facts-v2.0.0" as const;

export const SURVIVAL_V2_FACT_EXTRACTOR_VERSION = "survival-facts-v2.0.0" as const;

/** Bounded danger windows persisted on Survival fact documents. */
export const SURVIVAL_V2_MAX_DANGER_WINDOWS = 64;

/** Bounded limitation strings per fact document. */
export const FACT_V2_MAX_LIMITATIONS = 32;
