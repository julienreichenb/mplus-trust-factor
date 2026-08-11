/**
 * Role-aware Performance — product formula (Agent 04B).
 * Canonical parse = profile throughput Best/Median (Architecture A).
 * Detailed playerscore facts are score-neutral.
 */

export const PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION =
  "performance-role-aware-v1" as const;
export const PERFORMANCE_ROLE_AWARE_MODEL_LABEL = "role-aware-v1" as const;

/** Preserved from prior profile stabilizer — do not recalibrate. */
export const PARSE_CHANNEL_WEIGHTS = Object.freeze({
  bestAverage: 0.45,
  medianAverage: 0.55,
});

export const DPS_PERFORMANCE_WEIGHTS = Object.freeze({
  damageParse: 0.8,
  cooldown: 0.2,
});

export const HEALER_PERFORMANCE_WEIGHTS = Object.freeze({
  healingParse: 0.65,
  damageParse: 0.35,
});

/** Spec binding policy documented for diagnostics (WCL role/spec args are no-ops). */
export const PERFORMANCE_SPEC_BINDING_POLICY =
  "payload_observed_specs_vs_target_spec; query role/specName not trusted" as const;
