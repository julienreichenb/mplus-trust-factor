/**
 * Export-time freeze snapshot — immutable freeze inputs captured at evidence export.
 * Freeze must consume this snapshot, not live ACTIVE model / cohort.members.
 */
import type { ScoreModelConfigV1 } from "../types.js";
import { stableSha256 } from "../model-config/stable-hash.js";
import { algorithmVersionForDimension } from "../dimensions/v2/adapters.js";
import type { ScoringV2PublicDimension } from "../dimensions/v2/shadow-record.js";
import type { CalibrationModelRef } from "./types.js";
import type {
  FrozenDimensionModelConfigsV2,
  FrozenPolicyCatalogVersionsV2,
  FrozenSeasonBindingV2,
} from "./bundle-v2.js";

export const FREEZE_SNAPSHOT_SCHEMA_VERSION = "scoring-v2-freeze-snapshot-v1" as const;

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

export interface FreezeSnapshotMemberV1 {
  id: string;
  externalMemberKey: string | null;
  characterId: string | null;
  region: string;
  realmSlug: string;
  characterName: string;
  expectedLabel: string;
  rationale: string;
  included: boolean;
  exclusionCode: string | null;
  role: string | null;
  classSlug: string | null;
  specSlug: string | null;
  evidenceCutoffAt: string | null;
  source: string;
}

export interface FreezeSnapshotModelV1 {
  id: string;
  key: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED" | "FIXTURE";
  config: ScoreModelConfigV1;
  isActive: boolean;
  /** Frozen dimension configs + fingerprints at export time (preferred). */
  dimensionConfigs: FrozenDimensionModelConfigsV2 | null;
}

export interface FreezeSnapshotV1 {
  schemaVersion: typeof FREEZE_SNAPSHOT_SCHEMA_VERSION;
  cohortId: string;
  cohortExternalKey: string | null;
  cohortName: string;
  cohortDescription: string;
  cohortCreatedAt: string;
  cohortRevision: number;
  members: FreezeSnapshotMemberV1[];
  season: FrozenSeasonBindingV2;
  activeModel: FreezeSnapshotModelV1 | null;
  /** Usually null at export; only set when evaluation model was selected then. */
  evaluationModel: FreezeSnapshotModelV1 | null;
  policies: FrozenPolicyCatalogVersionsV2;
  evidenceCutoffAt: string;
  generatedAt: string;
  /** sha256 of canonical JSON without this field. */
  contentHash: string;
}

export type FreezeSnapshotParseErrorCode =
  | "FREEZE_SNAPSHOT_MISSING"
  | "FREEZE_SNAPSHOT_HASH_MISMATCH"
  | "FREEZE_SNAPSHOT_INVALID";

export interface FreezeSnapshotParseResult {
  ok: boolean;
  snapshot: FreezeSnapshotV1 | null;
  code: FreezeSnapshotParseErrorCode | null;
  message: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Default catalog/algorithm policy set used at export and freeze. */
export function buildDefaultFreezePolicies(input: {
  abilityCatalogVersions: string[];
  mechanicCatalogVersions: string[];
}): FrozenPolicyCatalogVersionsV2 {
  return {
    difficultyPolicies: [{ id: "season-difficulty-policy", version: "1" }],
    abilityCatalogVersions: [...input.abilityCatalogVersions],
    mechanicCatalogVersions: [...input.mechanicCatalogVersions],
    confidenceAlgorithmVersions: { overall: "confidence-v1" },
    dimensionAlgorithmVersions: {
      PERFORMANCE: algorithmVersionForDimension("PERFORMANCE"),
      SURVIVAL: algorithmVersionForDimension("SURVIVAL"),
      UTILITY: algorithmVersionForDimension("UTILITY"),
      EXPERIENCE: algorithmVersionForDimension("EXPERIENCE"),
    },
  };
}

/**
 * Content-hash of a freeze snapshot document (excludes contentHash itself).
 */
export function computeFreezeSnapshotContentHash(
  snapshot: Omit<FreezeSnapshotV1, "contentHash">,
): string {
  return stableSha256(snapshot);
}

export function buildFreezeSnapshot(
  input: Omit<FreezeSnapshotV1, "schemaVersion" | "contentHash"> & {
    schemaVersion?: typeof FREEZE_SNAPSHOT_SCHEMA_VERSION;
  },
): FreezeSnapshotV1 {
  const withoutHash: Omit<FreezeSnapshotV1, "contentHash"> = {
    schemaVersion: input.schemaVersion ?? FREEZE_SNAPSHOT_SCHEMA_VERSION,
    cohortId: input.cohortId,
    cohortExternalKey: input.cohortExternalKey,
    cohortName: input.cohortName,
    cohortDescription: input.cohortDescription,
    cohortCreatedAt: input.cohortCreatedAt,
    cohortRevision: input.cohortRevision,
    members: input.members,
    season: input.season,
    activeModel: input.activeModel,
    evaluationModel: input.evaluationModel,
    policies: input.policies,
    evidenceCutoffAt: input.evidenceCutoffAt,
    generatedAt: input.generatedAt,
  };
  return {
    ...withoutHash,
    contentHash: computeFreezeSnapshotContentHash(withoutHash),
  };
}

function parsePolicies(raw: unknown): FrozenPolicyCatalogVersionsV2 | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.difficultyPolicies)) return null;
  if (!Array.isArray(raw.abilityCatalogVersions)) return null;
  if (!Array.isArray(raw.mechanicCatalogVersions)) return null;
  if (!isRecord(raw.confidenceAlgorithmVersions)) return null;
  if (!isRecord(raw.dimensionAlgorithmVersions)) return null;
  return {
    difficultyPolicies: raw.difficultyPolicies as FrozenPolicyCatalogVersionsV2["difficultyPolicies"],
    abilityCatalogVersions: raw.abilityCatalogVersions as string[],
    mechanicCatalogVersions: raw.mechanicCatalogVersions as string[],
    confidenceAlgorithmVersions: raw.confidenceAlgorithmVersions as Record<string, string>,
    dimensionAlgorithmVersions:
      raw.dimensionAlgorithmVersions as Partial<Record<ScoringV2PublicDimension, string>>,
  };
}

function parseModel(raw: unknown): FreezeSnapshotModelV1 | null {
  if (raw == null) return null;
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const key = asString(raw.key);
  if (!id || !key || typeof raw.version !== "number") return null;
  if (!isRecord(raw.config)) return null;
  const status = asString(raw.status) ?? "DRAFT";
  if (
    status !== "DRAFT" &&
    status !== "ACTIVE" &&
    status !== "ARCHIVED" &&
    status !== "FIXTURE"
  ) {
    return null;
  }
  return {
    id,
    key,
    version: raw.version,
    status,
    config: raw.config as unknown as ScoreModelConfigV1,
    isActive: Boolean(raw.isActive),
    dimensionConfigs: isRecord(raw.dimensionConfigs)
      ? (raw.dimensionConfigs as unknown as FrozenDimensionModelConfigsV2)
      : null,
  };
}

function parseMember(raw: unknown): FreezeSnapshotMemberV1 | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const region = asString(raw.region);
  const realmSlug = asString(raw.realmSlug);
  const characterName = asString(raw.characterName);
  const expectedLabel = asString(raw.expectedLabel);
  if (!id || !region || !realmSlug || !characterName || !expectedLabel) return null;
  return {
    id,
    externalMemberKey: typeof raw.externalMemberKey === "string" ? raw.externalMemberKey : null,
    characterId: typeof raw.characterId === "string" ? raw.characterId : null,
    region,
    realmSlug,
    characterName,
    expectedLabel,
    rationale: typeof raw.rationale === "string" ? raw.rationale : "",
    included: Boolean(raw.included),
    exclusionCode: typeof raw.exclusionCode === "string" ? raw.exclusionCode : null,
    role: typeof raw.role === "string" ? raw.role : null,
    classSlug: typeof raw.classSlug === "string" ? raw.classSlug : null,
    specSlug: typeof raw.specSlug === "string" ? raw.specSlug : null,
    evidenceCutoffAt: typeof raw.evidenceCutoffAt === "string" ? raw.evidenceCutoffAt : null,
    source: typeof raw.source === "string" ? raw.source : "USER_SELECTED",
  };
}

/**
 * Parse and verify a persisted freezeSnapshot JSON value.
 * Empty `{}` and null/undefined are treated as missing.
 */
export function parseAndVerifyFreezeSnapshot(raw: unknown): FreezeSnapshotParseResult {
  if (raw == null || !isRecord(raw) || Object.keys(raw).length === 0) {
    return {
      ok: false,
      snapshot: null,
      code: "FREEZE_SNAPSHOT_MISSING",
      message: "Freeze snapshot missing; re-export evidence before freeze",
    };
  }

  const schemaVersion = asString(raw.schemaVersion);
  if (schemaVersion !== FREEZE_SNAPSHOT_SCHEMA_VERSION) {
    return {
      ok: false,
      snapshot: null,
      code: "FREEZE_SNAPSHOT_INVALID",
      message: `Unsupported freeze snapshot schemaVersion: ${String(raw.schemaVersion)}`,
    };
  }

  const cohortId = asString(raw.cohortId);
  const cohortName = asString(raw.cohortName);
  const cohortCreatedAt = asString(raw.cohortCreatedAt);
  const generatedAt = asString(raw.generatedAt);
  const evidenceCutoffAt = asString(raw.evidenceCutoffAt);
  const claimedHash = asString(raw.contentHash);
  if (
    !cohortId ||
    !cohortName ||
    !cohortCreatedAt ||
    !generatedAt ||
    !evidenceCutoffAt ||
    !claimedHash ||
    typeof raw.cohortRevision !== "number"
  ) {
    return {
      ok: false,
      snapshot: null,
      code: "FREEZE_SNAPSHOT_INVALID",
      message: "Freeze snapshot is missing required identity fields",
    };
  }

  if (!isRecord(raw.season) || !asString(raw.season.seasonId) || !asString(raw.season.seasonSlug)) {
    return {
      ok: false,
      snapshot: null,
      code: "FREEZE_SNAPSHOT_INVALID",
      message: "Freeze snapshot season binding is invalid",
    };
  }

  if (!Array.isArray(raw.members) || raw.members.length === 0) {
    return {
      ok: false,
      snapshot: null,
      code: "FREEZE_SNAPSHOT_INVALID",
      message: "Freeze snapshot members are missing",
    };
  }

  const members: FreezeSnapshotMemberV1[] = [];
  for (const m of raw.members) {
    const parsed = parseMember(m);
    if (!parsed) {
      return {
        ok: false,
        snapshot: null,
        code: "FREEZE_SNAPSHOT_INVALID",
        message: "Freeze snapshot contains an invalid member row",
      };
    }
    members.push(parsed);
  }

  const policies = parsePolicies(raw.policies);
  if (!policies) {
    return {
      ok: false,
      snapshot: null,
      code: "FREEZE_SNAPSHOT_INVALID",
      message: "Freeze snapshot policies are invalid",
    };
  }

  const activeModel = parseModel(raw.activeModel);
  if (raw.activeModel != null && activeModel == null) {
    return {
      ok: false,
      snapshot: null,
      code: "FREEZE_SNAPSHOT_INVALID",
      message: "Freeze snapshot activeModel is invalid",
    };
  }
  const evaluationModel = parseModel(raw.evaluationModel);
  if (raw.evaluationModel != null && evaluationModel == null) {
    return {
      ok: false,
      snapshot: null,
      code: "FREEZE_SNAPSHOT_INVALID",
      message: "Freeze snapshot evaluationModel is invalid",
    };
  }

  const withoutHash: Omit<FreezeSnapshotV1, "contentHash"> = {
    schemaVersion: FREEZE_SNAPSHOT_SCHEMA_VERSION,
    cohortId,
    cohortExternalKey:
      typeof raw.cohortExternalKey === "string" ? raw.cohortExternalKey : null,
    cohortName,
    cohortDescription: typeof raw.cohortDescription === "string" ? raw.cohortDescription : "",
    cohortCreatedAt,
    cohortRevision: raw.cohortRevision,
    members,
    season: {
      seasonId: String(raw.season.seasonId),
      seasonSlug: String(raw.season.seasonSlug),
      region: typeof raw.season.region === "string" ? raw.season.region : null,
    },
    activeModel,
    evaluationModel,
    policies,
    evidenceCutoffAt,
    generatedAt,
  };

  const computedHash = computeFreezeSnapshotContentHash(withoutHash);
  if (!SHA256_HEX_RE.test(claimedHash) || claimedHash.toLowerCase() !== computedHash) {
    return {
      ok: false,
      snapshot: null,
      code: "FREEZE_SNAPSHOT_HASH_MISMATCH",
      message: `Freeze snapshot contentHash mismatch: claimed=${claimedHash} computed=${computedHash}`,
    };
  }

  return {
    ok: true,
    snapshot: { ...withoutHash, contentHash: computedHash },
    code: null,
    message: null,
  };
}

/** Convert snapshot model to CalibrationModelRef for bundle assembly. */
export function freezeSnapshotModelToCalibrationRef(
  model: FreezeSnapshotModelV1,
): CalibrationModelRef {
  return {
    id: model.id,
    key: model.key,
    version: model.version,
    status: model.status,
    config: model.config,
    isActive: model.isActive,
  };
}
