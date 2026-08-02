import {
  PERFORMANCE_V2_MODEL_CONFIG,
  PERFORMANCE_V2_SCHEMA_VERSION,
} from "./constants.js";
import { computePerformanceV2 } from "./compute.js";
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
): PerformanceV2CalibrationExport {
  const result = computePerformanceV2(input);
  return {
    schemaVersion: PERFORMANCE_V2_SCHEMA_VERSION,
    algorithmVersion: result.algorithmVersion,
    modelConfig: PERFORMANCE_V2_MODEL_CONFIG,
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
