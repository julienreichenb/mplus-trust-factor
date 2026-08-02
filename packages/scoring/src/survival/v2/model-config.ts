/**
 * Survival V2 — versioned model-config validation and fingerprinting.
 */

import {
  ModelConfigValidationError,
  isRecord,
  rejectUnknownKeys,
  requireNumber,
  requireObject,
  requireString,
  weightsSumToOne,
} from "../../model-config/validate.js";
import { stableSha256 } from "../../model-config/stable-hash.js";
import {
  SURVIVAL_V2_ALGORITHM_VERSION,
  SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION,
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2ModelConfig,
} from "./constants.js";

const ROOT_KEYS = new Set([
  "schemaVersion",
  "algorithmVersion",
  "modelLabel",
  "calibrationStatus",
  "outcomeByDeaths",
  "weightsWithRelative",
  "weightsShadowOrOff",
  "danger",
  "defensiveRate",
  "metricKeys",
]);

const CALIBRATION_STATUSES = new Set([
  "CANDIDATE_DEFAULTS_UNCALIBRATED",
  "CALIBRATION_IN_PROGRESS",
  "CALIBRATED_SHADOW",
  "CALIBRATED_ACTIVE",
]);

export function fingerprintSurvivalV2ModelConfig(config: SurvivalV2ModelConfig): string {
  return stableSha256(config);
}

export const SURVIVAL_V2_DEFAULT_CONFIG_FINGERPRINT =
  fingerprintSurvivalV2ModelConfig(SURVIVAL_V2_MODEL_CONFIG);

export function parseSurvivalV2ModelConfig(raw: unknown): SurvivalV2ModelConfig {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    throw new ModelConfigValidationError("SURVIVAL", ["config must be an object"]);
  }
  rejectUnknownKeys(raw, ROOT_KEYS, "survival", errors);

  const schemaVersion = requireString(raw, "schemaVersion", errors);
  if (
    schemaVersion != null &&
    schemaVersion !== SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION
  ) {
    errors.push(
      `incompatible schemaVersion "${schemaVersion}" (expected ${SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION})`,
    );
  }
  const algorithmVersion = requireString(raw, "algorithmVersion", errors);
  if (algorithmVersion != null && !algorithmVersion.startsWith("survival-v2")) {
    errors.push(
      `incompatible algorithmVersion "${algorithmVersion}" (expected survival-v2*)`,
    );
  }
  const modelLabel = requireString(raw, "modelLabel", errors);
  const calibrationStatus = requireString(raw, "calibrationStatus", errors);
  if (calibrationStatus != null && !CALIBRATION_STATUSES.has(calibrationStatus)) {
    errors.push(`invalid calibrationStatus "${calibrationStatus}"`);
  }

  const outcomeRaw = requireObject(raw, "outcomeByDeaths", errors);
  const weightsRelRaw = requireObject(raw, "weightsWithRelative", errors);
  const weightsShadowRaw = requireObject(raw, "weightsShadowOrOff", errors);
  const dangerRaw = requireObject(raw, "danger", errors);
  const defensiveRaw = requireObject(raw, "defensiveRate", errors);
  const metricKeysRaw = requireObject(raw, "metricKeys", errors);

  let outcomeByDeaths = SURVIVAL_V2_MODEL_CONFIG.outcomeByDeaths;
  if (outcomeRaw) {
    rejectUnknownKeys(
      outcomeRaw,
      new Set(["0", "1", "2", "threeOrMore"]),
      "outcomeByDeaths",
      errors,
    );
    // JSON keys for numeric props may be strings "0"|"1"|"2"
    const z = requireNumber(outcomeRaw, "0", errors, { min: 0, max: 100 });
    const o = requireNumber(outcomeRaw, "1", errors, { min: 0, max: 100 });
    const t = requireNumber(outcomeRaw, "2", errors, { min: 0, max: 100 });
    const threeOrMore = requireNumber(outcomeRaw, "threeOrMore", errors, {
      min: 0,
      max: 100,
    });
    if (z != null && o != null && t != null && threeOrMore != null) {
      outcomeByDeaths = Object.freeze({ 0: z, 1: o, 2: t, threeOrMore });
    }
  }

  function parseWeights(
    src: Record<string, unknown> | null,
    path: string,
    allowRelative: boolean,
  ): SurvivalV2ModelConfig["weightsWithRelative"] | null {
    if (!src) return null;
    const keys = new Set(["outcome", "defensive", "recovery", "relativeDamage"]);
    rejectUnknownKeys(src, keys, path, errors);
    const outcome = requireNumber(src, "outcome", errors, { min: 0, max: 1 });
    const defensive = requireNumber(src, "defensive", errors, { min: 0, max: 1 });
    const recovery = requireNumber(src, "recovery", errors, { min: 0, max: 1 });
    const relativeDamage = requireNumber(src, "relativeDamage", errors, {
      min: 0,
      max: 1,
    });
    if (
      outcome == null ||
      defensive == null ||
      recovery == null ||
      relativeDamage == null
    ) {
      return null;
    }
    if (!allowRelative && relativeDamage !== 0) {
      errors.push(`${path}.relativeDamage must be 0 for shadow/off weights`);
    }
    const parsed = { outcome, defensive, recovery, relativeDamage };
    weightsSumToOne(parsed, path, errors);
    return Object.freeze(parsed);
  }

  const weightsWithRelative =
    parseWeights(weightsRelRaw, "weightsWithRelative", true) ??
    SURVIVAL_V2_MODEL_CONFIG.weightsWithRelative;
  const weightsShadowOrOff =
    parseWeights(weightsShadowRaw, "weightsShadowOrOff", false) ??
    SURVIVAL_V2_MODEL_CONFIG.weightsShadowOrOff;

  let danger = SURVIVAL_V2_MODEL_CONFIG.danger;
  if (dangerRaw) {
    rejectUnknownKeys(
      dangerRaw,
      new Set([
        "lowHpRatio",
        "mergeGapMs",
        "recoverAboveHpRatio",
        "stableRecoveryMs",
        "continuousPressureGapMs",
      ]),
      "danger",
      errors,
    );
    const lowHpRatio = requireNumber(dangerRaw, "lowHpRatio", errors, {
      min: 0,
      max: 1,
    });
    const mergeGapMs = requireNumber(dangerRaw, "mergeGapMs", errors, { min: 0 });
    const recoverAboveHpRatio = requireNumber(dangerRaw, "recoverAboveHpRatio", errors, {
      min: 0,
      max: 1,
    });
    const stableRecoveryMs = requireNumber(dangerRaw, "stableRecoveryMs", errors, {
      min: 0,
    });
    const continuousPressureGapMs = requireNumber(
      dangerRaw,
      "continuousPressureGapMs",
      errors,
      { min: 0 },
    );
    if (
      lowHpRatio != null &&
      mergeGapMs != null &&
      recoverAboveHpRatio != null &&
      stableRecoveryMs != null &&
      continuousPressureGapMs != null
    ) {
      danger = Object.freeze({
        lowHpRatio,
        mergeGapMs,
        recoverAboveHpRatio,
        stableRecoveryMs,
        continuousPressureGapMs,
      });
    }
  }

  let defensiveRate = SURVIVAL_V2_MODEL_CONFIG.defensiveRate;
  if (defensiveRaw) {
    rejectUnknownKeys(
      defensiveRaw,
      new Set(["saturatingK", "applicableCategories"]),
      "defensiveRate",
      errors,
    );
    const saturatingK = requireNumber(defensiveRaw, "saturatingK", errors, { min: 0 });
    const cats = defensiveRaw.applicableCategories;
    if (!Array.isArray(cats) || cats.some((c) => typeof c !== "string")) {
      errors.push("defensiveRate.applicableCategories must be a string array");
    } else if (saturatingK != null) {
      defensiveRate = Object.freeze({
        saturatingK,
        applicableCategories: Object.freeze([...cats]) as typeof defensiveRate.applicableCategories,
      });
    }
  }

  let metricKeys = SURVIVAL_V2_MODEL_CONFIG.metricKeys;
  if (metricKeysRaw) {
    rejectUnknownKeys(
      metricKeysRaw,
      new Set(["outcome", "defensive", "recovery", "relativeDamage"]),
      "metricKeys",
      errors,
    );
    const outcome = requireString(metricKeysRaw, "outcome", errors);
    const defensive = requireString(metricKeysRaw, "defensive", errors);
    const recovery = requireString(metricKeysRaw, "recovery", errors);
    const relativeDamage = requireString(metricKeysRaw, "relativeDamage", errors);
    if (outcome && defensive && recovery && relativeDamage) {
      metricKeys = Object.freeze({ outcome, defensive, recovery, relativeDamage });
    }
  }

  if (errors.length > 0) {
    throw new ModelConfigValidationError("SURVIVAL", errors);
  }

  return Object.freeze({
    schemaVersion: schemaVersion as typeof SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION,
    algorithmVersion: algorithmVersion!,
    modelLabel: modelLabel!,
    calibrationStatus: calibrationStatus as SurvivalV2ModelConfig["calibrationStatus"],
    outcomeByDeaths,
    weightsWithRelative,
    weightsShadowOrOff,
    danger,
    defensiveRate,
    metricKeys,
  }) as SurvivalV2ModelConfig;
}

export function resolveSurvivalV2ModelConfig(override?: unknown): SurvivalV2ModelConfig {
  if (override === undefined || override === null || override === SURVIVAL_V2_MODEL_CONFIG) {
    return SURVIVAL_V2_MODEL_CONFIG;
  }
  return parseSurvivalV2ModelConfig(override);
}

export { SURVIVAL_V2_ALGORITHM_VERSION };
