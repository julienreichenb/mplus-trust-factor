/**
 * Client-side Survival active-healing calibration (mirrors @mplus/scoring defaults).
 * Spell/spec eligibility is catalog-owned and is not edited here.
 */

export interface SurvivalActiveHealingCurveKnot {
  effectiveHealPctMaxHp: number;
  credit: number;
}

export interface SurvivalActiveHealingConfig {
  enabled: boolean;
  minEffectiveHealPctMaxHp: number;
  selfWeight: number;
  allyWeight: number;
  eventCreditCurve: SurvivalActiveHealingCurveKnot[];
  diminishingExponent: number;
  maxSurvivalBonusPoints: number;
}

export const DEFAULT_SURVIVAL_ACTIVE_HEALING: SurvivalActiveHealingConfig = {
  enabled: true,
  minEffectiveHealPctMaxHp: 0.08,
  selfWeight: 1,
  allyWeight: 1.15,
  eventCreditCurve: [
    { effectiveHealPctMaxHp: 0.08, credit: 0.25 },
    { effectiveHealPctMaxHp: 0.15, credit: 0.5 },
    { effectiveHealPctMaxHp: 0.25, credit: 0.85 },
    { effectiveHealPctMaxHp: 0.4, credit: 1.15 },
    { effectiveHealPctMaxHp: 1, credit: 1.5 },
  ],
  diminishingExponent: 0.75,
  maxSurvivalBonusPoints: 18,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export function createDefaultSurvivalActiveHealing(): SurvivalActiveHealingConfig {
  return JSON.parse(JSON.stringify(DEFAULT_SURVIVAL_ACTIVE_HEALING)) as SurvivalActiveHealingConfig;
}

export function resolveSurvivalActiveHealingFromConfig(
  config: unknown,
): SurvivalActiveHealingConfig {
  const defaults = createDefaultSurvivalActiveHealing();
  if (!isRecord(config)) return defaults;
  const scoring = config.scoring;
  const fromScoring =
    isRecord(scoring) && isRecord(scoring.survival) ? scoring.survival.activeHealing : undefined;
  const raw = config.survivalActiveHealing ?? fromScoring;
  if (!isRecord(raw)) return defaults;
  const curve = Array.isArray(raw.eventCreditCurve)
    ? raw.eventCreditCurve
        .filter(isRecord)
        .map((row) => ({
          effectiveHealPctMaxHp:
            typeof row.effectiveHealPctMaxHp === "number" ? row.effectiveHealPctMaxHp : 0,
          credit: typeof row.credit === "number" ? row.credit : 0,
        }))
    : defaults.eventCreditCurve;
  return {
    enabled: raw.enabled !== false,
    minEffectiveHealPctMaxHp:
      typeof raw.minEffectiveHealPctMaxHp === "number"
        ? raw.minEffectiveHealPctMaxHp
        : defaults.minEffectiveHealPctMaxHp,
    selfWeight: typeof raw.selfWeight === "number" ? raw.selfWeight : defaults.selfWeight,
    allyWeight: typeof raw.allyWeight === "number" ? raw.allyWeight : defaults.allyWeight,
    eventCreditCurve: curve.length >= 2 ? curve : defaults.eventCreditCurve,
    diminishingExponent:
      typeof raw.diminishingExponent === "number"
        ? raw.diminishingExponent
        : defaults.diminishingExponent,
    maxSurvivalBonusPoints:
      typeof raw.maxSurvivalBonusPoints === "number"
        ? raw.maxSurvivalBonusPoints
        : defaults.maxSurvivalBonusPoints,
  };
}

export function validateSurvivalActiveHealingClient(
  cfg: SurvivalActiveHealingConfig,
): string[] {
  const errors: string[] = [];
  const finite = (path: string, value: number, min: number, max?: number) => {
    if (!Number.isFinite(value)) errors.push(`${path} must be a finite number`);
    else if (value < min) errors.push(`${path} must be ≥ ${min}`);
    else if (max != null && value > max) errors.push(`${path} must be ≤ ${max}`);
  };
  finite("activeHealing.minEffectiveHealPctMaxHp", cfg.minEffectiveHealPctMaxHp, 0, 1);
  finite("activeHealing.selfWeight", cfg.selfWeight, 0);
  finite("activeHealing.allyWeight", cfg.allyWeight, 0);
  finite("activeHealing.diminishingExponent", cfg.diminishingExponent, 0.01);
  finite("activeHealing.maxSurvivalBonusPoints", cfg.maxSurvivalBonusPoints, 0, 100);
  if (!Array.isArray(cfg.eventCreditCurve) || cfg.eventCreditCurve.length < 2) {
    errors.push("activeHealing.eventCreditCurve must have at least 2 knots");
    return errors;
  }
  for (let i = 0; i < cfg.eventCreditCurve.length; i += 1) {
    const knot = cfg.eventCreditCurve[i]!;
    finite(`activeHealing.eventCreditCurve[${i}].x`, knot.effectiveHealPctMaxHp, 0, 1);
    finite(`activeHealing.eventCreditCurve[${i}].credit`, knot.credit, 0);
    if (i > 0 && knot.effectiveHealPctMaxHp <= cfg.eventCreditCurve[i - 1]!.effectiveHealPctMaxHp) {
      errors.push("activeHealing.eventCreditCurve X positions must be strictly increasing");
      break;
    }
  }
  return errors;
}

export function mergeSurvivalActiveHealingIntoConfig(
  baseConfig: unknown,
  healing: SurvivalActiveHealingConfig,
): Record<string, unknown> {
  const base = isRecord(baseConfig)
    ? (JSON.parse(JSON.stringify(baseConfig)) as Record<string, unknown>)
    : {};
  const payload = JSON.parse(JSON.stringify(healing)) as SurvivalActiveHealingConfig;
  base.survivalActiveHealing = payload;
  if (isRecord(base.scoring) && isRecord(base.scoring.survival)) {
    base.scoring.survival = {
      ...base.scoring.survival,
      activeHealing: payload,
    };
  }
  return base;
}
