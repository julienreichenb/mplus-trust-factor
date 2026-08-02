/**
 * Explicit Calibration bundle schema dispatch — no silent V1↔V2 conversion.
 */

import {
  validateCalibrationInputBundle,
  type BundleValidationResult,
} from "./bundle.js";
import {
  CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION,
  validateCalibrationInputBundleV2,
  type CalibrationBundleV2ValidationResult,
  type CalibrationInputBundleV2,
} from "./bundle-v2.js";
import {
  CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION,
  type CalibrationInputBundleV1,
} from "./types.js";

export type CalibrationBundleDispatchResult =
  | {
      schemaMajor: 1;
      ok: true;
      bundle: CalibrationInputBundleV1;
      v1: BundleValidationResult;
      v2: null;
    }
  | {
      schemaMajor: 1;
      ok: false;
      bundle: null;
      v1: BundleValidationResult;
      v2: null;
      error: string;
    }
  | {
      schemaMajor: 2;
      ok: true;
      bundle: CalibrationInputBundleV2;
      v1: null;
      v2: CalibrationBundleV2ValidationResult;
    }
  | {
      schemaMajor: 2;
      ok: false;
      bundle: null;
      v1: null;
      v2: CalibrationBundleV2ValidationResult;
      error: string;
    }
  | {
      schemaMajor: "unknown";
      ok: false;
      bundle: null;
      v1: null;
      v2: null;
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Dispatch validation by schemaVersion major.
 * Unknown versions fail closed. V1 is never auto-upgraded to V2.
 */
export function dispatchValidateCalibrationBundle(
  input: unknown,
): CalibrationBundleDispatchResult {
  if (!isRecord(input)) {
    return {
      schemaMajor: "unknown",
      ok: false,
      bundle: null,
      v1: null,
      v2: null,
      error: "bundle must be an object",
    };
  }

  const schemaVersion =
    typeof input.schemaVersion === "string" ? input.schemaVersion.trim() : "";

  if (!schemaVersion) {
    return {
      schemaMajor: "unknown",
      ok: false,
      bundle: null,
      v1: null,
      v2: null,
      error: "schemaVersion is required",
    };
  }

  if (schemaVersion.startsWith("1.")) {
    const v1 = validateCalibrationInputBundle(input);
    if (!v1.ok || !v1.bundle) {
      return {
        schemaMajor: 1,
        ok: false,
        bundle: null,
        v1,
        v2: null,
        error: v1.errors.map((e) => e.message).join("; ") || "invalid V1 bundle",
      };
    }
    return { schemaMajor: 1, ok: true, bundle: v1.bundle, v1, v2: null };
  }

  if (schemaVersion.startsWith("2.")) {
    if (schemaVersion !== CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION) {
      return {
        schemaMajor: 2,
        ok: false,
        bundle: null,
        v1: null,
        v2: {
          ok: false,
          errors: [
            {
              code: "INVALID_BUNDLE",
              severity: "BLOCKING",
              memberId: null,
              message: `unsupported V2 schemaVersion "${schemaVersion}" (expected ${CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION})`,
            },
          ],
          bundle: null,
        },
        error: `unsupported V2 schemaVersion "${schemaVersion}"`,
      };
    }
    const v2 = validateCalibrationInputBundleV2(input);
    if (!v2.ok || !v2.bundle) {
      return {
        schemaMajor: 2,
        ok: false,
        bundle: null,
        v1: null,
        v2,
        error: v2.errors.map((e) => e.message).join("; ") || "invalid V2 bundle",
      };
    }
    return { schemaMajor: 2, ok: true, bundle: v2.bundle, v1: null, v2 };
  }

  return {
    schemaMajor: "unknown",
    ok: false,
    bundle: null,
    v1: null,
    v2: null,
    error: `unsupported schemaVersion "${schemaVersion}" (expected ${CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION} or ${CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION})`,
  };
}
