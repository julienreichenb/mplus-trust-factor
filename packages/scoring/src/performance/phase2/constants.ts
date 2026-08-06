/**
 * Functional Performance Phase 2 — technical calculator version stamps.
 *
 * Phase 1 parse/profile/difficulty internals remain under performance-v2.phase1.*;
 * the product-facing Performance algorithm is performance-phase2-v1.
 */

export const PERFORMANCE_PHASE2_ALGORITHM_VERSION =
  "performance-phase2-v1" as const;

export const PERFORMANCE_PHASE2_MODEL_LABEL = "phase2-v1" as const;

/** Phase 2 combine weights (must sum to 1 when both sources present). */
export const PERFORMANCE_PHASE2_WEIGHTS = Object.freeze({
  phase1: 0.8,
  cooldown: 0.2,
});

/** End-grace: min(30s, 25% of effective cooldown). */
export const PERFORMANCE_PHASE2_END_GRACE_MS_CAP = 30_000;
export const PERFORMANCE_PHASE2_END_GRACE_FRACTION = 0.25;
