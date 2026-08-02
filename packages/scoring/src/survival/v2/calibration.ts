import { SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION } from "./constants.js";
import { computeSurvivalV2, type SurvivalV2ComputeOptions } from "./compute.js";
import { resolveSurvivalV2ModelConfig } from "./model-config.js";
import type {
  SurvivalV2CalibrationExport,
  SurvivalV2ComputeInput,
} from "./types.js";

/**
 * Export replayable Survival V2 inputs + contributor diagnostics.
 * Provider-free; suitable for calibration bundle members.
 */
export function exportSurvivalV2Calibration(
  input: SurvivalV2ComputeInput,
  options?: SurvivalV2ComputeOptions,
): SurvivalV2CalibrationExport {
  const modelConfig = resolveSurvivalV2ModelConfig(options?.modelConfig);
  const result = computeSurvivalV2(input, { modelConfig });
  return {
    schemaVersion: SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION,
    algorithmVersion: result.algorithmVersion,
    modelConfig,
    input,
    result: {
      score: result.score,
      confidence: result.confidence,
      state: result.state,
      inputFingerprint: result.inputFingerprint,
      components: result.components,
      observations: result.observations,
      relativeDamageMode: result.relativeDamageMode,
    },
    contributors: result.explanation.contributors,
  };
}
