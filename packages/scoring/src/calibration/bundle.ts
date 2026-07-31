import type { ScoreModelConfigV1 } from "../types.js";
import { validateCohortManifest, type CohortManifest } from "./manifest.js";
import type {
  CalibrationInputBundleV1,
  CalibrationMemberEvidence,
  CalibrationModelRef,
  CalibrationBacktestMode,
  EvidenceValidationIssue,
} from "./types.js";
import { CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION } from "./types.js";

export interface BundleValidationResult {
  ok: boolean;
  errors: EvidenceValidationIssue[];
  bundle: CalibrationInputBundleV1 | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function validateModelRef(
  raw: unknown,
  field: string,
  errors: EvidenceValidationIssue[],
): CalibrationModelRef | undefined {
  if (raw == null) return undefined;
  if (!isRecord(raw)) {
    errors.push({
      code: "INVALID_BUNDLE",
      memberId: null,
      message: `${field} must be an object`,
    });
    return undefined;
  }
  const key = asString(raw.key);
  const status = asString(raw.status);
  if (!key || typeof raw.version !== "number" || !Number.isFinite(raw.version)) {
    errors.push({
      code: "INVALID_BUNDLE",
      memberId: null,
      message: `${field} requires key and numeric version`,
    });
    return undefined;
  }
  if (
    status !== "DRAFT" &&
    status !== "ACTIVE" &&
    status !== "ARCHIVED" &&
    status !== "FIXTURE"
  ) {
    errors.push({
      code: "INVALID_BUNDLE",
      memberId: null,
      message: `${field}.status is invalid`,
    });
    return undefined;
  }
  if (!isRecord(raw.config)) {
    errors.push({
      code: "INVALID_BUNDLE",
      memberId: null,
      message: `${field}.config is required`,
    });
    return undefined;
  }
  if (typeof raw.isActive !== "boolean") {
    errors.push({
      code: "INVALID_BUNDLE",
      memberId: null,
      message: `${field}.isActive must be boolean`,
    });
    return undefined;
  }
  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    key,
    version: raw.version,
    status,
    config: raw.config as unknown as ScoreModelConfigV1,
    isActive: raw.isActive,
  };
}

/**
 * Validate a versioned portable calibration input bundle.
 * Does not evaluate scores — only structural + referential integrity.
 */
export function validateCalibrationInputBundle(input: unknown): BundleValidationResult {
  const errors: EvidenceValidationIssue[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ code: "INVALID_BUNDLE", memberId: null, message: "bundle must be an object" }],
      bundle: null,
    };
  }

  const schemaVersion = asString(input.schemaVersion);
  if (schemaVersion !== CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION) {
    errors.push({
      code: "INVALID_BUNDLE",
      memberId: null,
      message: `unsupported bundle schemaVersion "${schemaVersion ?? ""}" (expected ${CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION})`,
    });
  }

  const generatedAt = asString(input.generatedAt);
  if (!generatedAt) {
    errors.push({
      code: "INVALID_BUNDLE",
      memberId: null,
      message: "generatedAt is required",
    });
  }

  const source = asString(input.source);
  if (source !== "fixture" && source !== "persisted-export") {
    errors.push({
      code: "INVALID_BUNDLE",
      memberId: null,
      message: 'source must be "fixture" or "persisted-export"',
    });
  }

  if (input.mode === "refresh-then-evaluate") {
    errors.push({
      code: "UNSUPPORTED_MODE",
      memberId: null,
      message: "refresh-then-evaluate is unsupported in portable bundles",
    });
  }

  let mode: CalibrationBacktestMode | undefined;
  if (input.mode != null) {
    if (
      input.mode === "persisted-snapshot-only" ||
      input.mode === "draft-model-evaluate" ||
      input.mode === "active-versus-draft"
    ) {
      mode = input.mode;
    } else if (input.mode !== "refresh-then-evaluate") {
      errors.push({
        code: "INVALID_BUNDLE",
        memberId: null,
        message: `unknown mode "${String(input.mode)}"`,
      });
    }
  }

  const manifestResult = validateCohortManifest(input.manifest);
  if (!manifestResult.ok || !manifestResult.manifest) {
    for (const message of manifestResult.errors) {
      errors.push({ code: "INVALID_BUNDLE", memberId: null, message: `manifest: ${message}` });
    }
  }

  if (!isRecord(input.evidenceByMemberId)) {
    errors.push({
      code: "INVALID_BUNDLE",
      memberId: null,
      message: "evidenceByMemberId must be an object",
    });
    return { ok: false, errors, bundle: null };
  }

  const evidenceByMemberId: Record<string, CalibrationMemberEvidence> = {};
  for (const [memberId, raw] of Object.entries(input.evidenceByMemberId)) {
    if (!isRecord(raw)) {
      errors.push({
        code: "INVALID_BUNDLE",
        memberId,
        message: `evidence for ${memberId} must be an object`,
      });
      continue;
    }
    if (raw.memberId !== memberId) {
      errors.push({
        code: "MEMBER_ID_MISMATCH",
        memberId,
        message: `evidence key "${memberId}" !== evidence.memberId "${String(raw.memberId)}"`,
      });
    }
    evidenceByMemberId[memberId] = raw as unknown as CalibrationMemberEvidence;
  }

  const manifest = manifestResult.manifest;
  if (manifest) {
    for (const member of manifest.members) {
      if (!evidenceByMemberId[member.id]) {
        errors.push({
          code: "MISSING_EVIDENCE",
          memberId: member.id,
          message: `missing evidence for member ${member.id}`,
        });
      }
    }
  }

  const activeModel = validateModelRef(input.activeModel, "activeModel", errors);
  const evaluationModel = validateModelRef(input.evaluationModel, "evaluationModel", errors);

  if (
    activeModel &&
    evaluationModel &&
    activeModel.key === evaluationModel.key &&
    activeModel.version === evaluationModel.version &&
    activeModel.isActive &&
    evaluationModel.status === "DRAFT"
  ) {
    errors.push({
      code: "CONFLICTING_MODEL_REFS",
      memberId: null,
      message: "active and evaluation model refs conflict (same key@version marked active+DRAFT)",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors, bundle: null };
  }

  return {
    ok: true,
    errors: [],
    bundle: {
      schemaVersion: CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION,
      manifest: manifest as CohortManifest,
      evidenceByMemberId,
      activeModel,
      evaluationModel,
      generatedAt: generatedAt!,
      source: source as "fixture" | "persisted-export",
      mode,
    },
  };
}

/** Build a validated fixture or export bundle (pure). */
export function buildCalibrationInputBundle(input: {
  manifest: CohortManifest;
  evidenceByMemberId: Map<string, CalibrationMemberEvidence> | Record<string, CalibrationMemberEvidence>;
  activeModel?: CalibrationModelRef;
  evaluationModel?: CalibrationModelRef;
  generatedAt: string;
  source: "fixture" | "persisted-export";
  mode?: CalibrationBacktestMode;
}): CalibrationInputBundleV1 {
  const evidenceByMemberId: Record<string, CalibrationMemberEvidence> =
    input.evidenceByMemberId instanceof Map
      ? Object.fromEntries(input.evidenceByMemberId.entries())
      : { ...input.evidenceByMemberId };

  return {
    schemaVersion: CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION,
    manifest: input.manifest,
    evidenceByMemberId,
    activeModel: input.activeModel,
    evaluationModel: input.evaluationModel,
    generatedAt: input.generatedAt,
    source: input.source,
    mode: input.mode,
  };
}
