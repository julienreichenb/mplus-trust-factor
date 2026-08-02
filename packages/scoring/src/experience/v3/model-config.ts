/**
 * Experience V3 — versioned model-config validation and fingerprinting.
 *
 * Nested sections are field-constructed after deep validation.
 * Never returns structuredClone(raw). Unknown nested keys are rejected.
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

const CALIBRATION_STATUSES = new Set([
  "CANDIDATE_DEFAULTS_UNCALIBRATED",
  "CALIBRATION_IN_PROGRESS",
  "CALIBRATED_SHADOW",
  "CALIBRATED_ACTIVE",
]);

const PREVIOUS_SEASON_KEYS = new Set([
  "confirmedNoActivityScore",
  "atOrBelowK50",
  "atK90",
  "atK99",
  "aboveK99Cap",
  "partialConfidenceFactor",
]);

const ELITE_HISTORY_KEYS = new Set([
  "singleTop01Score",
  "additionalTitleBase",
  "additionalDiminishing",
  "ageDecayPerSeason",
  "ageDecayFloor",
  "accountVisibleCreditFactor",
  "scoreCap",
]);

const HISTORICAL_RANK_KEYS = new Set([
  "top10ClassSpecRegionScore",
  "top01PercentScore",
  "top1PercentScore",
  "top5PercentScore",
  "top10PercentScore",
  "confirmedFloor",
]);

const CONFIDENCE_WEIGHT_KEYS = new Set([
  "currentExposureCompleteness",
  "previousSeasonProviderState",
  "eliteVisibilitySemantics",
  "historicalRankSourceQuality",
  "seasonBinding",
  "recency",
]);

const PHASE2_BOOST_KEYS = new Set(["enabled", "characterWeight", "maxBoostWeight"]);

export function fingerprintExperienceV3ModelConfig(
  config: ExperienceV3ModelConfig,
): string {
  return stableSha256(config);
}

export const EXPERIENCE_V3_DEFAULT_CONFIG_FINGERPRINT =
  fingerprintExperienceV3ModelConfig(EXPERIENCE_V3_MODEL_CONFIG);

/**
 * Validate Experience V3 model config field-by-field. Fail closed on unsafe nested values.
 */
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
  const modelLabel = requireString(raw, "modelLabel", errors);
  const calibrationStatus = requireString(raw, "calibrationStatus", errors);
  if (calibrationStatus != null && !CALIBRATION_STATUSES.has(calibrationStatus)) {
    errors.push(`invalid calibrationStatus "${calibrationStatus}"`);
  }
  const eliteCatalogVersion = requireString(raw, "eliteCatalogVersion", errors);
  const previousSeasonPolicyVersion = requireString(
    raw,
    "previousSeasonPolicyVersion",
    errors,
  );
  const historicalRankPolicyVersion = requireString(
    raw,
    "historicalRankPolicyVersion",
    errors,
  );

  const weights = requireObject(raw, "componentWeights", errors);
  let componentWeights: ExperienceV3ModelConfig["componentWeights"] | null = null;
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
      componentWeights = Object.freeze({
        currentExposure,
        previousSeasonStrength,
        eliteHistory,
        historicalRank,
      });
      weightsSumToOne(componentWeights, "componentWeights", errors);
    }
  }

  const previousSeasonObj = requireObject(raw, "previousSeason", errors);
  let previousSeason: ExperienceV3ModelConfig["previousSeason"] | null = null;
  if (previousSeasonObj) {
    rejectUnknownKeys(previousSeasonObj, PREVIOUS_SEASON_KEYS, "previousSeason", errors);
    const confirmedNoActivityScore = requireNumber(
      previousSeasonObj,
      "confirmedNoActivityScore",
      errors,
      { min: 0, max: 100 },
    );
    const atOrBelowK50 = requireNumber(previousSeasonObj, "atOrBelowK50", errors, {
      min: 0,
      max: 100,
    });
    const atK90 = requireNumber(previousSeasonObj, "atK90", errors, { min: 0, max: 100 });
    const atK99 = requireNumber(previousSeasonObj, "atK99", errors, { min: 0, max: 100 });
    const aboveK99Cap = requireNumber(previousSeasonObj, "aboveK99Cap", errors, {
      min: 0,
      max: 100,
    });
    const partialConfidenceFactor = requireNumber(
      previousSeasonObj,
      "partialConfidenceFactor",
      errors,
      { min: 0, max: 1 },
    );
    if (
      confirmedNoActivityScore != null &&
      atOrBelowK50 != null &&
      atK90 != null &&
      atK99 != null &&
      aboveK99Cap != null &&
      partialConfidenceFactor != null
    ) {
      previousSeason = Object.freeze({
        confirmedNoActivityScore,
        atOrBelowK50,
        atK90,
        atK99,
        aboveK99Cap,
        partialConfidenceFactor,
      });
    }
  }

  const eliteRaw = requireObject(raw, "eliteHistory", errors);
  let eliteHistory: ExperienceV3ModelConfig["eliteHistory"] | null = null;
  if (eliteRaw) {
    rejectUnknownKeys(eliteRaw, ELITE_HISTORY_KEYS, "eliteHistory", errors);
    const singleTop01Score = requireNumber(eliteRaw, "singleTop01Score", errors, {
      min: 0,
      max: 100,
    });
    const additionalTitleBase = requireNumber(eliteRaw, "additionalTitleBase", errors, {
      min: 0,
      max: 100,
    });
    const additionalDiminishing = requireNumber(eliteRaw, "additionalDiminishing", errors, {
      min: 0,
      max: 1,
    });
    const ageDecayPerSeason = requireNumber(eliteRaw, "ageDecayPerSeason", errors, {
      min: 0,
      max: 1,
    });
    const ageDecayFloor = requireNumber(eliteRaw, "ageDecayFloor", errors, {
      min: 0,
      max: 1,
    });
    const accountVisibleCreditFactor = requireNumber(
      eliteRaw,
      "accountVisibleCreditFactor",
      errors,
      { min: 0, max: 1 },
    );
    const scoreCap = requireNumber(eliteRaw, "scoreCap", errors, { min: 0, max: 100 });
    if (
      singleTop01Score != null &&
      additionalTitleBase != null &&
      additionalDiminishing != null &&
      ageDecayPerSeason != null &&
      ageDecayFloor != null &&
      accountVisibleCreditFactor != null &&
      scoreCap != null
    ) {
      eliteHistory = Object.freeze({
        singleTop01Score,
        additionalTitleBase,
        additionalDiminishing,
        ageDecayPerSeason,
        ageDecayFloor,
        accountVisibleCreditFactor,
        scoreCap,
      });
    }
  }

  const historicalRaw = requireObject(raw, "historicalRank", errors);
  let historicalRankCfg: ExperienceV3ModelConfig["historicalRank"] | null = null;
  if (historicalRaw) {
    rejectUnknownKeys(historicalRaw, HISTORICAL_RANK_KEYS, "historicalRank", errors);
    const top10ClassSpecRegionScore = requireNumber(
      historicalRaw,
      "top10ClassSpecRegionScore",
      errors,
      { min: 0, max: 100 },
    );
    const top01PercentScore = requireNumber(historicalRaw, "top01PercentScore", errors, {
      min: 0,
      max: 100,
    });
    const top1PercentScore = requireNumber(historicalRaw, "top1PercentScore", errors, {
      min: 0,
      max: 100,
    });
    const top5PercentScore = requireNumber(historicalRaw, "top5PercentScore", errors, {
      min: 0,
      max: 100,
    });
    const top10PercentScore = requireNumber(historicalRaw, "top10PercentScore", errors, {
      min: 0,
      max: 100,
    });
    const confirmedFloor = requireNumber(historicalRaw, "confirmedFloor", errors, {
      min: 0,
      max: 100,
    });
    if (
      top10ClassSpecRegionScore != null &&
      top01PercentScore != null &&
      top1PercentScore != null &&
      top5PercentScore != null &&
      top10PercentScore != null &&
      confirmedFloor != null
    ) {
      historicalRankCfg = Object.freeze({
        top10ClassSpecRegionScore,
        top01PercentScore,
        top1PercentScore,
        top5PercentScore,
        top10PercentScore,
        confirmedFloor,
      });
    }
  }

  const confidenceRaw = requireObject(raw, "confidenceWeights", errors);
  let confidenceWeights: ExperienceV3ModelConfig["confidenceWeights"] | null = null;
  if (confidenceRaw) {
    rejectUnknownKeys(confidenceRaw, CONFIDENCE_WEIGHT_KEYS, "confidenceWeights", errors);
    const currentExposureCompleteness = requireNumber(
      confidenceRaw,
      "currentExposureCompleteness",
      errors,
      { min: 0, max: 1 },
    );
    const previousSeasonProviderState = requireNumber(
      confidenceRaw,
      "previousSeasonProviderState",
      errors,
      { min: 0, max: 1 },
    );
    const eliteVisibilitySemantics = requireNumber(
      confidenceRaw,
      "eliteVisibilitySemantics",
      errors,
      { min: 0, max: 1 },
    );
    const historicalRankSourceQuality = requireNumber(
      confidenceRaw,
      "historicalRankSourceQuality",
      errors,
      { min: 0, max: 1 },
    );
    const seasonBinding = requireNumber(confidenceRaw, "seasonBinding", errors, {
      min: 0,
      max: 1,
    });
    const recency = requireNumber(confidenceRaw, "recency", errors, { min: 0, max: 1 });
    if (
      currentExposureCompleteness != null &&
      previousSeasonProviderState != null &&
      eliteVisibilitySemantics != null &&
      historicalRankSourceQuality != null &&
      seasonBinding != null &&
      recency != null
    ) {
      confidenceWeights = Object.freeze({
        currentExposureCompleteness,
        previousSeasonProviderState,
        eliteVisibilitySemantics,
        historicalRankSourceQuality,
        seasonBinding,
        recency,
      });
      weightsSumToOne(confidenceWeights, "confidenceWeights", errors);
    }
  }

  const boostRaw = requireObject(raw, "phase2AccountBoost", errors);
  let phase2AccountBoost: ExperienceV3ModelConfig["phase2AccountBoost"] | null = null;
  if (boostRaw) {
    rejectUnknownKeys(boostRaw, PHASE2_BOOST_KEYS, "phase2AccountBoost", errors);
    const enabled = requireBoolean(boostRaw, "enabled", errors);
    const characterWeight = requireNumber(boostRaw, "characterWeight", errors, {
      min: 0,
      max: 1,
    });
    const maxBoostWeight = requireNumber(boostRaw, "maxBoostWeight", errors, {
      min: 0,
      max: 1,
    });
    if (enabled != null && characterWeight != null && maxBoostWeight != null) {
      // Phase 1 contracts only — enabled must remain false.
      if (enabled !== false) {
        errors.push("phase2AccountBoost.enabled must be false in Phase 1");
      } else {
        phase2AccountBoost = Object.freeze({
          enabled: false,
          characterWeight,
          maxBoostWeight,
        });
      }
    }
  }

  if (errors.length > 0) {
    throw new ModelConfigValidationError("EXPERIENCE", errors);
  }

  if (
    schemaVersion == null ||
    algorithmVersion == null ||
    modelLabel == null ||
    calibrationStatus == null ||
    eliteCatalogVersion == null ||
    previousSeasonPolicyVersion == null ||
    historicalRankPolicyVersion == null ||
    componentWeights == null ||
    previousSeason == null ||
    eliteHistory == null ||
    historicalRankCfg == null ||
    confidenceWeights == null ||
    phase2AccountBoost == null
  ) {
    throw new ModelConfigValidationError("EXPERIENCE", [
      "incomplete validated Experience config",
    ]);
  }

  return Object.freeze({
    schemaVersion: EXPERIENCE_V3_SCHEMA_VERSION,
    algorithmVersion,
    modelLabel,
    calibrationStatus: calibrationStatus as ExperienceV3ModelConfig["calibrationStatus"],
    componentWeights,
    eliteCatalogVersion,
    previousSeasonPolicyVersion,
    historicalRankPolicyVersion,
    previousSeason,
    eliteHistory,
    historicalRank: historicalRankCfg,
    confidenceWeights,
    phase2AccountBoost,
  });
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
