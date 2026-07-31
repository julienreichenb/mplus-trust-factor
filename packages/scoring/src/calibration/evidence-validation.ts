import type { ScoreSnapshotDTO } from "@mplus/contracts";
import type { ScoringContext } from "../types.js";
import type { CohortManifestMember } from "./manifest.js";
import type {
  CalibrationMemberEvidence,
  CalibrationModelRef,
  CalibrationBacktestMode,
  EvidenceValidationIssue,
  UnsupportedCalibrationMode,
} from "./types.js";

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function isIsoTimestamp(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  if (!ISO_RE.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function hasReplayableScoringContext(
  context: ScoringContext | null | undefined,
): context is ScoringContext {
  if (!context || typeof context !== "object") return false;
  if (context.role !== "DPS" && context.role !== "TANK" && context.role !== "HEALER") {
    return false;
  }
  if (typeof context.freshness !== "number" || !Number.isFinite(context.freshness)) {
    return false;
  }
  if (
    typeof context.selectedRunCoverage !== "number" ||
    !Number.isFinite(context.selectedRunCoverage)
  ) {
    return false;
  }
  return true;
}

function issue(
  code: EvidenceValidationIssue["code"],
  memberId: string | null,
  message: string,
): EvidenceValidationIssue {
  return { code, memberId, message };
}

export interface ValidateMemberEvidenceInput {
  member: CohortManifestMember;
  evidence: CalibrationMemberEvidence;
  mode: CalibrationBacktestMode | UnsupportedCalibrationMode;
  activeModel?: CalibrationModelRef | null;
  evaluationModel?: CalibrationModelRef | null;
  /** Snapshot IDs already claimed by other members in this run. */
  claimedSnapshotIds: Set<string>;
}

/**
 * Strict provenance / replay validation for one member.
 * Invalid evidence must not enter score aggregates.
 */
export function validateMemberEvidence(
  input: ValidateMemberEvidenceInput,
): EvidenceValidationIssue | null {
  const { member, evidence, mode, activeModel, evaluationModel, claimedSnapshotIds } = input;

  if (mode === "refresh-then-evaluate") {
    return issue(
      "UNSUPPORTED_MODE",
      member.id,
      "refresh-then-evaluate is unsupported — no provider refresh port ships in this package",
    );
  }

  if (evidence.memberId !== member.id) {
    return issue(
      "MEMBER_ID_MISMATCH",
      member.id,
      `evidence.memberId "${evidence.memberId}" !== manifest member.id "${member.id}"`,
    );
  }

  const expectedCharacterId = evidence.characterId ?? member.id;
  const season = evidence.seasonSlug ?? member.seasonSlug ?? null;

  if (mode === "persisted-snapshot-only") {
    if (!evidence.snapshot) {
      return issue(
        "MISSING_SNAPSHOT",
        member.id,
        `persisted-snapshot-only requires a snapshot for member ${member.id}`,
      );
    }
    const snap = evidence.snapshot;
    const snapCheck = validateSnapshotProvenance({
      member,
      evidence,
      snapshot: snap,
      expectedCharacterId,
      season,
      claimedSnapshotIds,
      // Only an explicit evaluationModel may assert model identity.
      // activeModel alone must not relabel snapshot provenance.
      referenceModel: evaluationModel ?? null,
      allowModelRelabel: false,
    });
    if (snapCheck) return snapCheck;
    void activeModel;
  }

  if (mode === "draft-model-evaluate" || mode === "active-versus-draft") {
    if (!evidence.observations || evidence.observations.length === 0) {
      return issue(
        "MISSING_OBSERVATIONS",
        member.id,
        `${mode} requires non-empty observations for member ${member.id}`,
      );
    }
    if (!hasReplayableScoringContext(evidence.scoringContext)) {
      return issue(
        "MISSING_REPLAY_CONTEXT",
        member.id,
        `${mode} requires explicit scoringContext (role, freshness, selectedRunCoverage) for member ${member.id}`,
      );
    }
    if (evidence.calculatedAt != null && !isIsoTimestamp(evidence.calculatedAt)) {
      return issue(
        "INVALID_TIMESTAMP",
        member.id,
        `invalid evidence.calculatedAt for member ${member.id}`,
      );
    }
    if (
      evidence.inputFingerprint != null &&
      (typeof evidence.inputFingerprint !== "string" || evidence.inputFingerprint.length === 0)
    ) {
      return issue(
        "INVALID_FINGERPRINT",
        member.id,
        `invalid evidence.inputFingerprint for member ${member.id}`,
      );
    }

    // Optional snapshot may accompany replay evidence — still validate if present.
    if (evidence.snapshot) {
      const snapCheck = validateSnapshotProvenance({
        member,
        evidence,
        snapshot: evidence.snapshot,
        expectedCharacterId,
        season,
        claimedSnapshotIds,
        referenceModel: null,
        allowModelRelabel: false,
      });
      if (snapCheck) return snapCheck;
    }
  }

  // Snapshot-only: when manifest lists snapshotIds, evidence must match.
  if (
    mode === "persisted-snapshot-only" &&
    member.snapshotIds &&
    member.snapshotIds.length > 0
  ) {
    if (!evidence.snapshotId) {
      return issue(
        "SNAPSHOT_ID_MISSING",
        member.id,
        `manifest lists snapshotIds but evidence.snapshotId is missing for ${member.id}`,
      );
    }
    if (!member.snapshotIds.includes(evidence.snapshotId)) {
      return issue(
        "SNAPSHOT_ID_NOT_IN_MANIFEST",
        member.id,
        `snapshotId "${evidence.snapshotId}" not in member.snapshotIds for ${member.id}`,
      );
    }
  }

  return null;
}

function validateSnapshotProvenance(input: {
  member: CohortManifestMember;
  evidence: CalibrationMemberEvidence;
  snapshot: ScoreSnapshotDTO;
  expectedCharacterId: string;
  season: string | null;
  claimedSnapshotIds: Set<string>;
  referenceModel: CalibrationModelRef | null;
  allowModelRelabel: boolean;
}): EvidenceValidationIssue | null {
  const { member, evidence, snapshot, expectedCharacterId, season, claimedSnapshotIds } = input;

  if (snapshot.characterId !== expectedCharacterId) {
    return issue(
      "CHARACTER_ID_MISMATCH",
      member.id,
      `snapshot.characterId "${snapshot.characterId}" !== expected "${expectedCharacterId}"`,
    );
  }

  if (season && snapshot.seasonSlug !== season) {
    return issue(
      "SEASON_MISMATCH",
      member.id,
      `snapshot.seasonSlug "${snapshot.seasonSlug}" !== evidence/manifest season "${season}"`,
    );
  }

  if (!isIsoTimestamp(snapshot.calculatedAt)) {
    return issue(
      "INVALID_TIMESTAMP",
      member.id,
      `snapshot.calculatedAt is invalid for member ${member.id}`,
    );
  }

  if (!snapshot.inputFingerprint || typeof snapshot.inputFingerprint !== "string") {
    return issue(
      "INVALID_FINGERPRINT",
      member.id,
      `snapshot.inputFingerprint is missing/invalid for member ${member.id}`,
    );
  }

  if (evidence.snapshotId) {
    if (claimedSnapshotIds.has(evidence.snapshotId)) {
      return issue(
        "DUPLICATE_SNAPSHOT_ID",
        member.id,
        `snapshotId "${evidence.snapshotId}" reused across incompatible members`,
      );
    }
    claimedSnapshotIds.add(evidence.snapshotId);
  }

  const ref = input.referenceModel;
  if (ref && !input.allowModelRelabel) {
    // Passing activeModel=v6 must not relabel a v5 snapshot as evaluated under v6.
    // We record provenance from the snapshot; conflict when an explicit evaluation
    // model ref disagrees with snapshot metadata.
    if (ref.key !== snapshot.modelKey) {
      return issue(
        "MODEL_KEY_MISMATCH",
        member.id,
        `snapshot modelKey "${snapshot.modelKey}" !== supplied model key "${ref.key}" — refusing to relabel`,
      );
    }
    if (ref.version !== snapshot.modelVersion) {
      return issue(
        "MODEL_VERSION_MISMATCH",
        member.id,
        `snapshot modelVersion ${snapshot.modelVersion} !== supplied model version ${ref.version} — refusing to relabel`,
      );
    }
  }

  return null;
}

/**
 * In persisted-snapshot-only, evaluationModel is optional metadata.
 * When supplied, it must match snapshot provenance (validated above).
 * When only activeModel is supplied for reporting, do not treat it as
 * a forced relabel — callers should omit evaluationModel or match snapshot.
 */
export function resolvePersistedProvenanceModel(
  snapshot: ScoreSnapshotDTO,
  options: {
    evaluationModel?: CalibrationModelRef | null;
    activeModel?: CalibrationModelRef | null;
  },
): { key: string; version: number; status: string | null } {
  // Always attribute to the snapshot's actual model.
  return {
    key: snapshot.modelKey,
    version: snapshot.modelVersion,
    status: options.evaluationModel?.status ?? options.activeModel?.status ?? null,
  };
}
