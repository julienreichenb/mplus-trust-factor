/**
 * Replayable Utility V2 calibration export (provider-free).
 */

import { UTILITY_V2_SCHEMA_VERSION } from "./constants.js";
import { computeUtilityV2 } from "./compute.js";
import { resolveUtilityV2ModelConfig } from "./model-config.js";
import type {
  UtilityV2CalibrationExport,
  UtilityV2ComputeInput,
  UtilityV2ComputeOptions,
} from "./types.js";

export function exportUtilityV2Calibration(
  input: UtilityV2ComputeInput,
  options?: UtilityV2ComputeOptions,
): UtilityV2CalibrationExport {
  const modelConfig = resolveUtilityV2ModelConfig(options?.modelConfig);
  const result = computeUtilityV2(input, { modelConfig });
  return {
    schemaVersion: UTILITY_V2_SCHEMA_VERSION,
    algorithmVersion: result.algorithmVersion,
    modelConfig,
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
