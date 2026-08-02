import {
  SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION,
  SURVIVAL_V2_MODEL_CONFIG,
} from "./constants.js";
import { computeSurvivalV2 } from "./compute.js";
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
): SurvivalV2CalibrationExport {
  const result = computeSurvivalV2(input);
  return {
    schemaVersion: SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION,
    algorithmVersion: result.algorithmVersion,
    modelConfig: SURVIVAL_V2_MODEL_CONFIG,
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
