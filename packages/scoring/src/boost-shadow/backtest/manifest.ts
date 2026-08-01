/**
 * Versioned boost-shadow cohort manifest.
 * Private runs use stable internal character IDs — never commit real player identities.
 */

import { HIGH_KEY_POLICY_VERSION } from "../constants.js";
import type { ResearchLabelClass, ResearchLabelV1 } from "./types.js";

export const BOOST_SHADOW_COHORT_MANIFEST_SCHEMA = "boost-shadow-cohort-v1" as const;

export interface BoostShadowCohortMemberV1 {
  /** Cohort-local id (stable within the manifest). */
  memberId: string;
  /** Stable internal Character.id — preferred subject key. */
  characterId: string;
  role?: "DPS" | "TANK" | "HEALER" | null;
  /** Optional key-band slice tag (hypothesis banding, not product). */
  keyBand?: string | null;
  /**
   * Research label — not authenticity ground truth.
   * Omit or set class=unlabeled when unknown.
   */
  label?: ResearchLabelV1 | null;
  /**
   * ISO cutoff: runs / snapshots / ownership after this must not inform features.
   * Defaults to options.generatedAt when omitted.
   */
  evaluationCutoff?: string | null;
}

export interface BoostShadowCohortManifestV1 {
  schemaVersion: typeof BOOST_SHADOW_COHORT_MANIFEST_SCHEMA;
  cohortId: string;
  description: string;
  createdAt: string;
  /** Must match Phase 1 shared high-key policy. */
  highKeyPolicyVersion: string;
  seasonId: string;
  members: BoostShadowCohortMemberV1[];
  notes?: string;
}

/**
 * Separately resolved operator input — may contain region/realm/name.
 * Resolve offline to characterId before building the private manifest.
 * Do not commit real player identities into fixtures.
 */
export interface BoostShadowOperatorMemberRefV1 {
  memberId: string;
  region: string;
  realm: string;
  character: string;
  role?: "DPS" | "TANK" | "HEALER";
  keyBand?: string;
  label?: ResearchLabelV1;
  evaluationCutoff?: string;
}

export interface BoostShadowOperatorInputV1 {
  schemaVersion: "boost-shadow-operator-input-v1";
  cohortId: string;
  description: string;
  seasonId: string;
  members: BoostShadowOperatorMemberRefV1[];
}

export interface ManifestValidationResult {
  ok: boolean;
  errors: string[];
  manifest: BoostShadowCohortManifestV1 | null;
}

const LABEL_CLASSES = new Set<ResearchLabelClass>([
  "suspicious_consensus",
  "legitimate_consensus",
  "uncertain",
  "synthetic_fixture",
  "unlabeled",
]);

const ROLES = new Set(["DPS", "TANK", "HEALER"]);

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

function parseLabel(raw: unknown, prefix: string, errors: string[]): ResearchLabelV1 | null {
  if (raw == null) return null;
  if (!isRecord(raw)) {
    errors.push(`${prefix} must be an object when provided`);
    return null;
  }
  const cls = raw.class;
  if (typeof cls !== "string" || !LABEL_CLASSES.has(cls as ResearchLabelClass)) {
    errors.push(
      `${prefix}.class must be one of suspicious_consensus|legitimate_consensus|uncertain|synthetic_fixture|unlabeled`,
    );
    return null;
  }
  const source = asString(raw.source, `${prefix}.source`, errors);
  if (!source) return null;

  const policyVersion = asString(raw.policyVersion, `${prefix}.policyVersion`, errors);
  if (!policyVersion) return null;

  let confidence: number | null = null;
  if (raw.confidence !== null && raw.confidence !== undefined) {
    if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) {
      errors.push(`${prefix}.confidence must be null or a number in [0,1]`);
      return null;
    }
    confidence = raw.confidence;
  }

  let labeledAt: string | null = null;
  if (raw.labeledAt !== null && raw.labeledAt !== undefined) {
    if (typeof raw.labeledAt !== "string" || !Number.isFinite(Date.parse(raw.labeledAt))) {
      errors.push(`${prefix}.labeledAt must be null or an ISO timestamp`);
      return null;
    }
    labeledAt = raw.labeledAt;
  }

  let reviewerCount: number | null = null;
  if (raw.reviewerCount !== null && raw.reviewerCount !== undefined) {
    if (typeof raw.reviewerCount !== "number" || !Number.isInteger(raw.reviewerCount) || raw.reviewerCount < 0) {
      errors.push(`${prefix}.reviewerCount must be null or a non-negative integer`);
      return null;
    }
    reviewerCount = raw.reviewerCount;
  }

  return {
    class: cls as ResearchLabelClass,
    source,
    confidence,
    labeledAt,
    policyVersion,
    reviewerCount,
  };
}

export function unlabeledResearchLabel(policyVersion = "label-policy-unspecified"): ResearchLabelV1 {
  return {
    class: "unlabeled",
    source: "none",
    confidence: null,
    labeledAt: null,
    policyVersion,
    reviewerCount: null,
  };
}

/**
 * Validates a versioned private cohort manifest (character IDs, not display names).
 */
export function validateBoostShadowCohortManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["manifest must be an object"], manifest: null };
  }

  const schemaVersion = asString(input.schemaVersion, "schemaVersion", errors);
  if (schemaVersion && schemaVersion !== BOOST_SHADOW_COHORT_MANIFEST_SCHEMA) {
    errors.push(
      `unsupported schemaVersion "${schemaVersion}" (expected ${BOOST_SHADOW_COHORT_MANIFEST_SCHEMA})`,
    );
  }

  const cohortId = asString(input.cohortId, "cohortId", errors);
  const description = asString(input.description, "description", errors);
  const createdAt = asString(input.createdAt, "createdAt", errors);
  const seasonId = asString(input.seasonId, "seasonId", errors);
  const highKeyPolicyVersion = asString(
    input.highKeyPolicyVersion,
    "highKeyPolicyVersion",
    errors,
  );
  if (highKeyPolicyVersion && highKeyPolicyVersion !== HIGH_KEY_POLICY_VERSION) {
    errors.push(
      `highKeyPolicyVersion must be "${HIGH_KEY_POLICY_VERSION}" (shared Phase 1 policy)`,
    );
  }

  if (!Array.isArray(input.members)) {
    errors.push("members must be an array");
    return { ok: false, errors, manifest: null };
  }
  if (input.members.length === 0) {
    errors.push("members must not be empty");
  }

  const seenMemberIds = new Set<string>();
  const seenCharacterIds = new Set<string>();
  const members: BoostShadowCohortMemberV1[] = [];

  for (let i = 0; i < input.members.length; i++) {
    const raw = input.members[i];
    const prefix = `members[${i}]`;
    if (!isRecord(raw)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }

    const memberId = asString(raw.memberId, `${prefix}.memberId`, errors);
    const characterId = asString(raw.characterId, `${prefix}.characterId`, errors);

    if (memberId) {
      if (seenMemberIds.has(memberId)) errors.push(`${prefix}.memberId duplicate: ${memberId}`);
      seenMemberIds.add(memberId);
    }
    if (characterId) {
      if (seenCharacterIds.has(characterId)) {
        errors.push(`${prefix}.characterId duplicate across cohort: ${characterId}`);
      }
      seenCharacterIds.add(characterId);
    }

    let role: BoostShadowCohortMemberV1["role"] = null;
    if (raw.role !== undefined && raw.role !== null) {
      if (typeof raw.role !== "string" || !ROLES.has(raw.role)) {
        errors.push(`${prefix}.role must be DPS|TANK|HEALER|null`);
      } else {
        role = raw.role as "DPS" | "TANK" | "HEALER";
      }
    }

    let keyBand: string | null = null;
    if (raw.keyBand !== undefined && raw.keyBand !== null) {
      if (typeof raw.keyBand !== "string") {
        errors.push(`${prefix}.keyBand must be a string or null`);
      } else {
        keyBand = raw.keyBand;
      }
    }

    let evaluationCutoff: string | null = null;
    if (raw.evaluationCutoff !== undefined && raw.evaluationCutoff !== null) {
      if (
        typeof raw.evaluationCutoff !== "string" ||
        !Number.isFinite(Date.parse(raw.evaluationCutoff))
      ) {
        errors.push(`${prefix}.evaluationCutoff must be an ISO timestamp when provided`);
      } else {
        evaluationCutoff = raw.evaluationCutoff;
      }
    }

    const label = parseLabel(raw.label, `${prefix}.label`, errors);

    if (memberId && characterId) {
      members.push({
        memberId,
        characterId,
        role,
        keyBand,
        label: label ?? unlabeledResearchLabel(),
        evaluationCutoff,
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
      schemaVersion: BOOST_SHADOW_COHORT_MANIFEST_SCHEMA,
      cohortId: cohortId!,
      description: description!,
      createdAt: createdAt!,
      highKeyPolicyVersion: highKeyPolicyVersion!,
      seasonId: seasonId!,
      members,
      ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
    },
  };
}
