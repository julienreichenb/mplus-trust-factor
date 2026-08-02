import {
  PERFORMANCE_V2_MODEL_CONFIG,
  PERFORMANCE_V2_SCHEMA_VERSION,
  type PerformanceV2ModelConfig,
} from "./constants.js";
import { computePerformanceV2, type PerformanceV2ComputeOptions } from "./compute.js";
import { resolvePerformanceV2ModelConfig } from "./model-config.js";
import type {
  PerformanceV2CalibrationExport,
  PerformanceV2ComputeInput,
} from "./types.js";

/**
 * Export replayable Performance V2 inputs + contributor diagnostics.
 * Provider-free; suitable for calibration bundle members.
 */
export function exportPerformanceV2Calibration(
  input: PerformanceV2ComputeInput,
  options?: PerformanceV2ComputeOptions,
): PerformanceV2CalibrationExport {
  const modelConfig = resolvePerformanceV2ModelConfig(
    options?.modelConfig,
  ) as PerformanceV2ModelConfig;
  const result = computePerformanceV2(input, { modelConfig });
  return {
    schemaVersion: PERFORMANCE_V2_SCHEMA_VERSION,
    algorithmVersion: result.algorithmVersion,
    modelConfig: modelConfig === PERFORMANCE_V2_MODEL_CONFIG ? PERFORMANCE_V2_MODEL_CONFIG : modelConfig,
    input,
    result: {
      score: result.score,
      confidence: result.confidence,
      state: result.state,
      inputFingerprint: result.inputFingerprint,
      detailedSeasonPerformance: result.detailedSeasonPerformance,
      profilePerformance: result.profilePerformance,
      detailedWeight: result.detailedWeight,
      slotCoverage: result.slotCoverage,
    },
    contributors: result.explanation.contributors,
  };
}
