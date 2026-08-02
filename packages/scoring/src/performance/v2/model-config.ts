/**
 * Performance V2 — versioned model-config validation and fingerprinting.
 */

import {
  ModelConfigValidationError,
  isRecord,
  rejectUnknownKeys,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
  weightsSumToOne,
} from "../../model-config/validate.js";
import { stableSha256 } from "../../model-config/stable-hash.js";
import {
  PERFORMANCE_V2_ALGORITHM_VERSION,
  PERFORMANCE_V2_MODEL_CONFIG,
  PERFORMANCE_V2_SCHEMA_VERSION,
  type PerformanceV2ModelConfig,
} from "./constants.js";

const ROOT_KEYS = new Set([
  "schemaVersion",
  "algorithmVersion",
  "modelLabel",
  "calibrationStatus",
  "lowKeyBaseline",
  "difficultyMultipliers",
  "parseCenter",
  "dungeonWeights",
  "profileWeights",
  "blend",
  "oneRunDungeonConfidenceCap",
  "role",
  "confidenceWeights",
  "loggedRunCountContextualWeight",
  "profileDisagreementDiagnosticThreshold",
]);

const DIFFICULTY_KEYS = new Set([
  "atOrBelowLowBaseline",
  "atK50",
  "atK90",
  "atK99",
  "aboveK99Cap",
]);

const DUNGEON_WEIGHT_KEYS = new Set(["peak", "floor", "consistency"]);
const PROFILE_WEIGHT_KEYS = new Set(["bestAverage", "medianAverage"]);
const BLEND_KEYS = new Set([
  "detailedWeightFloor",
  "detailedWeightSlope",
  "detailedWeightCoverageExponent",
  "detailedWeightCap",
]);
const ROLE_KEYS = new Set([
  "dpsFieldValidated",
  "tankAdapterVerified",
  "healerAdapterVerified",
]);
const CONFIDENCE_KEYS = new Set([
  "dungeonCoverage",
  "slotCoverage",
  "twoRunShare",
  "profileAvailability",
  "adapterValidity",
  "partitionCompatibility",
  "freshness",
  "policyConfidence",
]);

const CALIBRATION_STATUSES = new Set([
  "CANDIDATE_DEFAULTS_UNCALIBRATED",
  "CALIBRATION_IN_PROGRESS",
  "CALIBRATED_SHADOW",
  "CALIBRATED_ACTIVE",
]);

export function fingerprintPerformanceV2ModelConfig(
  config: PerformanceV2ModelConfig,
): string {
  return stableSha256(config);
}

export const PERFORMANCE_V2_DEFAULT_CONFIG_FINGERPRINT =
  fingerprintPerformanceV2ModelConfig(PERFORMANCE_V2_MODEL_CONFIG);

/**
 * Validate and canonicalize a Performance V2 model config.
 * Rejects missing fields, invalid ranges, incompatible versions, and unknown keys.
 */
export function parsePerformanceV2ModelConfig(
  raw: unknown,
): PerformanceV2ModelConfig {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    throw new ModelConfigValidationError("PERFORMANCE", ["config must be an object"]);
  }
  rejectUnknownKeys(raw, ROOT_KEYS, "performance", errors);

  const schemaVersion = requireString(raw, "schemaVersion", errors);
  if (schemaVersion != null && schemaVersion !== PERFORMANCE_V2_SCHEMA_VERSION) {
    errors.push(
      `incompatible schemaVersion "${schemaVersion}" (expected ${PERFORMANCE_V2_SCHEMA_VERSION})`,
    );
  }
  const algorithmVersion = requireString(raw, "algorithmVersion", errors);
  if (
    algorithmVersion != null &&
    !algorithmVersion.startsWith("performance-v2.")
  ) {
    errors.push(
      `incompatible algorithmVersion "${algorithmVersion}" (expected performance-v2.*)`,
    );
  }
  const modelLabel = requireString(raw, "modelLabel", errors);
  const calibrationStatus = requireString(raw, "calibrationStatus", errors);
  if (calibrationStatus != null && !CALIBRATION_STATUSES.has(calibrationStatus)) {
    errors.push(`invalid calibrationStatus "${calibrationStatus}"`);
  }

  const lowKeyBaseline = requireNumber(raw, "lowKeyBaseline", errors, { min: 0 });
  const parseCenter = requireNumber(raw, "parseCenter", errors, { min: 0, max: 100 });
  const oneRunDungeonConfidenceCap = requireNumber(
    raw,
    "oneRunDungeonConfidenceCap",
    errors,
    { min: 0, max: 1 },
  );
  const loggedRunCountContextualWeight = requireNumber(
    raw,
    "loggedRunCountContextualWeight",
    errors,
    { min: 0, max: 1 },
  );
  const profileDisagreementDiagnosticThreshold = requireNumber(
    raw,
    "profileDisagreementDiagnosticThreshold",
    errors,
    { min: 0 },
  );

  const difficultyRaw = requireObject(raw, "difficultyMultipliers", errors);
  const dungeonRaw = requireObject(raw, "dungeonWeights", errors);
  const profileRaw = requireObject(raw, "profileWeights", errors);
  const blendRaw = requireObject(raw, "blend", errors);
  const roleRaw = requireObject(raw, "role", errors);
  const confidenceRaw = requireObject(raw, "confidenceWeights", errors);

  let difficultyMultipliers = PERFORMANCE_V2_MODEL_CONFIG.difficultyMultipliers;
  if (difficultyRaw) {
    rejectUnknownKeys(difficultyRaw, DIFFICULTY_KEYS, "difficultyMultipliers", errors);
    const atOrBelowLowBaseline = requireNumber(difficultyRaw, "atOrBelowLowBaseline", errors, {
      min: 0,
    });
    const atK50 = requireNumber(difficultyRaw, "atK50", errors, { min: 0 });
    const atK90 = requireNumber(difficultyRaw, "atK90", errors, { min: 0 });
    const atK99 = requireNumber(difficultyRaw, "atK99", errors, { min: 0 });
    const aboveK99Cap = requireNumber(difficultyRaw, "aboveK99Cap", errors, { min: 0 });
    if (
      atOrBelowLowBaseline != null &&
      atK50 != null &&
      atK90 != null &&
      atK99 != null &&
      aboveK99Cap != null
    ) {
      difficultyMultipliers = Object.freeze({
        atOrBelowLowBaseline,
        atK50,
        atK90,
        atK99,
        aboveK99Cap,
      });
    }
  }

  let dungeonWeights = PERFORMANCE_V2_MODEL_CONFIG.dungeonWeights;
  if (dungeonRaw) {
    rejectUnknownKeys(dungeonRaw, DUNGEON_WEIGHT_KEYS, "dungeonWeights", errors);
    const peak = requireNumber(dungeonRaw, "peak", errors, { min: 0, max: 1 });
    const floor = requireNumber(dungeonRaw, "floor", errors, { min: 0, max: 1 });
    const consistency = requireNumber(dungeonRaw, "consistency", errors, {
      min: 0,
      max: 1,
    });
    if (peak != null && floor != null && consistency != null) {
      dungeonWeights = Object.freeze({ peak, floor, consistency });
      weightsSumToOne(dungeonWeights, "dungeonWeights", errors);
    }
  }

  let profileWeights = PERFORMANCE_V2_MODEL_CONFIG.profileWeights;
  if (profileRaw) {
    rejectUnknownKeys(profileRaw, PROFILE_WEIGHT_KEYS, "profileWeights", errors);
    const bestAverage = requireNumber(profileRaw, "bestAverage", errors, {
      min: 0,
      max: 1,
    });
    const medianAverage = requireNumber(profileRaw, "medianAverage", errors, {
      min: 0,
      max: 1,
    });
    if (bestAverage != null && medianAverage != null) {
      profileWeights = Object.freeze({ bestAverage, medianAverage });
      weightsSumToOne(profileWeights, "profileWeights", errors);
    }
  }

  let blend = PERFORMANCE_V2_MODEL_CONFIG.blend;
  if (blendRaw) {
    rejectUnknownKeys(blendRaw, BLEND_KEYS, "blend", errors);
    const detailedWeightFloor = requireNumber(blendRaw, "detailedWeightFloor", errors, {
      min: 0,
      max: 1,
    });
    const detailedWeightSlope = requireNumber(blendRaw, "detailedWeightSlope", errors, {
      min: 0,
    });
    const detailedWeightCoverageExponent = requireNumber(
      blendRaw,
      "detailedWeightCoverageExponent",
      errors,
      { min: 0 },
    );
    const detailedWeightCap = requireNumber(blendRaw, "detailedWeightCap", errors, {
      min: 0,
      max: 1,
    });
    if (
      detailedWeightFloor != null &&
      detailedWeightSlope != null &&
      detailedWeightCoverageExponent != null &&
      detailedWeightCap != null
    ) {
      blend = Object.freeze({
        detailedWeightFloor,
        detailedWeightSlope,
        detailedWeightCoverageExponent,
        detailedWeightCap,
      });
    }
  }

  let role = PERFORMANCE_V2_MODEL_CONFIG.role;
  if (roleRaw) {
    rejectUnknownKeys(roleRaw, ROLE_KEYS, "role", errors);
    const dpsFieldValidated = requireBoolean(roleRaw, "dpsFieldValidated", errors);
    const tankAdapterVerified = requireBoolean(roleRaw, "tankAdapterVerified", errors);
    const healerAdapterVerified = requireBoolean(roleRaw, "healerAdapterVerified", errors);
    if (
      dpsFieldValidated != null &&
      tankAdapterVerified != null &&
      healerAdapterVerified != null
    ) {
      role = Object.freeze({
        dpsFieldValidated,
        tankAdapterVerified,
        healerAdapterVerified,
      });
    }
  }

  let confidenceWeights = PERFORMANCE_V2_MODEL_CONFIG.confidenceWeights;
  if (confidenceRaw) {
    rejectUnknownKeys(confidenceRaw, CONFIDENCE_KEYS, "confidenceWeights", errors);
    const dungeonCoverage = requireNumber(confidenceRaw, "dungeonCoverage", errors, {
      min: 0,
      max: 1,
    });
    const slotCoverage = requireNumber(confidenceRaw, "slotCoverage", errors, {
      min: 0,
      max: 1,
    });
    const twoRunShare = requireNumber(confidenceRaw, "twoRunShare", errors, {
      min: 0,
      max: 1,
    });
    const profileAvailability = requireNumber(confidenceRaw, "profileAvailability", errors, {
      min: 0,
      max: 1,
    });
    const adapterValidity = requireNumber(confidenceRaw, "adapterValidity", errors, {
      min: 0,
      max: 1,
    });
    const partitionCompatibility = requireNumber(
      confidenceRaw,
      "partitionCompatibility",
      errors,
      { min: 0, max: 1 },
    );
    const freshness = requireNumber(confidenceRaw, "freshness", errors, { min: 0, max: 1 });
    const policyConfidence = requireNumber(confidenceRaw, "policyConfidence", errors, {
      min: 0,
      max: 1,
    });
    if (
      dungeonCoverage != null &&
      slotCoverage != null &&
      twoRunShare != null &&
      profileAvailability != null &&
      adapterValidity != null &&
      partitionCompatibility != null &&
      freshness != null &&
      policyConfidence != null
    ) {
      confidenceWeights = Object.freeze({
        dungeonCoverage,
        slotCoverage,
        twoRunShare,
        profileAvailability,
        adapterValidity,
        partitionCompatibility,
        freshness,
        policyConfidence,
      });
    }
  }

  if (errors.length > 0) {
    throw new ModelConfigValidationError("PERFORMANCE", errors);
  }

  return Object.freeze({
    schemaVersion: schemaVersion as typeof PERFORMANCE_V2_SCHEMA_VERSION,
    algorithmVersion: algorithmVersion!,
    modelLabel: modelLabel!,
    calibrationStatus: calibrationStatus as PerformanceV2ModelConfig["calibrationStatus"],
    lowKeyBaseline: lowKeyBaseline!,
    difficultyMultipliers,
    parseCenter: parseCenter!,
    dungeonWeights,
    profileWeights,
    blend,
    oneRunDungeonConfidenceCap: oneRunDungeonConfidenceCap!,
    role,
    confidenceWeights,
    loggedRunCountContextualWeight: loggedRunCountContextualWeight!,
    profileDisagreementDiagnosticThreshold: profileDisagreementDiagnosticThreshold!,
  }) as PerformanceV2ModelConfig;
}

/** Resolve config: explicit override validated, else canonical default. */
export function resolvePerformanceV2ModelConfig(
  override?: unknown,
): PerformanceV2ModelConfig {
  if (override === undefined || override === null) {
    return PERFORMANCE_V2_MODEL_CONFIG;
  }
  // Identity short-circuit preserves default reference + fingerprint.
  if (override === PERFORMANCE_V2_MODEL_CONFIG) {
    return PERFORMANCE_V2_MODEL_CONFIG;
  }
  return parsePerformanceV2ModelConfig(override);
}

export { PERFORMANCE_V2_ALGORITHM_VERSION };
