/**
 * Portable read-only evidence packages for Phase 2 backtest.
 * No Prisma in @mplus/scoring — adapters build these bundles externally.
 */

import type {
  BoostFeatureExtractorInput,
  BoostShadowRatingSnapshotInput,
  BoostShadowRunInput,
} from "../types.js";
import {
  BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA,
  type ProductionAuthenticityCompareV1,
  type ResearchLabelV1,
} from "./types.js";
import type { BoostShadowCohortManifestV1 } from "./manifest.js";

export interface BoostShadowMemberEvidenceV1 {
  memberId: string;
  characterId: string;
  seasonId: string;
  regionId: string;
  /** Persisted runs — already filtered or filtered by harness at evaluationCutoff. */
  runs: BoostShadowRunInput[];
  ratingSnapshots?: BoostShadowRatingSnapshotInput[];
  /**
   * Phase 2 must not load verified ownership (Phase 4).
   * Field retained for schema clarity; harness ignores / rejects non-empty.
   */
  ownershipEvidenceForbidden?: true;
  productionAuthenticity?: ProductionAuthenticityCompareV1 | null;
  /** Optional pre-attached label override (manifest wins when present). */
  label?: ResearchLabelV1 | null;
}

export interface BoostShadowEvidenceBundleV1 {
  schemaVersion: typeof BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA;
  manifest: BoostShadowCohortManifestV1;
  evidenceByMemberId: Record<string, BoostShadowMemberEvidenceV1>;
  generatedAt: string;
  source: "fixture" | "persisted_export";
}

export interface BoostShadowEvidencePort {
  /**
   * Load evidence for one member. Must be read-only against persistence.
   * Must not call providers.
   */
  loadMember(memberId: string): BoostShadowMemberEvidenceV1 | null;
}

export interface EvidenceBundleValidationResult {
  ok: boolean;
  errors: string[];
  bundle: BoostShadowEvidenceBundleV1 | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createMapEvidencePort(
  evidenceByMemberId: Record<string, BoostShadowMemberEvidenceV1>,
): BoostShadowEvidencePort {
  return {
    loadMember(memberId: string) {
      return evidenceByMemberId[memberId] ?? null;
    },
  };
}

/**
 * Filter runs and snapshots to those observed at or before evaluationCutoff.
 * Future evidence cannot leak into earlier evaluation.
 */
export function filterEvidenceAtCutoff(
  evidence: BoostShadowMemberEvidenceV1,
  evaluationCutoff: string,
): BoostShadowMemberEvidenceV1 {
  const cutoffMs = Date.parse(evaluationCutoff);
  if (!Number.isFinite(cutoffMs)) {
    throw new Error(`Invalid evaluationCutoff: ${evaluationCutoff}`);
  }

  const runs = evidence.runs.filter((run) => {
    if (!run.completedAt) return false;
    const at = Date.parse(run.completedAt);
    return Number.isFinite(at) && at <= cutoffMs;
  });

  const ratingSnapshots = (evidence.ratingSnapshots ?? []).filter((snap) => {
    const at = Date.parse(snap.capturedAt);
    return Number.isFinite(at) && at <= cutoffMs;
  });

  return {
    ...evidence,
    runs,
    ratingSnapshots,
    // Phase 2: never pass ownership into extractors.
  };
}

export function toExtractorInput(
  evidence: BoostShadowMemberEvidenceV1,
  calculatedAt: string,
): BoostFeatureExtractorInput {
  return {
    subjectCharacterId: evidence.characterId,
    seasonId: evidence.seasonId,
    regionId: evidence.regionId,
    calculatedAt,
    runs: evidence.runs,
    ratingSnapshots: evidence.ratingSnapshots,
    // Phase 2: verified-alt ownership intentionally omitted.
    ownershipEvidence: undefined,
    sourceProvenance: {
      primary: "persisted_runs",
      runSourceCounts: countRunSources(evidence.runs),
    },
  };
}

function countRunSources(runs: BoostShadowRunInput[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const run of runs) {
    const src = run.source ?? "persisted";
    counts[src] = (counts[src] ?? 0) + 1;
  }
  return counts;
}

export function validateBoostShadowEvidenceBundle(
  input: unknown,
): EvidenceBundleValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["bundle must be an object"], bundle: null };
  }

  if (input.schemaVersion !== BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA) {
    errors.push(
      `unsupported schemaVersion (expected ${BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA})`,
    );
  }

  if (typeof input.generatedAt !== "string" || !Number.isFinite(Date.parse(input.generatedAt))) {
    errors.push("generatedAt must be an ISO timestamp");
  }

  if (input.source !== "fixture" && input.source !== "persisted_export") {
    errors.push("source must be fixture|persisted_export");
  }

  if (!isRecord(input.evidenceByMemberId)) {
    errors.push("evidenceByMemberId must be an object");
    return { ok: false, errors, bundle: null };
  }

  // Manifest validated separately by callers; shallow check here.
  if (!isRecord(input.manifest)) {
    errors.push("manifest must be an object");
  }

  for (const [memberId, raw] of Object.entries(input.evidenceByMemberId)) {
    if (!isRecord(raw)) {
      errors.push(`evidenceByMemberId[${memberId}] must be an object`);
      continue;
    }
    if (raw.memberId !== memberId) {
      errors.push(`evidenceByMemberId[${memberId}].memberId mismatch`);
    }
    if (typeof raw.characterId !== "string" || !raw.characterId) {
      errors.push(`evidenceByMemberId[${memberId}].characterId required`);
    }
    if (!Array.isArray(raw.runs)) {
      errors.push(`evidenceByMemberId[${memberId}].runs must be an array`);
    }
    if (Array.isArray(raw.ownershipEvidence) && raw.ownershipEvidence.length > 0) {
      errors.push(
        `evidenceByMemberId[${memberId}] must not include ownershipEvidence in Phase 2`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, bundle: null };
  }

  return {
    ok: true,
    errors: [],
    bundle: input as unknown as BoostShadowEvidenceBundleV1,
  };
}
