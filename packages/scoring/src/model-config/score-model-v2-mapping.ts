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

/** Nested document stored under ScoreModel.config.scoringV2 (additive). */
export const SCORING_V2_DIMENSION_CONFIGS_SCHEMA_VERSION =
  "scoring-v2-dimension-configs.1" as const;

export interface ScoringV2DimensionConfigSet {
  schemaVersion: typeof SCORING_V2_DIMENSION_CONFIGS_SCHEMA_VERSION;
  performance: PerformanceV2ModelConfig;
  survival: SurvivalV2ModelConfig;
  utility: UtilityV2ModelConfig;
  experience: ExperienceV3ModelConfig;
}

export interface ScoringV2DimensionConfigFingerprints {
  performance: string;
  survival: string;
  utility: string;
  experience: string;
}

export interface ResolvedScoreModelV2DimensionConfigs {
  configs: ScoringV2DimensionConfigSet;
  fingerprints: ScoringV2DimensionConfigFingerprints;
  /** True when configs came from the explicit scoringV2 document (not defaults). */
  fromPersistedDocument: boolean;
  compatibility: "native" | "legacy-defaults" | "legacy-partial";
}

function fingerprintSet(configs: ScoringV2DimensionConfigSet): ScoringV2DimensionConfigFingerprints {
  return {
    performance: fingerprintPerformanceV2ModelConfig(configs.performance),
    survival: fingerprintSurvivalV2ModelConfig(configs.survival),
    utility: fingerprintUtilityV2ModelConfig(configs.utility),
    experience: fingerprintExperienceV3ModelConfig(configs.experience),
  };
}

/** Canonical default set — Phase 1 package constants. */
export function createDefaultScoringV2DimensionConfigSet(): ScoringV2DimensionConfigSet {
  return {
    schemaVersion: SCORING_V2_DIMENSION_CONFIGS_SCHEMA_VERSION,
    performance: PERFORMANCE_V2_MODEL_CONFIG,
    survival: SURVIVAL_V2_MODEL_CONFIG,
    utility: UTILITY_V2_MODEL_CONFIG,
    experience: EXPERIENCE_V3_MODEL_CONFIG,
  };
}

/**
 * Parse an explicit scoringV2 dimension-config document (fail closed).
 */
export function parseScoringV2DimensionConfigSet(
  raw: unknown,
): ScoringV2DimensionConfigSet {
  if (!isRecord(raw)) {
    throw new ModelConfigValidationError("SCORING_V2_SET", [
      "scoringV2 config set must be an object",
    ]);
  }
  if (raw.schemaVersion !== SCORING_V2_DIMENSION_CONFIGS_SCHEMA_VERSION) {
    throw new ModelConfigValidationError("SCORING_V2_SET", [
      `incompatible scoringV2.schemaVersion "${String(raw.schemaVersion)}" (expected ${SCORING_V2_DIMENSION_CONFIGS_SCHEMA_VERSION})`,
    ]);
  }
  if (raw.performance == null) {
    throw new ModelConfigValidationError("SCORING_V2_SET", [
      "missing dimension configuration: performance",
    ]);
  }
  if (raw.survival == null) {
    throw new ModelConfigValidationError("SCORING_V2_SET", [
      "missing dimension configuration: survival",
    ]);
  }
  if (raw.utility == null) {
    throw new ModelConfigValidationError("SCORING_V2_SET", [
      "missing dimension configuration: utility",
    ]);
  }
  if (raw.experience == null) {
    throw new ModelConfigValidationError("SCORING_V2_SET", [
      "missing dimension configuration: experience",
    ]);
  }

  return {
    schemaVersion: SCORING_V2_DIMENSION_CONFIGS_SCHEMA_VERSION,
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
 *  - `phase1-default`: missing scoringV2 → canonical defaults (normal shadow compute)
 *  - `calibration-strict`: missing/incomplete scoringV2 → fail closed (active vs draft)
 */
export function resolveScoreModelV2DimensionConfigs(
  modelConfig: ScoreModelConfigV1 | Record<string, unknown> | null | undefined,
  mode: "phase1-default" | "calibration-strict" = "phase1-default",
): ResolvedScoreModelV2DimensionConfigs {
  if (!modelConfig || typeof modelConfig !== "object") {
    if (mode === "calibration-strict") {
      throw new ModelConfigValidationError("SCORING_V2_SET", [
        "persisted model config missing for calibration comparison",
      ]);
    }
    const configs = createDefaultScoringV2DimensionConfigSet();
    return {
      configs,
      fingerprints: fingerprintSet(configs),
      fromPersistedDocument: false,
      compatibility: "legacy-defaults",
    };
  }

  const scoringV2 = (modelConfig as Record<string, unknown>).scoringV2;
  if (scoringV2 == null) {
    if (mode === "calibration-strict") {
      throw new ModelConfigValidationError("SCORING_V2_SET", [
        "legacy ScoreModel.config lacks scoringV2 dimension configs — refuse silent default fallback during active-versus-draft",
      ]);
    }
    const configs = createDefaultScoringV2DimensionConfigSet();
    return {
      configs,
      fingerprints: fingerprintSet(configs),
      fromPersistedDocument: false,
      compatibility: "legacy-defaults",
    };
  }

  const configs = parseScoringV2DimensionConfigSet(scoringV2);
  return {
    configs,
    fingerprints: fingerprintSet(configs),
    fromPersistedDocument: true,
    compatibility: "native",
  };
}

/**
 * Attach a complete scoringV2 config set onto a ScoreModelConfigV1 document
 * (immutable clone). Does not activate models.
 */
export function withScoringV2DimensionConfigs(
  model: ScoreModelConfigV1,
  configs: ScoringV2DimensionConfigSet = createDefaultScoringV2DimensionConfigSet(),
): ScoreModelConfigV1 & { scoringV2: ScoringV2DimensionConfigSet } {
  return {
    ...structuredClone(model),
    scoringV2: structuredClone(configs),
  };
}
