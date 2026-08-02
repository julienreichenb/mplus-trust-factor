import { EXPERIENCE_V3_MODEL_CONFIG, EXPERIENCE_V3_SCHEMA_VERSION } from "./constants.js";
import type {
  ExperienceV3CalibrationExport,
  ExperienceV3ComputeInput,
  ExperienceV3ComputeResult,
} from "./types.js";

/**
 * Replayable calibration export — provider-free inputs + contributor diagnostics.
 */
export function exportExperienceV3Calibration(
  input: ExperienceV3ComputeInput,
  result: ExperienceV3ComputeResult,
): ExperienceV3CalibrationExport {
  return {
    schemaVersion: EXPERIENCE_V3_SCHEMA_VERSION,
    algorithmVersion: result.algorithmVersion,
    modelConfig: input.config ?? EXPERIENCE_V3_MODEL_CONFIG,
    input,
    result: {
      score: result.score,
      confidence: result.confidence,
      state: result.state,
      inputFingerprint: result.inputFingerprint,
      components: result.components,
    },
    contributors: result.explanation.contributors,
  };
}
