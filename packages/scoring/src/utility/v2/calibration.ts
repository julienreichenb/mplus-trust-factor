/**
 * Replayable Utility V2 calibration export (provider-free).
 */

import {
  UTILITY_V2_MODEL_CONFIG,
  UTILITY_V2_SCHEMA_VERSION,
} from "./constants.js";
import { computeUtilityV2 } from "./compute.js";
import type {
  UtilityV2CalibrationExport,
  UtilityV2ComputeInput,
} from "./types.js";

export function exportUtilityV2Calibration(
  input: UtilityV2ComputeInput,
): UtilityV2CalibrationExport {
  const result = computeUtilityV2(input);
  return {
    schemaVersion: UTILITY_V2_SCHEMA_VERSION,
    algorithmVersion: result.algorithmVersion,
    modelConfig: UTILITY_V2_MODEL_CONFIG,
    input,
    result: {
      score: result.score,
      confidence: result.confidence,
      availabilityState: result.availabilityState,
      inputFingerprint: result.inputFingerprint,
      rawBehaviorEstimate: result.rawBehaviorEstimate,
      reliability: result.reliability,
    },
    contributors: result.domainBreakdown,
  };
}
