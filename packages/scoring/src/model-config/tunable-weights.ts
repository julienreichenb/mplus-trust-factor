/**
 * Admin-tunable relative weights for the global scoring model console.
 *
 * Formulas stay code-owned. Admins edit relative weights only; the engine
 * normalizes them when applying effective percentages.
 *
 * Schema: tunable-weights.2 (role-aware Performance).
 * V1 documents (tunable-weights.1) resolve in-memory without migration.
 */

import type { ScoreModelConfigV1 } from "../types.js";
import {
  DPS_PERFORMANCE_WEIGHTS,
  HEALER_PERFORMANCE_WEIGHTS,
  PARSE_CHANNEL_WEIGHTS,
} from "../performance/role-aware/constants.js";
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
  UTILITY_V2_FAMILY_WEIGHTS,
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

export const TUNABLE_WEIGHTS_SCHEMA_VERSION = "tunable-weights.2" as const;
export const TUNABLE_WEIGHTS_LEGACY_SCHEMA_VERSION = "tunable-weights.1" as const;

export interface TunableDimensionWeights {
  performance: number;
  survival: number;
  utility: number;
  experience: number;
}

/** Shared Best/Median parse channel weights (all roles). */
export interface TunablePerformanceParseComponents {
  bestAverage: number;
  medianAverage: number;
}

export interface TunablePerformanceDpsComponents {
  damageParse: number;
  cooldown: number;
}

/** Sole applicable tank signal — always 100% effective when present. */
export interface TunablePerformanceTankComponents {
  damageParse: number;
}

export interface TunablePerformanceHealerComponents {
  healingParse: number;
  damageParse: number;
}

export interface TunablePerformanceRoleComponents {
  dps: TunablePerformanceDpsComponents;
  tank: TunablePerformanceTankComponents;
  healer: TunablePerformanceHealerComponents;
}

export interface TunablePerformanceComponents {
  parse: TunablePerformanceParseComponents;
  roles: TunablePerformanceRoleComponents;
}

export interface TunableSurvivalComponents {
  outcome: number;
  defensive: number;
  recovery: number;
}

export interface TunableUtilityComponents {
  interrupt: number;
  crowdControl: number;
  dispelPurge: number;
  groupSupport: number;
  movement: number;
  combatRes: number;
  bloodlust: number;
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

export interface TunableWeights {
  schemaVersion: typeof TUNABLE_WEIGHTS_SCHEMA_VERSION;
  dimensions: TunableDimensionWeights;
  components: TunableComponentWeights;
}

/** @deprecated Prefer TunableWeights — alias kept for gradual call-site migration. */
export type TunableWeightsV1 = TunableWeights;

/** Effective normalized fractions consumed by role-aware Performance. */
export interface PerformanceRoleAwareWeights {
  parse: { bestAverage: number; medianAverage: number };
  dps: { damageParse: number; cooldown: number };
  tank: { damageParse: number };
  healer: { healingParse: number; damageParse: number };
}

export const DEFAULT_ROLE_AWARE_PERFORMANCE_WEIGHTS: PerformanceRoleAwareWeights =
  Object.freeze({
    parse: Object.freeze({ ...PARSE_CHANNEL_WEIGHTS }),
    dps: Object.freeze({ ...DPS_PERFORMANCE_WEIGHTS }),
    tank: Object.freeze({ damageParse: 1 }),
    healer: Object.freeze({ ...HEALER_PERFORMANCE_WEIGHTS }),
  });

/** Relative defaults ≡ current production fractions (×100 where clean). */
export const DEFAULT_TUNABLE_WEIGHTS: TunableWeights = Object.freeze({
  schemaVersion: TUNABLE_WEIGHTS_SCHEMA_VERSION,
  dimensions: Object.freeze({
    performance: 35,
    survival: 30,
    utility: 25,
    experience: 10,
  }),
  components: Object.freeze({
    performance: Object.freeze({
      parse: Object.freeze({
        bestAverage: PARSE_CHANNEL_WEIGHTS.bestAverage * 100,
        medianAverage: PARSE_CHANNEL_WEIGHTS.medianAverage * 100,
      }),
      roles: Object.freeze({
        dps: Object.freeze({
          damageParse: DPS_PERFORMANCE_WEIGHTS.damageParse * 100,
          cooldown: DPS_PERFORMANCE_WEIGHTS.cooldown * 100,
        }),
        tank: Object.freeze({
          damageParse: 100,
        }),
        healer: Object.freeze({
          healingParse: HEALER_PERFORMANCE_WEIGHTS.healingParse * 100,
          damageParse: HEALER_PERFORMANCE_WEIGHTS.damageParse * 100,
        }),
      }),
    }),
    survival: Object.freeze({
      outcome: SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF.outcome * 100,
      defensive: SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF.defensive * 100,
      recovery: SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF.recovery * 100,
    }),
    utility: Object.freeze({
      interrupt: UTILITY_V2_FAMILY_WEIGHTS.interrupt * 100,
      crowdControl: UTILITY_V2_FAMILY_WEIGHTS.crowdControl * 100,
      dispelPurge: UTILITY_V2_FAMILY_WEIGHTS.dispelPurge * 100,
      groupSupport: UTILITY_V2_FAMILY_WEIGHTS.groupSupport * 100,
      movement: UTILITY_V2_FAMILY_WEIGHTS.movement * 100,
      combatRes: UTILITY_V2_FAMILY_WEIGHTS.combatRes * 100,
      bloodlust: UTILITY_V2_FAMILY_WEIGHTS.bloodlust * 100,
    }),
    experience: Object.freeze({
      previousSeasonScore: EXPERIENCE_V3_COMPONENT_WEIGHTS.previousSeasonStrength * 100,
      historicalTitle: EXPERIENCE_V3_COMPONENT_WEIGHTS.eliteHistory * 100,
      historicalRanking: EXPERIENCE_V3_COMPONENT_WEIGHTS.historicalRank * 100,
    }),
  }),
}) as TunableWeights;

export function createDefaultTunableWeights(): TunableWeights {
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

const UTILITY_FAMILY_TUNABLE_KEYS = [
  "interrupt",
  "crowdControl",
  "dispelPurge",
  "groupSupport",
  "movement",
  "combatRes",
  "bloodlust",
] as const;

function expandLegacyUtilityTunable(u: {
  castStops: number;
  support: number;
  strategicCc: number;
}): TunableUtilityComponents {
  return {
    interrupt: u.castStops,
    crowdControl: u.strategicCc,
    dispelPurge: u.support * 0.4,
    groupSupport: u.support * 0.4,
    movement: u.support * 0.12,
    combatRes: u.support * 0.04,
    bloodlust: u.support * 0.04,
  };
}

function parseUtilityTunableGroup(
  comps: Record<string, unknown>,
  errors: string[],
): TunableUtilityComponents | null {
  const obj = comps.utility;
  if (!isRecord(obj)) {
    errors.push("utility must be an object");
    return null;
  }
  if ("interrupt" in obj) {
    const parsed = requireGroup(comps, "utility", UTILITY_FAMILY_TUNABLE_KEYS, errors);
    if (!parsed) return null;
    return parsed as unknown as TunableUtilityComponents;
  }
  if ("castStops" in obj) {
    const parsed = requireGroup(
      comps,
      "utility",
      ["castStops", "support", "strategicCc"],
      errors,
    );
    if (!parsed) return null;
    return expandLegacyUtilityTunable({
      castStops: parsed.castStops!,
      support: parsed.support!,
      strategicCc: parsed.strategicCc!,
    });
  }
  errors.push("utility must include family weights or legacy castStops/support/strategicCc");
  return null;
}

function groupTotal(group: Record<string, number>): number {
  return Object.values(group).reduce((sum, value) => sum + value, 0);
}

/**
 * Convert legacy flat Performance components (tunable-weights.1) → role-aware V2.
 */
export function convertLegacyPerformanceComponentsToV2(
  legacy: Record<string, unknown>,
): TunablePerformanceComponents {
  const phase1 =
    typeof legacy.phase1 === "number" && Number.isFinite(legacy.phase1)
      ? legacy.phase1
      : DPS_PERFORMANCE_WEIGHTS.damageParse * 100;
  const cooldown =
    typeof legacy.cooldown === "number" && Number.isFinite(legacy.cooldown)
      ? legacy.cooldown
      : DPS_PERFORMANCE_WEIGHTS.cooldown * 100;
  const best =
    typeof legacy.profileBestAverage === "number" &&
    Number.isFinite(legacy.profileBestAverage)
      ? legacy.profileBestAverage
      : PARSE_CHANNEL_WEIGHTS.bestAverage * 100;
  const median =
    typeof legacy.profileMedianAverage === "number" &&
    Number.isFinite(legacy.profileMedianAverage)
      ? legacy.profileMedianAverage
      : PARSE_CHANNEL_WEIGHTS.medianAverage * 100;

  return {
    parse: {
      bestAverage: best,
      medianAverage: median,
    },
    roles: {
      dps: {
        damageParse: phase1,
        cooldown,
      },
      tank: {
        damageParse: 100,
      },
      healer: {
        healingParse: HEALER_PERFORMANCE_WEIGHTS.healingParse * 100,
        damageParse: HEALER_PERFORMANCE_WEIGHTS.damageParse * 100,
      },
    },
  };
}

function isLegacyPerformanceShape(raw: unknown): boolean {
  return (
    isRecord(raw) &&
    typeof raw.phase1 === "number" &&
    typeof raw.cooldown === "number" &&
    !isRecord(raw.parse) &&
    !isRecord(raw.roles)
  );
}

function isRoleAwarePerformanceShape(raw: unknown): boolean {
  return isRecord(raw) && isRecord(raw.parse) && isRecord(raw.roles);
}

export function validateTunableWeights(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return ["tunableWeights must be an object"];
  }
  const version = raw.schemaVersion;
  if (
    version !== TUNABLE_WEIGHTS_SCHEMA_VERSION &&
    version !== TUNABLE_WEIGHTS_LEGACY_SCHEMA_VERSION
  ) {
    errors.push(
      `incompatible tunableWeights.schemaVersion "${String(version)}" (expected ${TUNABLE_WEIGHTS_SCHEMA_VERSION} or ${TUNABLE_WEIGHTS_LEGACY_SCHEMA_VERSION})`,
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
    if (!isRecord(comps.performance)) {
      errors.push("components.performance must be an object");
    } else if (isLegacyPerformanceShape(comps.performance)) {
      // V1 flat shape — validate legacy groups then convert later.
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
          errors.push(
            "performance phase1+cooldown relative weights must be positive in total",
          );
        }
        if (
          !(
            (perf.profileBestAverage ?? 0) + (perf.profileMedianAverage ?? 0) >
            0
          )
        ) {
          errors.push(
            "performance profile relative weights must be positive in total",
          );
        }
      }
    } else if (isRoleAwarePerformanceShape(comps.performance)) {
      const perf = comps.performance;
      const parse = requireGroup(
        perf,
        "parse",
        ["bestAverage", "medianAverage"],
        errors,
      );
      if (parse && !(groupTotal(parse) > 0)) {
        errors.push("performance parse relative weights must be positive in total");
      }
      if (!isRecord(perf.roles)) {
        errors.push("components.performance.roles must be an object");
      } else {
        const dps = requireGroup(
          perf.roles,
          "dps",
          ["damageParse", "cooldown"],
          errors,
        );
        if (dps && !(groupTotal(dps) > 0)) {
          errors.push(
            "performance DPS relative weights must be positive in total",
          );
        }
        const tank = requireGroup(perf.roles, "tank", ["damageParse"], errors);
        // Tank is a single-component group — any non-negative finite value is fine;
        // effective weight is always 100%. Do not require damageParse > 0 specially
        // beyond finite >= 0 (already enforced).
        void tank;
        const healer = requireGroup(
          perf.roles,
          "healer",
          ["healingParse", "damageParse"],
          errors,
        );
        if (healer && !(groupTotal(healer) > 0)) {
          errors.push(
            "performance healer relative weights must be positive in total",
          );
        }
      }
    } else {
      errors.push(
        "components.performance must be role-aware (parse/roles) or legacy V1 flat shape",
      );
    }

    const surv = requireGroup(comps, "survival", ["outcome", "defensive", "recovery"], errors);
    if (surv && !(groupTotal(surv) > 0)) {
      errors.push("survival relative weights must be positive in total");
    }
    const util = parseUtilityTunableGroup(comps, errors);
    if (util && !(groupTotal({ ...util }) > 0)) {
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

function normalizeToCanonicalTunable(raw: Record<string, unknown>): TunableWeights {
  const dimensions = raw.dimensions as TunableDimensionWeights;
  const components = raw.components as Record<string, unknown>;
  const performanceRaw = components.performance;
  const performance = isLegacyPerformanceShape(performanceRaw)
    ? convertLegacyPerformanceComponentsToV2(performanceRaw as Record<string, unknown>)
    : (performanceRaw as TunablePerformanceComponents);

  return {
    schemaVersion: TUNABLE_WEIGHTS_SCHEMA_VERSION,
    dimensions: { ...dimensions },
    components: {
      performance: {
        parse: { ...performance.parse },
        roles: {
          dps: { ...performance.roles.dps },
          tank: { ...performance.roles.tank },
          healer: { ...performance.roles.healer },
        },
      },
      survival: { ...(components.survival as TunableSurvivalComponents) },
      utility: parseUtilityTunableGroup(components, []) ?? {
        ...(components.utility as TunableUtilityComponents),
      },
      experience: { ...(components.experience as TunableExperienceComponents) },
    },
  };
}

export function parseTunableWeights(raw: unknown): TunableWeights {
  const errors = validateTunableWeights(raw);
  if (errors.length > 0) {
    throw new ModelConfigValidationError("TUNABLE_WEIGHTS", errors);
  }
  return normalizeToCanonicalTunable(raw as Record<string, unknown>);
}

/**
 * Resolve tunable weights from a persisted ScoreModel.config.
 * Missing document → canonical production defaults (legacy-compatible).
 * V1 documents convert in-memory to V2 (no DB migration).
 */
export function resolveTunableWeights(
  modelConfig: ScoreModelConfigV1 | Record<string, unknown> | null | undefined,
): { weights: TunableWeights; fromPersistedDocument: boolean } {
  if (!modelConfig || typeof modelConfig !== "object") {
    return { weights: createDefaultTunableWeights(), fromPersistedDocument: false };
  }
  const raw = (modelConfig as Record<string, unknown>).tunableWeights;
  if (raw == null) {
    return { weights: createDefaultTunableWeights(), fromPersistedDocument: false };
  }
  return { weights: parseTunableWeights(raw), fromPersistedDocument: true };
}

/**
 * Normalize admin relative weights into fractions for the role-aware calculator.
 */
export function resolveRoleAwarePerformanceWeights(
  tunable: TunableWeights = DEFAULT_TUNABLE_WEIGHTS,
): PerformanceRoleAwareWeights {
  const p = tunable.components.performance;
  const parse = normalizeRelativeWeights({
    bestAverage: p.parse.bestAverage,
    medianAverage: p.parse.medianAverage,
  });
  const dps = normalizeRelativeWeights({
    damageParse: p.roles.dps.damageParse,
    cooldown: p.roles.dps.cooldown,
  });
  const healer = normalizeRelativeWeights({
    healingParse: p.roles.healer.healingParse,
    damageParse: p.roles.healer.damageParse,
  });
  return {
    parse: {
      bestAverage: parse.bestAverage!,
      medianAverage: parse.medianAverage!,
    },
    dps: {
      damageParse: dps.damageParse!,
      cooldown: dps.cooldown!,
    },
    tank: { damageParse: 1 },
    healer: {
      healingParse: healer.healingParse!,
      damageParse: healer.damageParse!,
    },
  };
}

export function applyTunableWeightsToPerformanceConfig(
  tunable: TunableWeights,
  base: PerformanceV2ModelConfig = PERFORMANCE_V2_MODEL_CONFIG,
): PerformanceV2ModelConfig {
  // Role-aware product path ignores dungeon Peak/Floor/Consistency.
  // Keep package dungeon defaults for forensic V2 calibration replay only.
  const profile = normalizeRelativeWeights({
    bestAverage: tunable.components.performance.parse.bestAverage,
    medianAverage: tunable.components.performance.parse.medianAverage,
  });
  return {
    ...structuredClone(base),
    dungeonWeights: { ...PERFORMANCE_V2_MODEL_CONFIG.dungeonWeights },
    profileWeights: {
      bestAverage: profile.bestAverage!,
      medianAverage: profile.medianAverage!,
    },
  };
}

/** Legacy Phase2 combine helper — maps DPS role weights to phase1/cooldown aliases. */
export function resolvePerformancePhase2CombineWeights(
  tunable: TunableWeights = DEFAULT_TUNABLE_WEIGHTS,
): { phase1: number; cooldown: number } {
  const roleAware = resolveRoleAwarePerformanceWeights(tunable);
  return {
    phase1: roleAware.dps.damageParse,
    cooldown: roleAware.dps.cooldown,
  };
}

export function applyTunableWeightsToSurvivalConfig(
  tunable: TunableWeights,
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

/**
 * Live/admin Utility tunables overlay family weights only.
 * Curves, interrupt credits, scoreFloor, and remaining model fields are
 * consumed by DRAFT/calibration replay via scoringDimensionConfigs.utility.
 */
export function applyTunableWeightsToUtilityConfig(
  tunable: TunableWeights,
  base: UtilityV2ModelConfig = UTILITY_V2_MODEL_CONFIG,
): UtilityV2ModelConfig {
  const u = tunable.components.utility;
  const families = normalizeRelativeWeights({
    interrupt: u.interrupt,
    crowdControl: u.crowdControl,
    dispelPurge: u.dispelPurge,
    groupSupport: u.groupSupport,
    movement: u.movement,
    combatRes: u.combatRes,
    bloodlust: u.bloodlust,
  });
  const familyWeights = {
    interrupt: families.interrupt!,
    crowdControl: families.crowdControl!,
    dispelPurge: families.dispelPurge!,
    groupSupport: families.groupSupport!,
    movement: families.movement!,
    combatRes: families.combatRes!,
    bloodlust: families.bloodlust!,
  };
  return {
    ...structuredClone(base),
    familyWeights,
    domainWeights: familyWeights,
  };
}

/**
 * Map Experience Phase 1 product weights onto the V3 calculator config shape.
 * `currentExposure` keeps its package default share; the three admin weights
 * split the remaining mass (preserves V3 structure without inventing new knobs).
 */
export function applyTunableWeightsToExperienceConfig(
  tunable: TunableWeights,
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
  tunable: TunableWeights,
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
export function trustDimensionWeightsFromTunable(tunable: TunableWeights): {
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
 * Persists canonical V2 schema (converts V1 input if needed).
 */
export function withTunableWeights(
  model: ScoreModelConfigV1,
  tunable: TunableWeights = createDefaultTunableWeights(),
): ScoreModelConfigV1 & {
  tunableWeights: TunableWeights;
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
  tunableWeights: TunableWeights;
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
