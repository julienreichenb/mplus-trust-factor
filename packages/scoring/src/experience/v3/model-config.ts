/**
 * Experience V3 — versioned model-config validation and fingerprinting.
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
  EXPERIENCE_V3_MODEL_CONFIG,
  EXPERIENCE_V3_SCHEMA_VERSION,
  type ExperienceV3ModelConfig,
} from "./constants.js";

const ROOT_KEYS = new Set([
  "schemaVersion",
  "algorithmVersion",
  "modelLabel",
  "calibrationStatus",
  "componentWeights",
  "eliteCatalogVersion",
  "previousSeasonPolicyVersion",
  "historicalRankPolicyVersion",
  "previousSeason",
  "eliteHistory",
  "historicalRank",
  "confidenceWeights",
  "phase2AccountBoost",
]);

export function fingerprintExperienceV3ModelConfig(
  config: ExperienceV3ModelConfig,
): string {
  return stableSha256(config);
}

export const EXPERIENCE_V3_DEFAULT_CONFIG_FINGERPRINT =
  fingerprintExperienceV3ModelConfig(EXPERIENCE_V3_MODEL_CONFIG);

export function parseExperienceV3ModelConfig(raw: unknown): ExperienceV3ModelConfig {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    throw new ModelConfigValidationError("EXPERIENCE", ["config must be an object"]);
  }
  rejectUnknownKeys(raw, ROOT_KEYS, "experience", errors);

  const schemaVersion = requireString(raw, "schemaVersion", errors);
  if (schemaVersion != null && schemaVersion !== EXPERIENCE_V3_SCHEMA_VERSION) {
    errors.push(
      `incompatible schemaVersion "${schemaVersion}" (expected ${EXPERIENCE_V3_SCHEMA_VERSION})`,
    );
  }
  const algorithmVersion = requireString(raw, "algorithmVersion", errors);
  if (algorithmVersion != null && !algorithmVersion.startsWith("experience-v3.")) {
    errors.push(
      `incompatible algorithmVersion "${algorithmVersion}" (expected experience-v3.*)`,
    );
  }
  requireString(raw, "modelLabel", errors);
  requireString(raw, "calibrationStatus", errors);
  requireString(raw, "eliteCatalogVersion", errors);
  requireString(raw, "previousSeasonPolicyVersion", errors);
  requireString(raw, "historicalRankPolicyVersion", errors);

  const weights = requireObject(raw, "componentWeights", errors);
  if (weights) {
    rejectUnknownKeys(
      weights,
      new Set([
        "currentExposure",
        "previousSeasonStrength",
        "eliteHistory",
        "historicalRank",
      ]),
      "componentWeights",
      errors,
    );
    const currentExposure = requireNumber(weights, "currentExposure", errors, {
      min: 0,
      max: 1,
    });
    const previousSeasonStrength = requireNumber(
      weights,
      "previousSeasonStrength",
      errors,
      { min: 0, max: 1 },
    );
    const eliteHistory = requireNumber(weights, "eliteHistory", errors, {
      min: 0,
      max: 1,
    });
    const historicalRank = requireNumber(weights, "historicalRank", errors, {
      min: 0,
      max: 1,
    });
    if (
      currentExposure != null &&
      previousSeasonStrength != null &&
      eliteHistory != null &&
      historicalRank != null
    ) {
      weightsSumToOne(
        { currentExposure, previousSeasonStrength, eliteHistory, historicalRank },
        "componentWeights",
        errors,
      );
    }
  }

  requireObject(raw, "previousSeason", errors);
  requireObject(raw, "eliteHistory", errors);
  requireObject(raw, "historicalRank", errors);
  requireObject(raw, "confidenceWeights", errors);
  requireObject(raw, "phase2AccountBoost", errors);

  if (errors.length > 0) {
    throw new ModelConfigValidationError("EXPERIENCE", errors);
  }

  // Structural clone of validated document — unknown nested keys already limited
  // by requiring known root sections; deep fields follow default shape.
  return Object.freeze(structuredClone(raw)) as ExperienceV3ModelConfig;
}

export function resolveExperienceV3ModelConfig(
  override?: unknown,
): ExperienceV3ModelConfig {
  if (
    override === undefined ||
    override === null ||
    override === EXPERIENCE_V3_MODEL_CONFIG
  ) {
    return EXPERIENCE_V3_MODEL_CONFIG;
  }
  return parseExperienceV3ModelConfig(override);
}
