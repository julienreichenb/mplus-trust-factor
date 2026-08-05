/**
 * Supersede a frozen evidence manifest when WCL report revisions change.
 * Preserves reportCode/fightId/slot assignment; updates only reportRevision.
 * Never mutates the prior frozen document in place.
 */
import type {
  CharacterSeasonEvidenceManifestV2,
  EvidenceSlotV2,
} from "@mplus/contracts";
import {
  buildEvidenceManifestContentHashInput,
  computeEvidenceManifestContentHash,
} from "@mplus/scoring";

export interface ReportRevisionObservation {
  reportCode: string;
  /** Authoritative current WCL revision for the report. */
  authoritativeRevision: number;
  revisionSource: "wcl_report_metadata";
  revisionResolvedAt: string;
  /** When resolving per fight, whether the fight still exists in the report. */
  fightId?: number;
  fightPresent?: boolean;
  characterPresent?: boolean;
}

export interface ManifestRevisionChange {
  slotId: string;
  reportCode: string;
  fightId: number;
  previousRevision: number;
  newRevision: number;
  revisionChangeReason: "WCL_REPORT_REVISION_ADVANCED" | "SLOT_STALE_FIGHT_MISSING";
}

export interface RevisionReconcileDiagnostics {
  reportCode: string;
  fightId: number;
  discoveredRevision: number;
  revisionSource: string;
  revisionResolvedAt: string;
}

export type SupersedingManifestDocument = CharacterSeasonEvidenceManifestV2 & {
  supersedesManifestId: string;
  revisionReconciliation: {
    reconciledAt: string;
    changes: ManifestRevisionChange[];
    diagnostics: RevisionReconcileDiagnostics[];
  };
};

export interface ManifestRevisionReconcileResult {
  changed: boolean;
  supersedesManifestId: string;
  previousDocument: CharacterSeasonEvidenceManifestV2;
  document: SupersedingManifestDocument;
  changes: ManifestRevisionChange[];
  staleSlotIds: string[];
}

function rehashManifest(
  document: CharacterSeasonEvidenceManifestV2,
): CharacterSeasonEvidenceManifestV2 {
  const hashInput = buildEvidenceManifestContentHashInput({
    selectorVersion: document.selectorVersion,
    characterId: document.characterId,
    seasonId: document.seasonId,
    seasonSlug: document.seasonSlug,
    classSlug: document.classSlug ?? null,
    specSlug: document.specSlug,
    role: document.role,
    refreshContractHash: document.refreshContractHash,
    evidenceCutoffAt: document.evidenceCutoffAt,
    highKeyPolicyId: document.highKeyPolicyId,
    activeDungeonSlugs: document.activeDungeonSlugs,
    expectedSlotCount: document.expectedSlotCount,
    selectedSlotCount: document.selectedSlotCount,
    acquisitionPlanContentHash: document.acquisitionPlanContentHash,
    slots: document.slots,
    rejectedCandidates: document.rejectedCandidates,
    coverage: document.coverage,
  });
  return {
    ...document,
    contentHash: computeEvidenceManifestContentHash(hashInput),
  };
}

/**
 * Apply authoritative report revisions to selected slots.
 * Same reportCode+fightId kept; revision and contentHash update.
 */
export function reconcileManifestReportRevisions(input: {
  priorManifestId: string;
  document: CharacterSeasonEvidenceManifestV2;
  observations: readonly ReportRevisionObservation[];
  reconciledAt?: string;
}): ManifestRevisionReconcileResult {
  const reconciledAt = input.reconciledAt ?? new Date().toISOString();
  const byCode = new Map(
    input.observations.map((o) => [o.reportCode, o] as const),
  );
  // Prefer fight-scoped observations when present (same report, different fight presence).
  const byFight = new Map<string, ReportRevisionObservation>();
  for (const o of input.observations) {
    if (o.fightId != null) {
      byFight.set(`${o.reportCode}:${o.fightId}`, o);
    }
  }

  const changes: ManifestRevisionChange[] = [];
  const staleSlotIds: string[] = [];
  const diagnostics: RevisionReconcileDiagnostics[] = [];

  const slots: EvidenceSlotV2[] = input.document.slots.map((slot) => {
    if (slot.state !== "SELECTED" || !slot.identity) return slot;
    const fightKey = `${slot.identity.reportCode}:${slot.identity.fightId}`;
    const obs = byFight.get(fightKey) ?? byCode.get(slot.identity.reportCode);
    if (!obs) return slot;

    diagnostics.push({
      reportCode: slot.identity.reportCode,
      fightId: slot.identity.fightId,
      discoveredRevision: obs.authoritativeRevision,
      revisionSource: obs.revisionSource,
      revisionResolvedAt: obs.revisionResolvedAt,
    });

    if (obs.fightPresent === false || obs.characterPresent === false) {
      staleSlotIds.push(slot.slotId);
      changes.push({
        slotId: slot.slotId,
        reportCode: slot.identity.reportCode,
        fightId: slot.identity.fightId,
        previousRevision: slot.identity.reportRevision,
        newRevision: obs.authoritativeRevision,
        revisionChangeReason: "SLOT_STALE_FIGHT_MISSING",
      });
      return {
        ...slot,
        state: "MISSING_NO_CANDIDATE",
        identity: null,
        fallbackReason: "REPORT_REVISION_FIGHT_OR_CHARACTER_ABSENT",
        selectedRank: null,
        keyLevel: null,
        timed: null,
        runScore: null,
        completedAt: null,
        actorId: null,
        factSetHash: null,
        datasetHashes: null,
        dimensionValidity: null,
      };
    }

    if (slot.identity.reportRevision === obs.authoritativeRevision) {
      return slot;
    }

    changes.push({
      slotId: slot.slotId,
      reportCode: slot.identity.reportCode,
      fightId: slot.identity.fightId,
      previousRevision: slot.identity.reportRevision,
      newRevision: obs.authoritativeRevision,
      revisionChangeReason: "WCL_REPORT_REVISION_ADVANCED",
    });

    return {
      ...slot,
      identity: {
        ...slot.identity,
        reportRevision: obs.authoritativeRevision,
      },
    };
  });

  const selectedSlotCount = slots.filter((s) => s.state === "SELECTED").length;
  const dungeonsRepresented = new Set(
    slots.filter((s) => s.state === "SELECTED").map((s) => s.dungeonSlug),
  ).size;
  const coverage = {
    ...input.document.coverage,
    selectedSlotCount,
    dungeonsRepresented,
    slotFillRatio:
      input.document.expectedSlotCount > 0
        ? selectedSlotCount / input.document.expectedSlotCount
        : 0,
    dungeonFillRatio:
      input.document.coverage.dungeonCount > 0
        ? dungeonsRepresented / input.document.coverage.dungeonCount
        : 0,
  };

  const base: CharacterSeasonEvidenceManifestV2 = rehashManifest({
    ...input.document,
    slots,
    selectedSlotCount,
    coverage,
  });

  const document: SupersedingManifestDocument = {
    ...base,
    supersedesManifestId: input.priorManifestId,
    revisionReconciliation: {
      reconciledAt,
      changes,
      diagnostics,
    },
  };

  return {
    changed: changes.length > 0,
    supersedesManifestId: input.priorManifestId,
    previousDocument: input.document,
    document,
    changes,
    staleSlotIds,
  };
}
