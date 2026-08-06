/**
 * Performance Phase 2 V1 expected-uses rule.
 */

import {
  PERFORMANCE_PHASE2_END_GRACE_FRACTION,
  PERFORMANCE_PHASE2_END_GRACE_MS_CAP,
} from "./constants.js";

/**
 * endGraceMs = min(30_000, effectiveCooldownMs * 0.25)
 * expectedUses = 1 + floor(max(0, activeCombatDurationMs - endGraceMs) / effectiveCooldownMs)
 *
 * When the catalogue explicitly defines charges > 1, the initial available pool
 * is `charges` instead of 1 (explicit charge field only — no invented mechanics).
 */
export function computeEndGraceMs(effectiveCooldownMs: number): number {
  if (!(effectiveCooldownMs > 0) || !Number.isFinite(effectiveCooldownMs)) {
    throw new Error("invalid_effective_cooldown_ms");
  }
  return Math.min(
    PERFORMANCE_PHASE2_END_GRACE_MS_CAP,
    effectiveCooldownMs * PERFORMANCE_PHASE2_END_GRACE_FRACTION,
  );
}

export function computeExpectedUses(input: {
  activeCombatDurationMs: number;
  effectiveCooldownMs: number;
  /** Explicit catalogue charges; omit or ≤1 → initial pool of 1. */
  charges?: number | null;
}): number {
  const { activeCombatDurationMs, effectiveCooldownMs } = input;
  if (!(activeCombatDurationMs > 0) || !Number.isFinite(activeCombatDurationMs)) {
    throw new Error("invalid_active_combat_duration_ms");
  }
  if (!(effectiveCooldownMs > 0) || !Number.isFinite(effectiveCooldownMs)) {
    throw new Error("invalid_effective_cooldown_ms");
  }

  const initialPool =
    input.charges != null &&
    Number.isFinite(input.charges) &&
    input.charges > 1
      ? Math.floor(input.charges)
      : 1;

  const endGraceMs = computeEndGraceMs(effectiveCooldownMs);
  return (
    initialPool +
    Math.floor(
      Math.max(0, activeCombatDurationMs - endGraceMs) / effectiveCooldownMs,
    )
  );
}

/** usageRatio capped at 1; score = ratio × 100 (full internal precision). */
export function usageRatioToScore(
  observedActivationCount: number,
  expectedUses: number,
): number {
  if (!(expectedUses > 0) || !Number.isFinite(expectedUses)) {
    throw new Error("invalid_expected_uses");
  }
  if (
    !(observedActivationCount >= 0) ||
    !Number.isFinite(observedActivationCount)
  ) {
    throw new Error("invalid_observed_activation_count");
  }
  const usageRatio = Math.min(1, observedActivationCount / expectedUses);
  return usageRatio * 100;
}
