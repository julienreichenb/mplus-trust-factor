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
import { validateBoostShadowCohortManifest } from "./manifest.js";

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

/** Authoritative season window used to bound CharacterSnapshot fallback. */
export interface SeasonTimeBounds {
  seasonId: string;
  /** Required — missing/invalid startsAt fails closed (omit snapshot fallback). */
  startsAt: string | null;
  endsAt: string | null;
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

export function emptyProductionAuthenticity(): ProductionAuthenticityCompareV1 {
  return {
    authenticityScore: null,
    boostSuspected: null,
    atypicalProgression: null,
    redFlagKeys: [],
    snapshotId: null,
    calculatedAt: null,
    source: "none",
  };
}

function parseValidMs(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || iso.trim().length === 0) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Filter production authenticity to as-of cutoff.
 * Post-cutoff authenticity becomes empty/none — never used for comparison.
 */
export function filterProductionAuthenticityAsOf(
  auth: ProductionAuthenticityCompareV1 | null | undefined,
  evaluationCutoff: string,
): ProductionAuthenticityCompareV1 {
  if (!auth || auth.source === "none") return emptyProductionAuthenticity();
  const cutoffMs = parseValidMs(evaluationCutoff);
  if (cutoffMs === null) return emptyProductionAuthenticity();
  const calcMs = parseValidMs(auth.calculatedAt);
  if (calcMs === null || calcMs > cutoffMs) return emptyProductionAuthenticity();
  return auth;
}

/**
 * Canonical Phase 2 as-of evidence filter.
 *
 * - runs: seasonId exact + completedAt valid + completedAt <= cutoff
 * - ratingSnapshots: seasonId exact (null rejected) + capturedAt valid + <= cutoff
 * - productionAuthenticity: calculatedAt valid + <= cutoff else empty/none
 * - ownership always stripped
 *
 * Missing evidence stays omitted — never coerced to zero or reassigned season.
 */
export function filterMemberEvidenceAsOf(
  evidence: BoostShadowMemberEvidenceV1,
  evaluationCutoff: string,
): BoostShadowMemberEvidenceV1 {
  const cutoffMs = parseValidMs(evaluationCutoff);
  if (cutoffMs === null) {
    throw new Error(`Invalid evaluationCutoff: ${evaluationCutoff}`);
  }

  const seasonId = evidence.seasonId;

  const runs = evidence.runs.filter((run) => {
    if (run.seasonId !== seasonId) return false;
    const at = parseValidMs(run.completedAt);
    return at !== null && at <= cutoffMs;
  });

  const ratingSnapshots = (evidence.ratingSnapshots ?? []).filter((snap) => {
    // Phase 2: missing/null seasonId must not silently pass.
    if (snap.seasonId == null || snap.seasonId === "") return false;
    if (snap.seasonId !== seasonId) return false;
    const at = parseValidMs(snap.capturedAt);
    return at !== null && at <= cutoffMs;
  });

  const productionAuthenticity = filterProductionAuthenticityAsOf(
    evidence.productionAuthenticity,
    evaluationCutoff,
  );

  // Strip any accidental ownership field without preserving it.
  const {
    ownershipEvidence: _ownershipIgnored,
    ...rest
  } = evidence as BoostShadowMemberEvidenceV1 & { ownershipEvidence?: unknown };

  return {
    ...rest,
    runs,
    ratingSnapshots,
    productionAuthenticity,
    ownershipEvidenceForbidden: true,
  };
}

/**
 * @deprecated Prefer filterMemberEvidenceAsOf — kept as alias for callers.
 */
export function filterEvidenceAtCutoff(
  evidence: BoostShadowMemberEvidenceV1,
  evaluationCutoff: string,
): BoostShadowMemberEvidenceV1 {
  return filterMemberEvidenceAsOf(evidence, evaluationCutoff);
}

/**
 * Map persisted CharacterSnapshot rows into season-bound portable snapshots.
 *
 * Requires authoritative season.startsAt. Fail closed (omit all) when startsAt
 * is absent/invalid. Does not infer season from current date, score, or nearby runs.
 * Attaches manifest seasonId only after the window check passes.
 */
export function mapPersistedCharacterSnapshotsToSeasonBound(args: {
  snapshots: Array<{
    characterId: string;
    mythicRating: number | null;
    capturedAt: string | Date;
  }>;
  seasonBounds: SeasonTimeBounds;
  evaluationCutoff: string;
}): BoostShadowRatingSnapshotInput[] {
  const startsAtMs = parseValidMs(args.seasonBounds.startsAt);
  if (startsAtMs === null) {
    // Fail closed: no CharacterSnapshot fallback without authoritative startsAt.
    return [];
  }

  const cutoffMs = parseValidMs(args.evaluationCutoff);
  if (cutoffMs === null) return [];

  const endsAtMs = parseValidMs(args.seasonBounds.endsAt);
  const upperBoundMs =
    endsAtMs === null ? cutoffMs : Math.min(endsAtMs, cutoffMs);

  const out: BoostShadowRatingSnapshotInput[] = [];
  for (const snap of args.snapshots) {
    if (snap.mythicRating == null || !(snap.mythicRating > 0)) continue;
    const capturedIso =
      snap.capturedAt instanceof Date
        ? snap.capturedAt.toISOString()
        : snap.capturedAt;
    const capturedMs = parseValidMs(capturedIso);
    if (capturedMs === null) continue;
    if (capturedMs < startsAtMs) continue;
    if (capturedMs > upperBoundMs) continue;

    out.push({
      characterId: snap.characterId,
      mythicRating: snap.mythicRating,
      capturedAt: capturedIso,
      seasonId: args.seasonBounds.seasonId,
    });
  }
  return out;
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

function validateProductionAuthenticityShape(
  raw: unknown,
  prefix: string,
  errors: string[],
): void {
  if (raw == null) return;
  if (!isRecord(raw)) {
    errors.push(`${prefix} must be an object when provided`);
    return;
  }
  if (raw.source === "none") return;
  if (raw.calculatedAt != null) {
    if (typeof raw.calculatedAt !== "string" || parseValidMs(raw.calculatedAt) === null) {
      errors.push(`${prefix}.calculatedAt must be a valid ISO timestamp when present`);
    }
  }
}

/**
 * Deep validation for Phase 2 evidence bundles.
 * Rejects cross-season runs/snapshots, missing snapshot seasonIds, ownership, and
 * invalid evaluationCutoff / authenticity timestamps.
 */
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

  if (typeof input.generatedAt !== "string" || parseValidMs(input.generatedAt) === null) {
    errors.push("generatedAt must be an ISO timestamp");
  }

  if (input.source !== "fixture" && input.source !== "persisted_export") {
    errors.push("source must be fixture|persisted_export");
  }

  if (!isRecord(input.evidenceByMemberId)) {
    errors.push("evidenceByMemberId must be an object");
    return { ok: false, errors, bundle: null };
  }

  const manifestResult = validateBoostShadowCohortManifest(input.manifest);
  if (!manifestResult.ok || !manifestResult.manifest) {
    errors.push(...manifestResult.errors.map((e) => `manifest: ${e}`));
    return { ok: false, errors, bundle: null };
  }
  const manifest = manifestResult.manifest;

  for (const member of manifest.members) {
    if (member.evaluationCutoff != null && parseValidMs(member.evaluationCutoff) === null) {
      errors.push(`members[${member.memberId}].evaluationCutoff must be a valid ISO timestamp`);
    }
  }

  const memberById = new Map(manifest.members.map((m) => [m.memberId, m]));

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
    if (typeof raw.seasonId !== "string" || !raw.seasonId) {
      errors.push(`evidenceByMemberId[${memberId}].seasonId required`);
    } else if (raw.seasonId !== manifest.seasonId) {
      errors.push(
        `evidenceByMemberId[${memberId}].seasonId must match manifest.seasonId`,
      );
    }

    const member = memberById.get(memberId);
    if (member && typeof raw.characterId === "string" && raw.characterId !== member.characterId) {
      errors.push(
        `evidenceByMemberId[${memberId}].characterId must match manifest member characterId`,
      );
    }

    if (!Array.isArray(raw.runs)) {
      errors.push(`evidenceByMemberId[${memberId}].runs must be an array`);
    } else {
      for (let i = 0; i < raw.runs.length; i++) {
        const run = raw.runs[i];
        if (!isRecord(run)) {
          errors.push(`evidenceByMemberId[${memberId}].runs[${i}] must be an object`);
          continue;
        }
        if (typeof run.seasonId === "string" && run.seasonId !== raw.seasonId) {
          errors.push(
            `evidenceByMemberId[${memberId}].runs[${i}].seasonId must equal evidence.seasonId`,
          );
        }
      }
    }

    if (raw.ratingSnapshots !== undefined) {
      if (!Array.isArray(raw.ratingSnapshots)) {
        errors.push(`evidenceByMemberId[${memberId}].ratingSnapshots must be an array`);
      } else {
        for (let i = 0; i < raw.ratingSnapshots.length; i++) {
          const snap = raw.ratingSnapshots[i];
          if (!isRecord(snap)) {
            errors.push(
              `evidenceByMemberId[${memberId}].ratingSnapshots[${i}] must be an object`,
            );
            continue;
          }
          if (snap.seasonId == null || snap.seasonId === "") {
            errors.push(
              `evidenceByMemberId[${memberId}].ratingSnapshots[${i}].seasonId is required in Phase 2`,
            );
          } else if (
            typeof snap.seasonId === "string" &&
            typeof raw.seasonId === "string" &&
            snap.seasonId !== raw.seasonId
          ) {
            errors.push(
              `evidenceByMemberId[${memberId}].ratingSnapshots[${i}].seasonId must equal evidence.seasonId`,
            );
          }
        }
      }
    }

    if (Array.isArray(raw.ownershipEvidence) && raw.ownershipEvidence.length > 0) {
      errors.push(
        `evidenceByMemberId[${memberId}] must not include ownershipEvidence in Phase 2`,
      );
    }

    validateProductionAuthenticityShape(
      raw.productionAuthenticity,
      `evidenceByMemberId[${memberId}].productionAuthenticity`,
      errors,
    );
  }

  // Every manifest member should have evidence (may be empty runs).
  for (const member of manifest.members) {
    if (!(member.memberId in input.evidenceByMemberId)) {
      errors.push(`missing evidence for manifest member ${member.memberId}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, bundle: null };
  }

  return {
    ok: true,
    errors: [],
    bundle: {
      ...(input as unknown as BoostShadowEvidenceBundleV1),
      manifest,
    },
  };
}
