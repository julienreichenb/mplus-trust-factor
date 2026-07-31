import type { CohortMemberSource, CalibrationRole, QualitativeLabel } from "./types.js";
import { COHORT_MANIFEST_SCHEMA_VERSION as SCHEMA_VERSION } from "./types.js";

export { SCHEMA_VERSION as COHORT_MANIFEST_SCHEMA_VERSION };

export interface CohortManifestMember {
  /** Stable cohort-local id (not necessarily a DB UUID). */
  id: string;
  region: string;
  realm: string;
  character: string;
  role: CalibrationRole;
  classSlug: string;
  specSlug: string;
  expectedLabel: QualitativeLabel;
  /** true = meta, false = non-meta */
  meta: boolean;
  rationale: string;
  suspectedBoost: boolean;
  source: CohortMemberSource;
  /** Optional immutable snapshot IDs to avoid provider calls. */
  snapshotIds?: string[];
  /** Optional season slug hint for evaluation. */
  seasonSlug?: string;
}

export interface CohortManifest {
  schemaVersion: string;
  cohortId: string;
  description: string;
  /** ISO timestamp — fixed for deterministic fixtures. */
  createdAt: string;
  members: CohortManifestMember[];
  notes?: string;
}

const QUALITATIVE_LABELS = new Set<QualitativeLabel>([
  "excellent",
  "good",
  "average",
  "weak",
  "overrated",
]);

const ROLES = new Set<CalibrationRole>(["DPS", "TANK", "HEALER"]);
const SOURCES = new Set<CohortMemberSource>(["user-selected", "stratified-auto"]);

export interface ManifestValidationResult {
  ok: boolean;
  errors: string[];
  manifest: CohortManifest | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string, errors: string[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

/**
 * Validates a versioned cohort manifest.
 * Rejects malformed structure without mutating input.
 */
export function validateCohortManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["manifest must be an object"], manifest: null };
  }

  const schemaVersion = asString(input.schemaVersion, "schemaVersion", errors);
  if (schemaVersion && schemaVersion !== SCHEMA_VERSION) {
    errors.push(
      `unsupported schemaVersion "${schemaVersion}" (expected ${SCHEMA_VERSION})`,
    );
  }

  const cohortId = asString(input.cohortId, "cohortId", errors);
  const description = asString(input.description, "description", errors);
  const createdAt = asString(input.createdAt, "createdAt", errors);

  if (!Array.isArray(input.members)) {
    errors.push("members must be an array");
    return { ok: false, errors, manifest: null };
  }

  if (input.members.length === 0) {
    errors.push("members must not be empty");
  }

  const seenIds = new Set<string>();
  const members: CohortManifestMember[] = [];

  for (let i = 0; i < input.members.length; i++) {
    const raw = input.members[i];
    const prefix = `members[${i}]`;
    if (!isRecord(raw)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }

    const id = asString(raw.id, `${prefix}.id`, errors);
    const region = asString(raw.region, `${prefix}.region`, errors);
    const realm = asString(raw.realm, `${prefix}.realm`, errors);
    const character = asString(raw.character, `${prefix}.character`, errors);
    const classSlug = asString(raw.classSlug, `${prefix}.classSlug`, errors);
    const specSlug = asString(raw.specSlug, `${prefix}.specSlug`, errors);
    const rationale = asString(raw.rationale, `${prefix}.rationale`, errors);

    if (id) {
      if (seenIds.has(id)) {
        errors.push(`${prefix}.id duplicate: ${id}`);
      }
      seenIds.add(id);
    }

    const role = raw.role;
    if (typeof role !== "string" || !ROLES.has(role as CalibrationRole)) {
      errors.push(`${prefix}.role must be one of DPS|TANK|HEALER`);
    }

    const expectedLabel = raw.expectedLabel;
    if (
      typeof expectedLabel !== "string" ||
      !QUALITATIVE_LABELS.has(expectedLabel as QualitativeLabel)
    ) {
      errors.push(
        `${prefix}.expectedLabel must be one of excellent|good|average|weak|overrated`,
      );
    }

    if (typeof raw.meta !== "boolean") {
      errors.push(`${prefix}.meta must be a boolean`);
    }

    if (typeof raw.suspectedBoost !== "boolean") {
      errors.push(`${prefix}.suspectedBoost must be a boolean`);
    }

    const source = raw.source;
    if (typeof source !== "string" || !SOURCES.has(source as CohortMemberSource)) {
      errors.push(`${prefix}.source must be user-selected|stratified-auto`);
    }

    let snapshotIds: string[] | undefined;
    if (raw.snapshotIds !== undefined) {
      if (
        !Array.isArray(raw.snapshotIds) ||
        !raw.snapshotIds.every((s) => typeof s === "string" && s.length > 0)
      ) {
        errors.push(`${prefix}.snapshotIds must be an array of non-empty strings`);
      } else {
        snapshotIds = raw.snapshotIds as string[];
      }
    }

    let seasonSlug: string | undefined;
    if (raw.seasonSlug !== undefined) {
      if (typeof raw.seasonSlug !== "string" || raw.seasonSlug.trim().length === 0) {
        errors.push(`${prefix}.seasonSlug must be a non-empty string when provided`);
      } else {
        seasonSlug = raw.seasonSlug.trim();
      }
    }

    if (
      id &&
      region &&
      realm &&
      character &&
      classSlug &&
      specSlug &&
      rationale &&
      typeof role === "string" &&
      ROLES.has(role as CalibrationRole) &&
      typeof expectedLabel === "string" &&
      QUALITATIVE_LABELS.has(expectedLabel as QualitativeLabel) &&
      typeof raw.meta === "boolean" &&
      typeof raw.suspectedBoost === "boolean" &&
      typeof source === "string" &&
      SOURCES.has(source as CohortMemberSource)
    ) {
      members.push({
        id,
        region,
        realm,
        character,
        role: role as CalibrationRole,
        classSlug,
        specSlug,
        expectedLabel: expectedLabel as QualitativeLabel,
        meta: raw.meta,
        rationale,
        suspectedBoost: raw.suspectedBoost,
        source: source as CohortMemberSource,
        ...(snapshotIds ? { snapshotIds } : {}),
        ...(seasonSlug ? { seasonSlug } : {}),
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, manifest: null };
  }

  return {
    ok: true,
    errors: [],
    manifest: {
      schemaVersion: schemaVersion!,
      cohortId: cohortId!,
      description: description!,
      createdAt: createdAt!,
      members,
      ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
    },
  };
}

/** Expert label rank — higher is better (excellent > … > overrated). */
export const LABEL_RANK: Record<QualitativeLabel, number> = {
  excellent: 5,
  good: 4,
  average: 3,
  weak: 2,
  overrated: 1,
};

export const GRADE_RANK: Record<string, number> = {
  S: 6,
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  U: 0,
};
