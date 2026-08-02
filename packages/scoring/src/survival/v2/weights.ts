import {
  SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF,
  SURVIVAL_V2_WEIGHTS_WITH_RELATIVE,
  type SurvivalV2RelativeDamageMode,
} from "./constants.js";

export interface SurvivalV2WeightAvailability {
  outcome: boolean;
  defensive: boolean;
  recovery: boolean;
  /** True only when mode=active and relative component is scored/reliable. */
  relativeDamage: boolean;
}

export interface SurvivalV2AppliedWeights {
  outcome: number;
  defensive: number;
  recovery: number;
  relativeDamage: number;
}

/**
 * Resolve base weights then renormalize over available components.
 * Shadow/off: relative base weight is 0 (55/30/15).
 * Active: 50/25/15/10 when relative is available; otherwise renormalize without it.
 */
export function resolveSurvivalV2Weights(
  mode: SurvivalV2RelativeDamageMode,
  available: SurvivalV2WeightAvailability,
): SurvivalV2AppliedWeights {
  const base =
    mode === "active"
      ? SURVIVAL_V2_WEIGHTS_WITH_RELATIVE
      : SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF;

  const raw = {
    outcome: available.outcome ? base.outcome : 0,
    defensive: available.defensive ? base.defensive : 0,
    recovery: available.recovery ? base.recovery : 0,
    relativeDamage:
      mode === "active" && available.relativeDamage ? base.relativeDamage : 0,
  };

  const sum =
    raw.outcome + raw.defensive + raw.recovery + raw.relativeDamage;
  if (sum <= 0) {
    return { outcome: 1, defensive: 0, recovery: 0, relativeDamage: 0 };
  }
  return {
    outcome: raw.outcome / sum,
    defensive: raw.defensive / sum,
    recovery: raw.recovery / sum,
    relativeDamage: raw.relativeDamage / sum,
  };
}
