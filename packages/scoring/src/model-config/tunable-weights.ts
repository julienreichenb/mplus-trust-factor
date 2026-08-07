/**
 * Admin-tunable relative weights for the global scoring model console.
 *
 * Formulas stay code-owned. Admins edit relative weights only; the engine
 * normalizes them when applying effective percentages.
 *
 * Defaults match current production P/U/S behaviour exactly.
 */

import type { ScoreModelConfigV1 } from "../types.js";
import {
  PERFORMANCE_PHASE2_WEIGHTS,
} from "../performance/phase2/constants.js";
import {
  PERFORMANCE_V2_MODEL_CONFIG,
  type PerformanceV2ModelConfig,
} from "../performance/v2/constants.js";
import {
  SURVIVAL_V2_MODEL_CONFIG,
  SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF,
  type SurvivalV2ModelConfig,
} from "../survival/v2/constants.js";
import {
  UTILITY_V2_DOMAIN_WEIGHTS,
  UTILITY_V2_MODEL_CONFIG,
  type UtilityV2ModelConfig,
} from "../utility/v2/constants.js";
import {
  EXPERIENCE_V3_COMPONENT_WEIGHTS,
  EXPERIENCE_V3_MODEL_CONFIG,
  type ExperienceV3ModelConfig,
} from "../experience/v3/constants.js";
import {
  createDefaultscoringDimensionConfigSet,
  scoring_DIMENSION_CONFIGS_SCHEMA_VERSION,
  type scoringDimensionConfigSet,
} from "./score-model-v2-mapping.js";
import { isRecord, ModelConfigValidationError } from "./validate.js";

export const TUNABLE_WEIGHTS_SCHEMA_VERSION = "tunable-weights.1" as const;

export interface TunableDimensionWeights {
  performance: number;
  survival: number;
  utility: number;
  experience: number;
}

export interface TunablePerformanceComponents {
  /** Phase 1 parse/profile score share when cooldown evidence exists. */
  phase1: number;
  /** Offensive cooldown discipline share. */
  cooldown: number;
  dungeonPeak: number;
  dungeonFloor: number;
  dungeonConsistency: number;
  profileBestAverage: number;
  profileMedianAverage: number;
}

export interface TunableSurvivalComponents {
  outcome: number;
  defensive: number;
  recovery: number;
}

export interface TunableUtilityComponents {
  castStops: number;
  support: number;
  strategicCc: number;
}

/** Experience Phase 1 product components (calculator wiring deferred). */
export interface TunableExperienceComponents {
  previousSeasonScore: number;
  historicalTitle: number;
  historicalRanking: number;
}

export interface TunableComponentWeights {
  performance: TunablePerformanceComponents;
  survival: TunableSurvivalComponents;
  utility: TunableUtilityComponents;
  experience: TunableExperienceComponents;
}

export interface TunableWeightsV1 {
  schemaVersion: typeof TUNABLE_WEIGHTS_SCHEMA_VERSION;
  dimensions: TunableDimensionWeights;
  components: TunableComponentWeights;
}

/** Relative defaults ≡ current production fractions (×100 where clean). */
export const DEFAULT_TUNABLE_WEIGHTS: TunableWeightsV1 = Object.freeze({
  schemaVersion: TUNABLE_WEIGHTS_SCHEMA_VERSION,
  dimensions: Object.freeze({
    performance: 35,
    survival: 30,
    utility: 25,
    experience: 10,
  }),
  components: Object.freeze({
    performance: Object.freeze({
      phase1: PERFORMANCE_PHASE2_WEIGHTS.phase1 * 100,
      cooldown: PERFORMANCE_PHASE2_WEIGHTS.cooldown * 100,
      dungeonPeak: PERFORMANCE_V2_MODEL_CONFIG.dungeonWeights.peak * 100,
      dungeonFloor: PERFORMANCE_V2_MODEL_CONFIG.dungeonWeights.floor * 100,
      dungeonConsistency: PERFORMANCE_V2_MODEL_CONFIG.dungeonWeights.consistency * 100,
      profileBestAverage: PERFORMANCE_V2_MODEL_CONFIG.profileWeights.bestAverage * 100,
      profileMedianAverage: PERFORMANCE_V2_MODEL_CONFIG.profileWeights.medianAverage * 100,
    }),
    survival: Object.freeze({
      outcome: SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF.outcome * 100,
      defensive: SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF.defensive * 100,
      recovery: SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF.recovery * 100,
    }),
    utility: Object.freeze({
      castStops: UTILITY_V2_DOMAIN_WEIGHTS.castStops * 100,
      support: UTILITY_V2_DOMAIN_WEIGHTS.support * 100,
      strategicCc: UTILITY_V2_DOMAIN_WEIGHTS.strategicCc * 100,
    }),
    experience: Object.freeze({
      // Match V3 ratios among the three Phase 1 product components (30/15/10).
      previousSeasonScore: EXPERIENCE_V3_COMPONENT_WEIGHTS.previousSeasonStrength * 100,
      historicalTitle: EXPERIENCE_V3_COMPONENT_WEIGHTS.eliteHistory * 100,
      historicalRanking: EXPERIENCE_V3_COMPONENT_WEIGHTS.historicalRank * 100,
    }),
  }),
}) as TunableWeightsV1;

export function createDefaultTunableWeights(): TunableWeightsV1 {
  return structuredClone(DEFAULT_TUNABLE_WEIGHTS);
}

/**
 * Normalize relative weights to fractions summing to 1.
 * Zero total → all zeros (caller should reject for required groups).
 * Zero individual weights are allowed (disables a component).
 */
export function normalizeRelativeWeights(
  weights: Readonly<Record<string, number>>,
): Record<string, number> {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (!(total > 0)) {
    return Object.fromEntries(entries.map(([k]) => [k, 0]));
  }
  return Object.fromEntries(entries.map(([k, v]) => [k, v / total]));
}

/** Effective percentage 0–100 for display (one decimal when needed). */
export function effectiveWeightPercent(
  relative: number,
  siblings: Readonly<Record<string, number>>,
): number {
  const total = Object.values(siblings).reduce((sum, v) => sum + v, 0);
  if (!(total > 0) || !(relative >= 0)) return 0;
  return (relative / total) * 100;
}

function requireNonNegativeFinite(
  value: unknown,
  path: string,
  errors: string[],
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number`);
    return null;
  }
  if (value < 0) {
    errors.push(`${path} must be >= 0 (negative weights are rejected)`);
    return null;
  }
  return value;
}

function requireGroup(
  raw: Record<string, unknown>,
  key: string,
  fields: readonly string[],
  errors: string[],
): Record<string, number> | null {
  const obj = raw[key];
  if (!isRecord(obj)) {
    errors.push(`${key} must be an object`);
    return null;
  }
  const out: Record<string, number> = {};
  let ok = true;
  for (const field of fields) {
    const n = requireNonNegativeFinite(obj[field], `${key}.${field}`, errors);
    if (n == null) {
      ok = false;
      continue;
    }
    out[field] = n;
  }
  for (const unknownKey of Object.keys(obj)) {
    if (!fields.includes(unknownKey)) {
      errors.push(`unknown field ${key}.${unknownKey}`);
      ok = false;
    }
  }
  return ok ? out : null;
}

function groupTotal(group: Record<string, number>): number {
  return Object.values(group).reduce((sum, value) => sum + value, 0);
}

export function validateTunableWeights(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return ["tunableWeights must be an object"];
  }
  if (raw.schemaVersion !== TUNABLE_WEIGHTS_SCHEMA_VERSION) {
    errors.push(
      `incompatible tunableWeights.schemaVersion "${String(raw.schemaVersion)}" (expected ${TUNABLE_WEIGHTS_SCHEMA_VERSION})`,
    );
  }
  if (!isRecord(raw.dimensions)) {
    errors.push("tunableWeights.dimensions must be an object");
  } else {
    const dims = requireGroup(
      raw,
      "dimensions",
      ["performance", "survival", "utility", "experience"],
      errors,
    );
    if (dims && !(groupTotal(dims) > 0)) {
      errors.push("dimension relative weights must sum to a positive total");
    }
  }
  if (!isRecord(raw.components)) {
    errors.push("tunableWeights.components must be an object");
  } else {
    const comps = raw.components;
    const perf = requireGroup(
      comps,
      "performance",
      [
        "phase1",
        "cooldown",
        "dungeonPeak",
        "dungeonFloor",
        "dungeonConsistency",
        "profileBestAverage",
        "profileMedianAverage",
      ],
      errors,
    );
    if (perf) {
      if (!((perf.phase1 ?? 0) + (perf.cooldown ?? 0) > 0)) {
        errors.push("performance phase1+cooldown relative weights must be positive in total");
      }
      if (
        !((perf.dungeonPeak ?? 0) + (perf.dungeonFloor ?? 0) + (perf.dungeonConsistency ?? 0) > 0)
      ) {
        errors.push("performance dungeon relative weights must be positive in total");
      }
      if (!((perf.profileBestAverage ?? 0) + (perf.profileMedianAverage ?? 0) > 0)) {
        errors.push("performance profile relative weights must be positive in total");
      }
    }
    const surv = requireGroup(comps, "survival", ["outcome", "defensive", "recovery"], errors);
    if (surv && !(groupTotal(surv) > 0)) {
      errors.push("survival relative weights must be positive in total");
    }
    const util = requireGroup(comps, "utility", ["castStops", "support", "strategicCc"], errors);
    if (util && !(groupTotal(util) > 0)) {
      errors.push("utility relative weights must be positive in total");
    }
    const exp = requireGroup(
      comps,
      "experience",
      ["previousSeasonScore", "historicalTitle", "historicalRanking"],
      errors,
    );
    if (exp && !(groupTotal(exp) > 0)) {
      errors.push("experience relative weights must be positive in total");
    }
  }
  return errors;
}

export function parseTunableWeights(raw: unknown): TunableWeightsV1 {
  const errors = validateTunableWeights(raw);
  if (errors.length > 0) {
    throw new ModelConfigValidationError("TUNABLE_WEIGHTS", errors);
  }
  const rec = raw as Record<string, unknown>;
  const dimensions = rec.dimensions as TunableDimensionWeights;
  const components = rec.components as TunableComponentWeights;
  return {
    schemaVersion: TUNABLE_WEIGHTS_SCHEMA_VERSION,
    dimensions: { ...dimensions },
    components: {
      performance: { ...components.performance },
      survival: { ...components.survival },
      utility: { ...components.utility },
      experience: { ...components.experience },
    },
  };
}

/**
 * Resolve tunable weights from a persisted ScoreModel.config.
 * Missing document → canonical production defaults (legacy-compatible).
 */
export function resolveTunableWeights(
  modelConfig: ScoreModelConfigV1 | Record<string, unknown> | null | undefined,
): { weights: TunableWeightsV1; fromPersistedDocument: boolean } {
  if (!modelConfig || typeof modelConfig !== "object") {
    return { weights: createDefaultTunableWeights(), fromPersistedDocument: false };
  }
  const raw = (modelConfig as Record<string, unknown>).tunableWeights;
  if (raw == null) {
    return { weights: createDefaultTunableWeights(), fromPersistedDocument: false };
  }
  return { weights: parseTunableWeights(raw), fromPersistedDocument: true };
}

export function applyTunableWeightsToPerformanceConfig(
  tunable: TunableWeightsV1,
  base: PerformanceV2ModelConfig = PERFORMANCE_V2_MODEL_CONFIG,
): PerformanceV2ModelConfig {
  const p = tunable.components.performance;
  const dungeon = normalizeRelativeWeights({
    peak: p.dungeonPeak,
    floor: p.dungeonFloor,
    consistency: p.dungeonConsistency,
  });
  const profile = normalizeRelativeWeights({
    bestAverage: p.profileBestAverage,
    medianAverage: p.profileMedianAverage,
  });
  return {
    ...structuredClone(base),
    dungeonWeights: {
      peak: dungeon.peak!,
      floor: dungeon.floor!,
      consistency: dungeon.consistency!,
    },
    profileWeights: {
      bestAverage: profile.bestAverage!,
      medianAverage: profile.medianAverage!,
    },
  };
}

export function resolvePerformancePhase2CombineWeights(
  tunable: TunableWeightsV1 = DEFAULT_TUNABLE_WEIGHTS,
): { phase1: number; cooldown: number } {
  const norm = normalizeRelativeWeights({
    phase1: tunable.components.performance.phase1,
    cooldown: tunable.components.performance.cooldown,
  });
  return { phase1: norm.phase1!, cooldown: norm.cooldown! };
}

export function applyTunableWeightsToSurvivalConfig(
  tunable: TunableWeightsV1,
  base: SurvivalV2ModelConfig = SURVIVAL_V2_MODEL_CONFIG,
): SurvivalV2ModelConfig {
  const s = tunable.components.survival;
  const shadow = normalizeRelativeWeights({
    outcome: s.outcome,
    defensive: s.defensive,
    recovery: s.recovery,
  });
  return {
    ...structuredClone(base),
    weightsShadowOrOff: {
      outcome: shadow.outcome!,
      defensive: shadow.defensive!,
      recovery: shadow.recovery!,
      relativeDamage: 0,
    },
  };
}

export function applyTunableWeightsToUtilityConfig(
  tunable: TunableWeightsV1,
  base: UtilityV2ModelConfig = UTILITY_V2_MODEL_CONFIG,
): UtilityV2ModelConfig {
  const u = tunable.components.utility;
  const domains = normalizeRelativeWeights({
    castStops: u.castStops,
    support: u.support,
    strategicCc: u.strategicCc,
  });
  return {
    ...structuredClone(base),
    domainWeights: {
      castStops: domains.castStops!,
      support: domains.support!,
      strategicCc: domains.strategicCc!,
    },
  };
}

/**
 * Map Experience Phase 1 product weights onto the V3 calculator config shape.
 * `currentExposure` keeps its package default share; the three admin weights
 * split the remaining mass (preserves V3 structure without inventing new knobs).
 */
export function applyTunableWeightsToExperienceConfig(
  tunable: TunableWeightsV1,
  base: ExperienceV3ModelConfig = EXPERIENCE_V3_MODEL_CONFIG,
): ExperienceV3ModelConfig {
  const e = tunable.components.experience;
  const amongThree = normalizeRelativeWeights({
    previousSeasonStrength: e.previousSeasonScore,
    eliteHistory: e.historicalTitle,
    historicalRank: e.historicalRanking,
  });
  const exposure = EXPERIENCE_V3_COMPONENT_WEIGHTS.currentExposure;
  const remainder = 1 - exposure;
  return {
    ...structuredClone(base),
    componentWeights: {
      currentExposure: exposure,
      previousSeasonStrength: amongThree.previousSeasonStrength! * remainder,
      eliteHistory: amongThree.eliteHistory! * remainder,
      historicalRank: amongThree.historicalRank! * remainder,
    },
  };
}

export function buildScoringDimensionConfigsFromTunable(
  tunable: TunableWeightsV1,
): scoringDimensionConfigSet {
  return {
    schemaVersion: scoring_DIMENSION_CONFIGS_SCHEMA_VERSION,
    performance: applyTunableWeightsToPerformanceConfig(tunable),
    survival: applyTunableWeightsToSurvivalConfig(tunable),
    utility: applyTunableWeightsToUtilityConfig(tunable),
    experience: applyTunableWeightsToExperienceConfig(tunable),
  };
}

/** Normalized Trust dimension weights (mythicRaid stays 0). */
export function trustDimensionWeightsFromTunable(tunable: TunableWeightsV1): {
  performance: number;
  survival: number;
  utility: number;
  experienceConsistency: number;
  mythicRaid: number;
} {
  const n = normalizeRelativeWeights({ ...tunable.dimensions });
  return {
    performance: n.performance!,
    survival: n.survival!,
    utility: n.utility!,
    experienceConsistency: n.experience!,
    mythicRaid: 0,
  };
}

/**
 * Attach tunableWeights + derived scoring configs onto a ScoreModel JSON document.
 * Syncs `weights` to normalized dimension fractions for legacy Trust aggregation.
 */
export function withTunableWeights(
  model: ScoreModelConfigV1,
  tunable: TunableWeightsV1 = createDefaultTunableWeights(),
): ScoreModelConfigV1 & {
  tunableWeights: TunableWeightsV1;
  scoring: scoringDimensionConfigSet;
} {
  const parsed = parseTunableWeights(tunable);
  return {
    ...structuredClone(model),
    weights: trustDimensionWeightsFromTunable(parsed),
    tunableWeights: parsed,
    scoring: buildScoringDimensionConfigsFromTunable(parsed),
  };
}

/** Ensure defaults document exists (idempotent for missing tunableWeights). */
export function ensureTunableWeightsOnModelConfig(
  model: ScoreModelConfigV1,
): ScoreModelConfigV1 & {
  tunableWeights: TunableWeightsV1;
  scoring: scoringDimensionConfigSet;
} {
  const resolved = resolveTunableWeights(model);
  if (resolved.fromPersistedDocument) {
    const scoring =
      isRecord(model as unknown as Record<string, unknown>) &&
      (model as unknown as Record<string, unknown>).scoring != null
        ? ((model as unknown as { scoring: scoringDimensionConfigSet }).scoring)
        : buildScoringDimensionConfigsFromTunable(resolved.weights);
    return {
      ...structuredClone(model),
      weights: trustDimensionWeightsFromTunable(resolved.weights),
      tunableWeights: resolved.weights,
      scoring,
    };
  }
  return withTunableWeights(model, createDefaultTunableWeights());
}

/** Package default scoring set (for equivalence assertions). */
export function canonicalDefaultScoringDimensionConfigs(): scoringDimensionConfigSet {
  return createDefaultscoringDimensionConfigSet();
}
