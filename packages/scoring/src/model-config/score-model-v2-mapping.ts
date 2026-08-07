/**
 * Deterministic mapping from persisted ScoreModel JSON → four dimension configs.
 *
 * ScoreModel.config is Json — no Prisma migration required.
 * Active-versus-draft comparison never silently falls back to defaults.
 * Normal Phase 1 non-calibration computation may continue using package defaults.
 */

import type { ScoreModelConfigV1 } from "../types.js";
import {
  PERFORMANCE_V2_MODEL_CONFIG,
  type PerformanceV2ModelConfig,
} from "../performance/v2/constants.js";
import {
  parsePerformanceV2ModelConfig,
  fingerprintPerformanceV2ModelConfig,
} from "../performance/v2/model-config.js";
import {
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2ModelConfig,
} from "../survival/v2/constants.js";
import {
  parseSurvivalV2ModelConfig,
  fingerprintSurvivalV2ModelConfig,
} from "../survival/v2/model-config.js";
import {
  UTILITY_V2_MODEL_CONFIG,
  type UtilityV2ModelConfig,
} from "../utility/v2/constants.js";
import {
  parseUtilityV2ModelConfig,
  fingerprintUtilityV2ModelConfig,
} from "../utility/v2/model-config.js";
import {
  EXPERIENCE_V3_MODEL_CONFIG,
  type ExperienceV3ModelConfig,
} from "../experience/v3/constants.js";
import {
  parseExperienceV3ModelConfig,
  fingerprintExperienceV3ModelConfig,
} from "../experience/v3/model-config.js";
import { ModelConfigValidationError, isRecord } from "./validate.js";

/** Nested document stored under ScoreModel.config.scoring (additive). */
export const scoring_DIMENSION_CONFIGS_SCHEMA_VERSION =
  "scoring-dimension-configs.1" as const;

export interface scoringDimensionConfigSet {
  schemaVersion: typeof scoring_DIMENSION_CONFIGS_SCHEMA_VERSION;
  performance: PerformanceV2ModelConfig;
  survival: SurvivalV2ModelConfig;
  utility: UtilityV2ModelConfig;
  experience: ExperienceV3ModelConfig;
}

export interface scoringDimensionConfigFingerprints {
  performance: string;
  survival: string;
  utility: string;
  experience: string;
}

export interface ResolvedScoreModelV2DimensionConfigs {
  configs: scoringDimensionConfigSet;
  fingerprints: scoringDimensionConfigFingerprints;
  /** True when configs came from the explicit scoring document (not defaults). */
  fromPersistedDocument: boolean;
  compatibility: "native" | "legacy-defaults" | "legacy-partial";
}

function fingerprintSet(configs: scoringDimensionConfigSet): scoringDimensionConfigFingerprints {
  return {
    performance: fingerprintPerformanceV2ModelConfig(configs.performance),
    survival: fingerprintSurvivalV2ModelConfig(configs.survival),
    utility: fingerprintUtilityV2ModelConfig(configs.utility),
    experience: fingerprintExperienceV3ModelConfig(configs.experience),
  };
}

/** Canonical default set — Phase 1 package constants. */
export function createDefaultscoringDimensionConfigSet(): scoringDimensionConfigSet {
  return {
    schemaVersion: scoring_DIMENSION_CONFIGS_SCHEMA_VERSION,
    performance: PERFORMANCE_V2_MODEL_CONFIG,
    survival: SURVIVAL_V2_MODEL_CONFIG,
    utility: UTILITY_V2_MODEL_CONFIG,
    experience: EXPERIENCE_V3_MODEL_CONFIG,
  };
}

/**
 * Parse an explicit scoring dimension-config document (fail closed).
 */
export function parsescoringDimensionConfigSet(
  raw: unknown,
): scoringDimensionConfigSet {
  if (!isRecord(raw)) {
    throw new ModelConfigValidationError("scoring_SET", [
      "scoring config set must be an object",
    ]);
  }
  if (raw.schemaVersion !== scoring_DIMENSION_CONFIGS_SCHEMA_VERSION) {
    throw new ModelConfigValidationError("scoring_SET", [
      `incompatible scoring.schemaVersion "${String(raw.schemaVersion)}" (expected ${scoring_DIMENSION_CONFIGS_SCHEMA_VERSION})`,
    ]);
  }
  if (raw.performance == null) {
    throw new ModelConfigValidationError("scoring_SET", [
      "missing dimension configuration: performance",
    ]);
  }
  if (raw.survival == null) {
    throw new ModelConfigValidationError("scoring_SET", [
      "missing dimension configuration: survival",
    ]);
  }
  if (raw.utility == null) {
    throw new ModelConfigValidationError("scoring_SET", [
      "missing dimension configuration: utility",
    ]);
  }
  if (raw.experience == null) {
    throw new ModelConfigValidationError("scoring_SET", [
      "missing dimension configuration: experience",
    ]);
  }

  return {
    schemaVersion: scoring_DIMENSION_CONFIGS_SCHEMA_VERSION,
    performance: parsePerformanceV2ModelConfig(raw.performance),
    survival: parseSurvivalV2ModelConfig(raw.survival),
    utility: parseUtilityV2ModelConfig(raw.utility),
    experience: parseExperienceV3ModelConfig(raw.experience),
  };
}

/**
 * Resolve dimension configs from a persisted ScoreModel.config JSON.
 *
 * @param mode
 *  - `phase1-default`: missing scoring → canonical defaults (normal shadow compute)
 *  - `calibration-strict`: missing/incomplete scoring → fail closed (active vs draft)
 */
export function resolveScoreModelV2DimensionConfigs(
  modelConfig: ScoreModelConfigV1 | Record<string, unknown> | null | undefined,
  mode: "phase1-default" | "calibration-strict" = "phase1-default",
): ResolvedScoreModelV2DimensionConfigs {
  if (!modelConfig || typeof modelConfig !== "object") {
    if (mode === "calibration-strict") {
      throw new ModelConfigValidationError("scoring_SET", [
        "persisted model config missing for calibration comparison",
      ]);
    }
    const configs = createDefaultscoringDimensionConfigSet();
    return {
      configs,
      fingerprints: fingerprintSet(configs),
      fromPersistedDocument: false,
      compatibility: "legacy-defaults",
    };
  }

  const scoring = (modelConfig as Record<string, unknown>).scoring;
  if (scoring == null) {
    if (mode === "calibration-strict") {
      throw new ModelConfigValidationError("scoring_SET", [
        "legacy ScoreModel.config lacks scoring dimension configs — refuse silent default fallback during active-versus-draft",
      ]);
    }
    const configs = createDefaultscoringDimensionConfigSet();
    return {
      configs,
      fingerprints: fingerprintSet(configs),
      fromPersistedDocument: false,
      compatibility: "legacy-defaults",
    };
  }

  const configs = parsescoringDimensionConfigSet(scoring);
  return {
    configs,
    fingerprints: fingerprintSet(configs),
    fromPersistedDocument: true,
    compatibility: "native",
  };
}

/**
 * Attach a complete scoring config set onto a ScoreModelConfigV1 document
 * (immutable clone). Does not activate models.
 */
export function withscoringDimensionConfigs(
  model: ScoreModelConfigV1,
  configs: scoringDimensionConfigSet = createDefaultscoringDimensionConfigSet(),
): ScoreModelConfigV1 & { scoring: scoringDimensionConfigSet } {
  return {
    ...structuredClone(model),
    scoring: structuredClone(configs),
  };
}
