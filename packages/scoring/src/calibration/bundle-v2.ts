/**
 * Calibration Input Bundle V2 — root manifest + content-addressed artifact refs.
 * Provider-free replay graph. Does not silently convert V1 bundles.
 */

import { createHash } from "node:crypto";
import type { ScoreModelConfigV1 } from "../types.js";
import type { CalibrationBacktestMode, CalibrationModelRef, QualitativeLabel } from "./types.js";
import type { CohortManifest } from "./manifest.js";
import type { ScoringPublicDimension } from "../dimensions/v2/shadow-record.js";
import type {
  scoringDimensionConfigFingerprints,
  scoringDimensionConfigSet,
} from "../model-config/index.js";
import {
  createDefaultscoringDimensionConfigSet,
  parsescoringDimensionConfigSet,
  resolveScoreModelV2DimensionConfigs,
} from "../model-config/index.js";
import { ModelConfigValidationError, isRecord as isConfigRecord } from "../model-config/validate.js";
import { fingerprintPerformanceV2ModelConfig } from "../performance/v2/model-config.js";
import { fingerprintSurvivalV2ModelConfig } from "../survival/v2/model-config.js";
import { fingerprintUtilityV2ModelConfig } from "../utility/v2/model-config.js";
import { fingerprintExperienceV3ModelConfig } from "../experience/v3/model-config.js";

/** Portable Calibration Bundle V2 schema version. */
export const CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION = "2.0.0" as const;

/**
 * Frozen per-dimension model configs for active/draft replay.
 * Provider-free; no DB IDs / timestamps / mutable metadata.
 */
export interface FrozenDimensionModelConfigsV2 {
  schemaVersion: scoringDimensionConfigSet["schemaVersion"];
  configs: scoringDimensionConfigSet;
  fingerprints: scoringDimensionConfigFingerprints;
  algorithmVersions: Record<ScoringPublicDimension, string>;
}

export type CalibrationArtifactClassV2 =
  | "calibration_frozen_export"
  | "evidence_manifest"
  | "run_fact_set"
  | "dimension_replay_export"
  | "other";

/** Supported byte-digest algorithms for CalibrationContentRefV2. */
export type ArtifactDigestAlgorithmV2 = "sha256";

/** Content-addressed reference — bytes live in artifact-store, not JSONB. */
export interface CalibrationContentRefV2 {
  /**
   * Primary resolver lookup key = durable CAS key.
   * For new freezes this is the sha256 hex of exact stored bytes (no algorithm prefix).
   */
  contentHash: string;
  /**
   * Domain identity when distinct from byte digest
   * (e.g. EvidenceManifest.contentHash from hash-input schema).
   */
  logicalContentHash?: string | null;
  /** Exact stored-byte digest — format `sha256:<64hex>`. */
  byteDigest?: string | null;
  digestAlgorithm?: ArtifactDigestAlgorithmV2 | null;
  /** Optional storage URI when already written to artifact-store. */
  storageUri?: string | null;
  byteLength?: number | null;
  artifactClass: CalibrationArtifactClassV2;
  schemaVersion?: string | null;
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const SHA256_BYTE_DIGEST_RE = /^sha256:([a-f0-9]{64})$/i;

/** SHA-256 hex of exact bytes (no algorithm prefix). */
export function computeArtifactSha256Hex(bytes: Uint8Array | Buffer | string): string {
  const buf =
    typeof bytes === "string"
      ? Buffer.from(bytes, "utf8")
      : Buffer.isBuffer(bytes)
        ? bytes
        : Buffer.from(bytes);
  return createHash("sha256").update(buf).digest("hex");
}

/** Format a durable byte digest as `sha256:<hex>`. */
export function formatArtifactByteDigest(hex: string): string {
  return `sha256:${hex.toLowerCase()}`;
}

/**
 * Parse `sha256:<64hex>` → lowercase hex.
 * Returns null for unsupported/malformed digests (fail closed at call site).
 */
export function parseArtifactByteDigest(byteDigest: string): {
  algorithm: ArtifactDigestAlgorithmV2;
  hex: string;
} | null {
  const match = SHA256_BYTE_DIGEST_RE.exec(byteDigest.trim());
  if (!match) return null;
  return { algorithm: "sha256", hex: match[1]!.toLowerCase() };
}

/**
 * Build an integrity-bound content ref from exact stored bytes.
 * `contentHash` is always the durable CAS key (byte digest hex).
 */
export function buildCalibrationContentRefV2(input: {
  bytes: Uint8Array | Buffer | string;
  artifactClass: CalibrationArtifactClassV2;
  logicalContentHash?: string | null;
  schemaVersion?: string | null;
  storageUri?: string | null;
}): CalibrationContentRefV2 {
  const buf =
    typeof input.bytes === "string"
      ? Buffer.from(input.bytes, "utf8")
      : Buffer.isBuffer(input.bytes)
        ? input.bytes
        : Buffer.from(input.bytes);
  const hex = computeArtifactSha256Hex(buf);
  return {
    contentHash: hex,
    logicalContentHash: input.logicalContentHash ?? null,
    byteDigest: formatArtifactByteDigest(hex),
    digestAlgorithm: "sha256",
    storageUri: input.storageUri ?? null,
    byteLength: buf.byteLength,
    artifactClass: input.artifactClass,
    schemaVersion: input.schemaVersion ?? null,
  };
}

export interface FrozenSeasonBindingV2 {
  seasonId: string;
  seasonSlug: string;
  region?: string | null;
}

export interface FrozenPolicyCatalogVersionsV2 {
  difficultyPolicies: Array<{ id: string; version: string }>;
  abilityCatalogVersions: string[];
  mechanicCatalogVersions: string[];
  confidenceAlgorithmVersions: Record<string, string>;
  dimensionAlgorithmVersions: Partial<Record<ScoringPublicDimension, string>>;
}

export interface CalibrationMemberReplayV2 {
  memberId: string;
  characterId: string | null;
  expectedLabel: QualitativeLabel;
  rationale: string;
  role: "DPS" | "TANK" | "HEALER" | null;
  classSlug: string | null;
  specSlug: string | null;
  included: boolean;
  exclusionCode: string | null;
  evidenceCutoffAt: string | null;
  /** Frozen EvidenceManifestV2 document hash (+ optional artifact ref). */
  manifest: CalibrationContentRefV2;
  /** Fact-set document refs (one per slot/family). */
  factSets: CalibrationContentRefV2[];
  /** Optional dimension calibration export refs for provider-free replay. */
  dimensionExports: Partial<Record<ScoringPublicDimension, CalibrationContentRefV2>>;
  /** Optional previous V1 snapshot id for comparison modes. */
  previousSnapshotId?: string | null;
}

export interface CalibrationInputBundleV2 {
  schemaVersion: typeof CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION;
  generatedAt: string;
  evidenceCutoffAt: string;
  source: "fixture" | "persisted-export";
  mode?: CalibrationBacktestMode;
  deterministicSeed: number;
  cohort: CohortManifest;
  season: FrozenSeasonBindingV2;
  activeModel: CalibrationModelRef | null;
  evaluationModel: CalibrationModelRef | null;
  /**
   * Frozen ACTIVE dimension configs for active-versus-draft replay.
   * When absent, resolved from activeModel.config.scoring (strict) or defaults.
   */
  activeDimensionConfigs?: FrozenDimensionModelConfigsV2 | null;
  /**
   * Frozen DRAFT/evaluation dimension configs for active-versus-draft replay.
   */
  evaluationDimensionConfigs?: FrozenDimensionModelConfigsV2 | null;
  policies: FrozenPolicyCatalogVersionsV2;
  members: CalibrationMemberReplayV2[];
  /**
   * Optional package of large payloads stored outside the root JSON.
   * Root remains bounded for CalibrationRun.inputBundle JSONB.
   */
  artifactPackage?: CalibrationContentRefV2 | null;
  /** SHA-256 of canonical root (excludes this field). */
  bundleHash: string;
}

/** Build a frozen dimension-config snapshot from a resolved config set. */
export function freezeDimensionModelConfigsV2(
  configs: scoringDimensionConfigSet,
  fingerprints: scoringDimensionConfigFingerprints,
): FrozenDimensionModelConfigsV2 {
  return {
    schemaVersion: configs.schemaVersion,
    configs: structuredClone(configs),
    fingerprints: { ...fingerprints },
    algorithmVersions: {
      PERFORMANCE: configs.performance.algorithmVersion,
      SURVIVAL: configs.survival.algorithmVersion,
      UTILITY: configs.utility.algorithmVersion,
      EXPERIENCE: configs.experience.algorithmVersion,
    },
  };
}

function fingerprintSet(configs: scoringDimensionConfigSet): scoringDimensionConfigFingerprints {
  return {
    performance: fingerprintPerformanceV2ModelConfig(configs.performance),
    survival: fingerprintSurvivalV2ModelConfig(configs.survival),
    utility: fingerprintUtilityV2ModelConfig(configs.utility),
    experience: fingerprintExperienceV3ModelConfig(configs.experience),
  };
}

/**
 * Strict replay-boundary re-parse.
 * Never trusts a previously typed JS object — serializes first, then deep-parses
 * all four dimension configs, recomputes fingerprints, and verifies claimed hashes.
 */
export function strictReparseFrozenDimensionConfigs(
  source: unknown,
): FrozenDimensionModelConfigsV2 {
  if (source == null) {
    throw new ModelConfigValidationError("scoring_SET", [
      "missing dimension config set for strict re-parse",
    ]);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(JSON.stringify(source));
  } catch {
    throw new ModelConfigValidationError("scoring_SET", [
      "dimension config set is not JSON-serializable",
    ]);
  }
  if (!isConfigRecord(raw)) {
    throw new ModelConfigValidationError("scoring_SET", [
      "dimension config set must be an object",
    ]);
  }

  const claimedFingerprints = isConfigRecord(raw.fingerprints)
    ? (raw.fingerprints as unknown as scoringDimensionConfigFingerprints)
    : null;
  const claimedAlgorithms = isConfigRecord(raw.algorithmVersions)
    ? (raw.algorithmVersions as Record<string, unknown>)
    : null;

  const configDoc = isConfigRecord(raw.configs)
    ? {
        schemaVersion: raw.configs.schemaVersion ?? raw.schemaVersion,
        performance: raw.configs.performance,
        survival: raw.configs.survival,
        utility: raw.configs.utility,
        experience: raw.configs.experience,
      }
    : {
        schemaVersion: raw.schemaVersion,
        performance: raw.performance,
        survival: raw.survival,
        utility: raw.utility,
        experience: raw.experience,
      };

  const configs = parsescoringDimensionConfigSet(configDoc);
  const fingerprints = fingerprintSet(configs);
  const frozen = freezeDimensionModelConfigsV2(configs, fingerprints);

  if (claimedFingerprints) {
    for (const dim of ["performance", "survival", "utility", "experience"] as const) {
      const claimed = claimedFingerprints[dim];
      if (typeof claimed !== "string" || claimed !== fingerprints[dim]) {
        throw new ModelConfigValidationError("scoring_SET", [
          `config fingerprint mismatch for ${dim}: claimed=${String(claimed)} computed=${fingerprints[dim]}`,
        ]);
      }
    }
  }

  if (claimedAlgorithms) {
    for (const dim of ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as const) {
      const claimed = claimedAlgorithms[dim];
      const expected = frozen.algorithmVersions[dim];
      if (typeof claimed === "string" && claimed !== expected) {
        throw new ModelConfigValidationError("scoring_SET", [
          `algorithmVersion mismatch for ${dim}: claimed=${claimed} computed=${expected}`,
        ]);
      }
    }
  }

  return frozen;
}

/**
 * Resolve frozen dimension configs for one model side.
 * calibration-strict fails closed when scoring is missing from the model.
 * Always re-parses through strictReparseFrozenDimensionConfigs before return.
 */
export function resolveFrozenDimensionConfigsForModel(
  model: CalibrationModelRef | null,
  mode: "phase1-default" | "calibration-strict",
): FrozenDimensionModelConfigsV2 {
  if (!model) {
    if (mode === "calibration-strict") {
      throw new ModelConfigValidationError("scoring_SET", [
        "model reference required for calibration-strict config resolution",
      ]);
    }
    const defaults = createDefaultscoringDimensionConfigSet();
    const resolved = resolveScoreModelV2DimensionConfigs(
      { scoring: defaults } as unknown as ScoreModelConfigV1,
      "phase1-default",
    );
    return strictReparseFrozenDimensionConfigs(
      freezeDimensionModelConfigsV2(resolved.configs, resolved.fingerprints),
    );
  }
  const resolved = resolveScoreModelV2DimensionConfigs(model.config, mode);
  return strictReparseFrozenDimensionConfigs(
    freezeDimensionModelConfigsV2(resolved.configs, resolved.fingerprints),
  );
}

export type CalibrationPreflightSeverityV2 = "BLOCKING" | "WARNING" | "INFO";

export type CalibrationPreflightCodeV2 =
  | "MISSING_ARTIFACT"
  | "HASH_MISMATCH"
  | "PROVIDER_WORK_REQUIRED"
  | "INSUFFICIENT_COVERAGE"
  | "INCOMPATIBLE_SEASON"
  | "INCOMPATIBLE_MODEL"
  | "INCOMPATIBLE_SPEC"
  | "MISSING_ALGORITHM_VERSION"
  | "MISSING_CATALOG_VERSION"
  | "DUPLICATE_FROZEN_IDENTITY"
  | "ACCOUNT_SPLIT_CONFLICT"
  | "LABEL_LEAKAGE"
  | "LABEL_FROM_SCORE"
  | "SOURCE_MODEL_IMMUTABLE"
  | "UNSUPPORTED_MODE"
  | "INVALID_BUNDLE"
  | "MISSING_MEMBER_LABEL"
  | "MEMBER_EXCLUDED";

export interface CalibrationPreflightIssueV2 {
  code: CalibrationPreflightCodeV2;
  severity: CalibrationPreflightSeverityV2;
  memberId: string | null;
  message: string;
}

export interface CalibrationBundleV2ValidationResult {
  ok: boolean;
  errors: CalibrationPreflightIssueV2[];
  bundle: CalibrationInputBundleV2 | null;
}

export interface CalibrationBundleV2PreflightResult {
  ok: boolean;
  blocking: CalibrationPreflightIssueV2[];
  warnings: CalibrationPreflightIssueV2[];
  info: CalibrationPreflightIssueV2[];
}

export interface ArtifactResolverV2 {
  /**
   * Resolve artifact bytes by content hash.
   * Must not call providers / refresh.
   */
  resolve(contentHash: string): Promise<{ bytes: Uint8Array; contentHash: string } | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function computeCalibrationBundleV2Hash(
  bundle: Omit<CalibrationInputBundleV2, "bundleHash">,
): string {
  return createHash("sha256").update(stableStringify(bundle)).digest("hex");
}

function parseContentRef(
  raw: unknown,
  field: string,
  errors: CalibrationPreflightIssueV2[],
  memberId: string | null,
): CalibrationContentRefV2 | null {
  if (!isRecord(raw)) {
    errors.push({
      code: "INVALID_BUNDLE",
      severity: "BLOCKING",
      memberId,
      message: `${field} must be an object`,
    });
    return null;
  }
  const contentHash = asString(raw.contentHash);
  if (!contentHash || !SHA256_HEX_RE.test(contentHash)) {
    errors.push({
      code: "HASH_MISMATCH",
      severity: "BLOCKING",
      memberId,
      message: `${field}.contentHash must be sha256 hex`,
    });
    return null;
  }
  const artifactClass = asString(raw.artifactClass) ?? "other";

  let logicalContentHash: string | null = null;
  if (raw.logicalContentHash != null) {
    const logical = asString(raw.logicalContentHash);
    if (!logical || !SHA256_HEX_RE.test(logical)) {
      errors.push({
        code: "HASH_MISMATCH",
        severity: "BLOCKING",
        memberId,
        message: `${field}.logicalContentHash must be sha256 hex when present`,
      });
      return null;
    }
    logicalContentHash = logical.toLowerCase();
  }

  let digestAlgorithm: ArtifactDigestAlgorithmV2 | null = null;
  if (raw.digestAlgorithm != null) {
    const algo = asString(raw.digestAlgorithm);
    if (algo !== "sha256") {
      errors.push({
        code: "HASH_MISMATCH",
        severity: "BLOCKING",
        memberId,
        message: `${field}.digestAlgorithm unsupported "${String(raw.digestAlgorithm)}" (only sha256)`,
      });
      return null;
    }
    digestAlgorithm = "sha256";
  }

  let byteDigest: string | null = null;
  if (raw.byteDigest != null) {
    const declared = asString(raw.byteDigest);
    if (!declared) {
      errors.push({
        code: "HASH_MISMATCH",
        severity: "BLOCKING",
        memberId,
        message: `${field}.byteDigest must be a non-empty string when present`,
      });
      return null;
    }
    const parsed = parseArtifactByteDigest(declared);
    if (!parsed) {
      errors.push({
        code: "HASH_MISMATCH",
        severity: "BLOCKING",
        memberId,
        message: `${field}.byteDigest must be sha256:<64hex> (unsupported or malformed digest)`,
      });
      return null;
    }
    byteDigest = formatArtifactByteDigest(parsed.hex);
    if (digestAlgorithm == null) digestAlgorithm = parsed.algorithm;
    if (parsed.hex !== contentHash.toLowerCase()) {
      errors.push({
        code: "HASH_MISMATCH",
        severity: "BLOCKING",
        memberId,
        message: `${field}.byteDigest does not match contentHash CAS key`,
      });
      return null;
    }
  }

  return {
    contentHash: contentHash.toLowerCase(),
    logicalContentHash,
    byteDigest,
    digestAlgorithm,
    storageUri: typeof raw.storageUri === "string" ? raw.storageUri : null,
    byteLength: typeof raw.byteLength === "number" ? raw.byteLength : null,
    artifactClass: artifactClass as CalibrationArtifactClassV2,
    schemaVersion: typeof raw.schemaVersion === "string" ? raw.schemaVersion : null,
  };
}

function parseModelRef(
  raw: unknown,
  field: string,
  errors: CalibrationPreflightIssueV2[],
): CalibrationModelRef | null {
  if (raw == null) return null;
  if (!isRecord(raw)) {
    errors.push({
      code: "INVALID_BUNDLE",
      severity: "BLOCKING",
      memberId: null,
      message: `${field} must be an object or null`,
    });
    return null;
  }
  const key = asString(raw.key);
  const status = asString(raw.status);
  if (!key || typeof raw.version !== "number") {
    errors.push({
      code: "INCOMPATIBLE_MODEL",
      severity: "BLOCKING",
      memberId: null,
      message: `${field} requires key and numeric version`,
    });
    return null;
  }
  if (!isRecord(raw.config)) {
    errors.push({
      code: "INCOMPATIBLE_MODEL",
      severity: "BLOCKING",
      memberId: null,
      message: `${field}.config is required`,
    });
    return null;
  }
  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    key,
    version: raw.version,
    status: (status ?? "DRAFT") as CalibrationModelRef["status"],
    config: raw.config as unknown as ScoreModelConfigV1,
    isActive: Boolean(raw.isActive),
  };
}

/**
 * Structural validation of a Calibration Input Bundle V2 root document.
 * Does not resolve artifacts — use preflightCalibrationBundleV2 for that.
 */
export function validateCalibrationInputBundleV2(
  input: unknown,
): CalibrationBundleV2ValidationResult {
  const errors: CalibrationPreflightIssueV2[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_BUNDLE",
          severity: "BLOCKING",
          memberId: null,
          message: "bundle must be an object",
        },
      ],
      bundle: null,
    };
  }

  const schemaVersion = asString(input.schemaVersion);
  if (schemaVersion !== CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION) {
    errors.push({
      code: "INVALID_BUNDLE",
      severity: "BLOCKING",
      memberId: null,
      message: `unsupported V2 schemaVersion "${schemaVersion ?? ""}" (expected ${CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION})`,
    });
  }

  const generatedAt = asString(input.generatedAt);
  const evidenceCutoffAt = asString(input.evidenceCutoffAt);
  if (!generatedAt) {
    errors.push({
      code: "INVALID_BUNDLE",
      severity: "BLOCKING",
      memberId: null,
      message: "generatedAt is required",
    });
  }
  if (!evidenceCutoffAt) {
    errors.push({
      code: "INVALID_BUNDLE",
      severity: "BLOCKING",
      memberId: null,
      message: "evidenceCutoffAt is required",
    });
  }

  const source = asString(input.source);
  if (source !== "fixture" && source !== "persisted-export") {
    errors.push({
      code: "INVALID_BUNDLE",
      severity: "BLOCKING",
      memberId: null,
      message: 'source must be "fixture" or "persisted-export"',
    });
  }

  if (input.mode === "refresh-then-evaluate") {
    errors.push({
      code: "UNSUPPORTED_MODE",
      severity: "BLOCKING",
      memberId: null,
      message: "refresh-then-evaluate requires provider work and is unsupported",
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
        severity: "BLOCKING",
        memberId: null,
        message: `unknown mode "${String(input.mode)}"`,
      });
    }
  }

  if (typeof input.deterministicSeed !== "number" || !Number.isFinite(input.deterministicSeed)) {
    errors.push({
      code: "INVALID_BUNDLE",
      severity: "BLOCKING",
      memberId: null,
      message: "deterministicSeed must be a finite number",
    });
  }

  if (!isRecord(input.cohort)) {
    errors.push({
      code: "INVALID_BUNDLE",
      severity: "BLOCKING",
      memberId: null,
      message: "cohort manifest is required",
    });
  }

  if (!isRecord(input.season) || !asString(input.season.seasonId) || !asString(input.season.seasonSlug)) {
    errors.push({
      code: "INCOMPATIBLE_SEASON",
      severity: "BLOCKING",
      memberId: null,
      message: "season.seasonId and season.seasonSlug are required",
    });
  }

  if (!isRecord(input.policies)) {
    errors.push({
      code: "MISSING_CATALOG_VERSION",
      severity: "BLOCKING",
      memberId: null,
      message: "policies object is required",
    });
  }

  const activeModel = parseModelRef(input.activeModel, "activeModel", errors);
  const evaluationModel = parseModelRef(input.evaluationModel, "evaluationModel", errors);

  // Source ACTIVE models must remain immutable references — evaluation may be DRAFT only when creating.
  if (activeModel && activeModel.status === "DRAFT" && activeModel.isActive) {
    errors.push({
      code: "SOURCE_MODEL_IMMUTABLE",
      severity: "BLOCKING",
      memberId: null,
      message: "activeModel cannot be DRAFT while isActive=true",
    });
  }

  if (!Array.isArray(input.members)) {
    errors.push({
      code: "INVALID_BUNDLE",
      severity: "BLOCKING",
      memberId: null,
      message: "members must be an array",
    });
  }

  const members: CalibrationMemberReplayV2[] = [];
  /** Included-member character ownership for ACCOUNT_SPLIT_CONFLICT only. */
  const characterOwners = new Map<string, string>();

  if (Array.isArray(input.members)) {
    for (const rawMember of input.members) {
      if (!isRecord(rawMember)) {
        errors.push({
          code: "INVALID_BUNDLE",
          severity: "BLOCKING",
          memberId: null,
          message: "member must be an object",
        });
        continue;
      }
      const memberId = asString(rawMember.memberId);
      if (!memberId) {
        errors.push({
          code: "INVALID_BUNDLE",
          severity: "BLOCKING",
          memberId: null,
          message: "member.memberId is required",
        });
        continue;
      }
      const expectedLabel = asString(rawMember.expectedLabel);
      if (
        expectedLabel !== "excellent" &&
        expectedLabel !== "good" &&
        expectedLabel !== "average" &&
        expectedLabel !== "weak" &&
        expectedLabel !== "overrated"
      ) {
        errors.push({
          code: "MISSING_MEMBER_LABEL",
          severity: "BLOCKING",
          memberId,
          message: "expectedLabel must be an independent qualitative label",
        });
      }

      // Fail closed: labels must never be numeric scores or grades derived from scores.
      if (typeof rawMember.expectedScore === "number" || rawMember.labelFromScore === true) {
        errors.push({
          code: "LABEL_FROM_SCORE",
          severity: "BLOCKING",
          memberId,
          message: "labels must not be derived from produced scores",
        });
      }

      const manifest = parseContentRef(rawMember.manifest, "member.manifest", errors, memberId);
      const factSetsRaw = Array.isArray(rawMember.factSets) ? rawMember.factSets : [];
      const factSets: CalibrationContentRefV2[] = [];
      for (let i = 0; i < factSetsRaw.length; i++) {
        const ref = parseContentRef(factSetsRaw[i], `member.factSets[${i}]`, errors, memberId);
        if (ref) factSets.push(ref);
      }

      const dimensionExports: CalibrationMemberReplayV2["dimensionExports"] = {};
      if (isRecord(rawMember.dimensionExports)) {
        for (const [dim, refRaw] of Object.entries(rawMember.dimensionExports)) {
          const ref = parseContentRef(refRaw, `member.dimensionExports.${dim}`, errors, memberId);
          if (ref) {
            dimensionExports[dim as ScoringPublicDimension] = ref;
          }
        }
      }

      const characterId =
        typeof rawMember.characterId === "string" ? rawMember.characterId : null;
      if (characterId && rawMember.included !== false) {
        const priorMember = characterOwners.get(characterId);
        if (priorMember && priorMember !== memberId) {
          errors.push({
            code: "ACCOUNT_SPLIT_CONFLICT",
            severity: "BLOCKING",
            memberId,
            message: `characterId ${characterId} already claimed by member ${priorMember}`,
          });
        } else {
          characterOwners.set(characterId, memberId);
        }
      }

      if (!manifest || !expectedLabel) continue;

      members.push({
        memberId,
        characterId,
        expectedLabel: expectedLabel as QualitativeLabel,
        rationale: typeof rawMember.rationale === "string" ? rawMember.rationale : "",
        role:
          rawMember.role === "DPS" ||
          rawMember.role === "TANK" ||
          rawMember.role === "HEALER" ||
          rawMember.role === "UNKNOWN"
            ? rawMember.role === "UNKNOWN"
              ? null
              : rawMember.role
            : null,
        classSlug: typeof rawMember.classSlug === "string" ? rawMember.classSlug : null,
        specSlug: typeof rawMember.specSlug === "string" ? rawMember.specSlug : null,
        included: rawMember.included !== false,
        exclusionCode: typeof rawMember.exclusionCode === "string" ? rawMember.exclusionCode : null,
        evidenceCutoffAt:
          typeof rawMember.evidenceCutoffAt === "string" ? rawMember.evidenceCutoffAt : null,
        manifest,
        factSets,
        dimensionExports,
        previousSnapshotId:
          typeof rawMember.previousSnapshotId === "string" ? rawMember.previousSnapshotId : null,
      });
    }
  }

  if (errors.some((e) => e.severity === "BLOCKING")) {
    return { ok: false, errors, bundle: null };
  }

  const policies = input.policies as FrozenPolicyCatalogVersionsV2;
  const cohort = input.cohort as CohortManifest;
  const season = input.season as FrozenSeasonBindingV2;

  const activeDimensionConfigs = isRecord(input.activeDimensionConfigs)
    ? (structuredClone(input.activeDimensionConfigs) as unknown as FrozenDimensionModelConfigsV2)
    : input.activeDimensionConfigs === null
      ? null
      : undefined;
  const evaluationDimensionConfigs = isRecord(input.evaluationDimensionConfigs)
    ? (structuredClone(input.evaluationDimensionConfigs) as unknown as FrozenDimensionModelConfigsV2)
    : input.evaluationDimensionConfigs === null
      ? null
      : undefined;

  const withoutHash: Omit<CalibrationInputBundleV2, "bundleHash"> = {
    schemaVersion: CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION,
    generatedAt: generatedAt!,
    evidenceCutoffAt: evidenceCutoffAt!,
    source: source as "fixture" | "persisted-export",
    mode,
    deterministicSeed: input.deterministicSeed as number,
    cohort,
    season,
    activeModel,
    evaluationModel,
    ...(activeDimensionConfigs !== undefined
      ? { activeDimensionConfigs }
      : {}),
    ...(evaluationDimensionConfigs !== undefined
      ? { evaluationDimensionConfigs }
      : {}),
    policies,
    members,
    artifactPackage: input.artifactPackage
      ? parseContentRef(input.artifactPackage, "artifactPackage", errors, null)
      : null,
  };

  const expectedHash = computeCalibrationBundleV2Hash(withoutHash);
  const providedHash = asString(input.bundleHash);
  if (providedHash && providedHash.toLowerCase() !== expectedHash) {
    errors.push({
      code: "HASH_MISMATCH",
      severity: "BLOCKING",
      memberId: null,
      message: `bundleHash mismatch: provided=${providedHash} computed=${expectedHash}`,
    });
    return { ok: false, errors, bundle: null };
  }

  return {
    ok: true,
    errors,
    bundle: { ...withoutHash, bundleHash: expectedHash },
  };
}

export function buildCalibrationInputBundleV2(
  input: Omit<CalibrationInputBundleV2, "schemaVersion" | "bundleHash">,
): CalibrationInputBundleV2 {
  // Route through validate so hash canonicalization matches round-trip checks.
  const validated = validateCalibrationInputBundleV2({
    ...input,
    schemaVersion: CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION,
  });
  if (!validated.ok || !validated.bundle) {
    throw new Error(
      `Invalid Calibration Bundle V2: ${validated.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return validated.bundle;
}

export function buildFrozenRunIdentityKey(identity: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
}): string {
  return `${identity.reportCode}:${identity.fightId}:${identity.reportRevision}`;
}

export interface ExtractedFrozenRunIdentity {
  key: string;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  slotIndex: number | null;
  slotId: string | null;
}

/**
 * Extract SELECTED frozen run identities from a resolved EvidenceManifestV2 document.
 * Does not treat manifest.contentHash as run identity.
 */
export function extractSelectedFrozenRunIdentities(
  manifestDocument: unknown,
): ExtractedFrozenRunIdentity[] {
  if (!isRecord(manifestDocument) || !Array.isArray(manifestDocument.slots)) {
    return [];
  }
  const out: ExtractedFrozenRunIdentity[] = [];
  for (const slot of manifestDocument.slots) {
    if (!isRecord(slot)) continue;
    if (slot.state !== "SELECTED") continue;
    const identity = slot.identity;
    if (!isRecord(identity)) continue;
    const reportCode = asString(identity.reportCode);
    const fightId =
      typeof identity.fightId === "number" && Number.isFinite(identity.fightId)
        ? identity.fightId
        : null;
    const reportRevision =
      typeof identity.reportRevision === "number" && Number.isFinite(identity.reportRevision)
        ? identity.reportRevision
        : null;
    if (!reportCode || fightId == null || reportRevision == null) continue;
    const slotIndex =
      typeof slot.slotIndex === "number" && Number.isFinite(slot.slotIndex)
        ? slot.slotIndex
        : null;
    const slotId = asString(slot.slotId);
    out.push({
      key: buildFrozenRunIdentityKey({ reportCode, fightId, reportRevision }),
      reportCode,
      fightId,
      reportRevision,
      slotIndex,
      slotId,
    });
  }
  return out;
}

interface FrozenIdentityClaim {
  memberId: string;
  characterId: string | null;
  manifestContentHash: string;
  slotIndex: number | null;
  slotId: string | null;
}

/**
 * Detect DUPLICATE_FROZEN_IDENTITY within and across included members.
 * Same key is allowed only when ownership resolves to the same included member
 * (and same characterId when both sides declare one).
 */
export function collectDuplicateFrozenIdentityIssues(
  claims: Array<FrozenIdentityClaim & { key: string }>,
): CalibrationPreflightIssueV2[] {
  const issues: CalibrationPreflightIssueV2[] = [];
  const byKey = new Map<string, FrozenIdentityClaim[]>();

  for (const claim of claims) {
    const list = byKey.get(claim.key) ?? [];
    list.push(claim);
    byKey.set(claim.key, list);
  }

  for (const [key, list] of byKey) {
    // Intra-member duplicates (malformed manifest with repeated selected identity).
    const byMember = new Map<string, FrozenIdentityClaim[]>();
    for (const claim of list) {
      const bucket = byMember.get(claim.memberId) ?? [];
      bucket.push(claim);
      byMember.set(claim.memberId, bucket);
    }
    for (const [memberId, memberClaims] of byMember) {
      if (memberClaims.length < 2) continue;
      const slots = memberClaims
        .map((c) => c.slotIndex ?? c.slotId ?? "?")
        .join(",");
      issues.push({
        code: "DUPLICATE_FROZEN_IDENTITY",
        severity: "BLOCKING",
        memberId,
        message: [
          `duplicate frozen identity ${key} within member ${memberId}`,
          `manifest=${memberClaims[0]!.manifestContentHash}`,
          `slots=${slots}`,
        ].join("; "),
      });
    }

    // Cross-member: incompatible ownership.
    const uniqueMembers = [...byMember.keys()];
    if (uniqueMembers.length < 2) continue;
    const first = list[0]!;
    for (let i = 1; i < list.length; i++) {
      const other = list[i]!;
      if (other.memberId === first.memberId) continue;
      const sameCharacter =
        first.characterId != null &&
        other.characterId != null &&
        first.characterId === other.characterId;
      // Same character claimed by two included members is ACCOUNT_SPLIT elsewhere.
      // Different / missing character ownership with shared frozen run → blocking.
      if (sameCharacter) {
        // Still incompatible: two included members must not share the same frozen run.
        issues.push({
          code: "DUPLICATE_FROZEN_IDENTITY",
          severity: "BLOCKING",
          memberId: other.memberId,
          message: [
            `duplicate frozen identity ${key}`,
            `firstMember=${first.memberId}`,
            `conflictingMember=${other.memberId}`,
            `firstManifest=${first.manifestContentHash}`,
            `conflictingManifest=${other.manifestContentHash}`,
            `firstSlot=${first.slotIndex ?? first.slotId ?? "unknown"}`,
            `conflictingSlot=${other.slotIndex ?? other.slotId ?? "unknown"}`,
          ].join("; "),
        });
        break;
      }
      issues.push({
        code: "DUPLICATE_FROZEN_IDENTITY",
        severity: "BLOCKING",
        memberId: other.memberId,
        message: [
          `duplicate frozen identity ${key}`,
          `firstMember=${first.memberId}`,
          `conflictingMember=${other.memberId}`,
          `firstManifest=${first.manifestContentHash}`,
          `conflictingManifest=${other.manifestContentHash}`,
          `firstSlot=${first.slotIndex ?? first.slotId ?? "unknown"}`,
          `conflictingSlot=${other.slotIndex ?? other.slotId ?? "unknown"}`,
        ].join("; "),
      });
      break;
    }
  }

  return issues;
}

/**
 * Preflight V2 — verifies artifact hashes via resolver; never refreshes providers.
 * Always digests resolved bytes; never trusts a declared hash alone.
 */
export async function preflightCalibrationBundleV2(input: {
  bundle: CalibrationInputBundleV2;
  resolver: ArtifactResolverV2;
  /** When true, any missing algorithm/catalog version is blocking. */
  requireCatalogVersions?: boolean;
  /**
   * When true, refs must declare byteDigest + digestAlgorithm and match
   * the computed digest of resolved bytes. Missing integrity fields fail closed.
   */
  requireByteIntegrity?: boolean;
}): Promise<CalibrationBundleV2PreflightResult> {
  const blocking: CalibrationPreflightIssueV2[] = [];
  const warnings: CalibrationPreflightIssueV2[] = [];
  const info: CalibrationPreflightIssueV2[] = [];
  const requireByteIntegrity = input.requireByteIntegrity === true;

  if (input.bundle.mode === undefined) {
    info.push({
      code: "INVALID_BUNDLE",
      severity: "INFO",
      memberId: null,
      message: "mode omitted — caller must supply an explicit mode at run time",
    });
  }

  const policies = input.bundle.policies;
  if (input.requireCatalogVersions !== false) {
    if (
      !policies.abilityCatalogVersions?.length ||
      !policies.mechanicCatalogVersions?.length
    ) {
      blocking.push({
        code: "MISSING_CATALOG_VERSION",
        severity: "BLOCKING",
        memberId: null,
        message: "abilityCatalogVersions and mechanicCatalogVersions are required",
      });
    }
    const dims = policies.dimensionAlgorithmVersions ?? {};
    for (const dim of ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as const) {
      if (!dims[dim]) {
        blocking.push({
          code: "MISSING_ALGORITHM_VERSION",
          severity: "BLOCKING",
          memberId: null,
          message: `policies.dimensionAlgorithmVersions.${dim} is required`,
        });
      }
    }
  }

  async function assertResolvable(
    ref: CalibrationContentRefV2,
    memberId: string | null,
    label: string,
  ) {
    if (ref.digestAlgorithm != null && ref.digestAlgorithm !== "sha256") {
      blocking.push({
        code: "HASH_MISMATCH",
        severity: "BLOCKING",
        memberId,
        message: `unsupported digestAlgorithm "${ref.digestAlgorithm}" for ${label}`,
      });
      return null;
    }

    if (requireByteIntegrity) {
      if (!ref.byteDigest || ref.digestAlgorithm !== "sha256") {
        blocking.push({
          code: "HASH_MISMATCH",
          severity: "BLOCKING",
          memberId,
          message: `missing byte integrity fields (byteDigest + digestAlgorithm) for ${label}`,
        });
        return null;
      }
    }

    if (ref.byteDigest) {
      const parsed = parseArtifactByteDigest(ref.byteDigest);
      if (!parsed) {
        blocking.push({
          code: "HASH_MISMATCH",
          severity: "BLOCKING",
          memberId,
          message: `unsupported or malformed byteDigest for ${label}`,
        });
        return null;
      }
    }

    const resolved = await input.resolver.resolve(ref.contentHash);
    if (!resolved) {
      blocking.push({
        code: "MISSING_ARTIFACT",
        severity: "BLOCKING",
        memberId,
        message: `missing artifact for ${label}: ${ref.contentHash}`,
      });
      return null;
    }

    // Always recompute — never trust declared or resolver-echoed hashes alone.
    const computedHex = computeArtifactSha256Hex(resolved.bytes);

    if (resolved.contentHash.toLowerCase() !== computedHex) {
      blocking.push({
        code: "HASH_MISMATCH",
        severity: "BLOCKING",
        memberId,
        message: `resolver returned non-computed contentHash for ${label}`,
      });
      return null;
    }

    if (computedHex !== ref.contentHash.toLowerCase()) {
      blocking.push({
        code: "HASH_MISMATCH",
        severity: "BLOCKING",
        memberId,
        message: `artifact byte digest mismatch for ${label}: computed=${computedHex} ref.contentHash=${ref.contentHash}`,
      });
      return null;
    }

    if (ref.byteDigest) {
      const parsed = parseArtifactByteDigest(ref.byteDigest);
      if (!parsed || parsed.hex !== computedHex) {
        blocking.push({
          code: "HASH_MISMATCH",
          severity: "BLOCKING",
          memberId,
          message: `byteDigest mismatch for ${label}`,
        });
        return null;
      }
    }

    if (
      ref.byteLength != null &&
      Number.isFinite(ref.byteLength) &&
      ref.byteLength !== resolved.bytes.byteLength
    ) {
      blocking.push({
        code: "HASH_MISMATCH",
        severity: "BLOCKING",
        memberId,
        message: `artifact byteLength mismatch for ${label}: declared=${ref.byteLength} actual=${resolved.bytes.byteLength}`,
      });
      return null;
    }

    if (ref.logicalContentHash && ref.artifactClass === "evidence_manifest") {
      try {
        const document: unknown = JSON.parse(Buffer.from(resolved.bytes).toString("utf8"));
        if (isRecord(document) && typeof document.contentHash === "string") {
          if (document.contentHash.toLowerCase() !== ref.logicalContentHash.toLowerCase()) {
            blocking.push({
              code: "HASH_MISMATCH",
              severity: "BLOCKING",
              memberId,
              message: `logicalContentHash mismatch for ${label}: document=${document.contentHash} ref=${ref.logicalContentHash}`,
            });
            return null;
          }
        } else if (requireByteIntegrity) {
          blocking.push({
            code: "HASH_MISMATCH",
            severity: "BLOCKING",
            memberId,
            message: `manifest artifact for ${label} lacks document.contentHash to verify logicalContentHash`,
          });
          return null;
        }
      } catch {
        blocking.push({
          code: "INVALID_BUNDLE",
          severity: "BLOCKING",
          memberId,
          message: `manifest artifact for ${label} is not valid JSON (logical hash check)`,
        });
        return null;
      }
    }

    return resolved;
  }

  if (input.bundle.artifactPackage) {
    await assertResolvable(input.bundle.artifactPackage, null, "artifactPackage");
  }

  const included = input.bundle.members.filter((m) => m.included);
  if (included.length === 0) {
    blocking.push({
      code: "INSUFFICIENT_COVERAGE",
      severity: "BLOCKING",
      memberId: null,
      message: "no included members in bundle",
    });
  }

  const frozenClaims: Array<FrozenIdentityClaim & { key: string }> = [];

  for (const member of included) {
    const resolvedManifest = await assertResolvable(member.manifest, member.memberId, "manifest");
    for (const [i, fs] of member.factSets.entries()) {
      await assertResolvable(fs, member.memberId, `factSets[${i}]`);
    }
    for (const [dim, ref] of Object.entries(member.dimensionExports ?? {})) {
      if (ref) await assertResolvable(ref, member.memberId, `dimensionExports.${dim}`);
    }

    if (!member.expectedLabel) {
      blocking.push({
        code: "MISSING_MEMBER_LABEL",
        severity: "BLOCKING",
        memberId: member.memberId,
        message: "included member missing expectedLabel",
      });
    }

    // Replay must never require provider work.
    if ((member as { providerWorkRequired?: boolean }).providerWorkRequired) {
      blocking.push({
        code: "PROVIDER_WORK_REQUIRED",
        severity: "BLOCKING",
        memberId: member.memberId,
        message: "member requires provider work — forbidden in V2 calibration",
      });
    }

    if (resolvedManifest) {
      let document: unknown = null;
      try {
        document = JSON.parse(Buffer.from(resolvedManifest.bytes).toString("utf8"));
      } catch {
        blocking.push({
          code: "INVALID_BUNDLE",
          severity: "BLOCKING",
          memberId: member.memberId,
          message: `manifest artifact ${member.manifest.contentHash} is not valid JSON`,
        });
      }
      if (document != null) {
        for (const identity of extractSelectedFrozenRunIdentities(document)) {
          frozenClaims.push({
            key: identity.key,
            memberId: member.memberId,
            characterId: member.characterId,
            manifestContentHash: member.manifest.contentHash,
            slotIndex: identity.slotIndex,
            slotId: identity.slotId,
          });
        }
      }
    }
  }

  blocking.push(...collectDuplicateFrozenIdentityIssues(frozenClaims));

  // Active vs draft must share identical evidence (same member refs).
  if (input.bundle.mode === "active-versus-draft") {
    if (!input.bundle.activeModel || !input.bundle.evaluationModel) {
      blocking.push({
        code: "INCOMPATIBLE_MODEL",
        severity: "BLOCKING",
        memberId: null,
        message: "active-versus-draft requires both activeModel and evaluationModel",
      });
    }
  }

  return {
    ok: blocking.length === 0,
    blocking,
    warnings,
    info,
  };
}
