/**
 * Provider-free diagnostics for incomplete dungeon slots from persisted manifests.
 */
import type {
  CharacterSeasonEvidenceManifestV2,
  EvidenceCandidateMetadataV2,
} from "@mplus/contracts";

export type IncompleteDungeonClassification =
  | "SECOND_DISTINCT_RUN_EXISTS_BUT_WAS_INCORRECTLY_EXCLUDED"
  | "SECOND_RUN_NOT_HYDRATED_DUE_TO_DISCOVERY_CAP"
  | "ONLY_ONE_DISTINCT_CHARACTER_RUN_EXISTS"
  | "DISCOVERY_COUNTER_ACCOUNTING_BUG"
  | "CHARACTER_OR_SPEC_IDENTITY_MISMATCH";

export interface WindrunnerFightDiagnostic {
  reportCode: string;
  fightId: number;
  reportRevision: number | null;
  completedAt: string | null;
  keyLevel: number | null;
  timed: boolean | null;
  runScore: number | null;
  actorId: number | null;
  /** Spec/class when present on candidate metadata; null from manifest-only rejects. */
  identityResolution: string | null;
  accessState: string | null;
  fightAccessible: boolean | null;
  reportHydrated: boolean | null;
  excludedByHydrationCap: boolean | null;
  dungeonSlug: string;
  eligibility: "SELECTED" | "DUPLICATE_OF_SELECTED" | "ELIGIBLE_UNSELECTED" | "REJECTED" | "UNKNOWN";
  rejectionReason: string | null;
  dedupeIdentity: string;
  sameSourceFightAsSelected: boolean;
}

export interface IncompleteDungeonDiagnosis {
  dungeonSlug: string;
  classification: IncompleteDungeonClassification;
  selectedSlotCount: number;
  expectedSlotsForDungeon: 2;
  uniqueCandidateIdentities: number;
  eligibleUniqueIdentities: number;
  fights: WindrunnerFightDiagnostic[];
  notes: string[];
  providerCalls: 0;
}

function identityKey(reportCode: string, fightId: number): string {
  return `${reportCode}:${fightId}`;
}

/**
 * Diagnose a dungeon with fewer than two SELECTED slots using only persisted
 * manifest + optional discovery candidates. Zero provider calls.
 */
export function diagnoseIncompleteDungeonFromPersisted(input: {
  dungeonSlug: string;
  manifest: CharacterSeasonEvidenceManifestV2;
  /** Optional candidates from a discovery report replay (not live WCL). */
  discoveredCandidates?: readonly EvidenceCandidateMetadataV2[];
  /** When true, discovery hydrated to the report cap with this dungeon still short. */
  hydrationBudgetExhaustedWhileShort?: boolean;
}): IncompleteDungeonDiagnosis {
  const slug = input.dungeonSlug.trim().toLowerCase();
  const slots = input.manifest.slots.filter(
    (s) => s.dungeonSlug.trim().toLowerCase() === slug,
  );
  const selected = slots.filter((s) => s.state === "SELECTED" && s.identity);
  const rejected = (input.manifest.rejectedCandidates ?? []).filter(
    (r) => (r.dungeonSlug ?? "").trim().toLowerCase() === slug,
  );

  const selectedIdentities = new Set(
    selected.map((s) => identityKey(s.identity!.reportCode, s.identity!.fightId)),
  );

  const fights: WindrunnerFightDiagnostic[] = [];
  for (const s of selected) {
    const id = identityKey(s.identity!.reportCode, s.identity!.fightId);
    fights.push({
      reportCode: s.identity!.reportCode,
      fightId: s.identity!.fightId,
      reportRevision: s.identity!.reportRevision,
      completedAt: s.completedAt,
      keyLevel: s.keyLevel,
      timed: s.timed,
      runScore: s.runScore,
      actorId: s.actorId,
      identityResolution: "RESOLVED",
      accessState: "PUBLIC",
      fightAccessible: true,
      reportHydrated: true,
      excludedByHydrationCap: false,
      dungeonSlug: slug,
      eligibility: "SELECTED",
      rejectionReason: null,
      dedupeIdentity: id,
      sameSourceFightAsSelected: true,
    });
  }

  for (const r of rejected) {
    const id = identityKey(r.reportCode, r.fightId);
    const same = selectedIdentities.has(id);
    fights.push({
      reportCode: r.reportCode,
      fightId: r.fightId,
      reportRevision: r.reportRevision ?? null,
      completedAt: null,
      keyLevel: r.keyLevel ?? null,
      timed: r.timed ?? null,
      runScore: null,
      actorId: null,
      identityResolution: null,
      accessState: null,
      fightAccessible: null,
      reportHydrated: same ? true : null,
      excludedByHydrationCap: false,
      dungeonSlug: slug,
      eligibility: same
        ? "DUPLICATE_OF_SELECTED"
        : r.reason === "DUPLICATE_REPORT_FIGHT"
          ? "DUPLICATE_OF_SELECTED"
          : "REJECTED",
      rejectionReason: `${r.reason}${r.detail ? `:${r.detail}` : ""}`,
      dedupeIdentity: id,
      sameSourceFightAsSelected: same,
    });
  }

  if (input.discoveredCandidates) {
    for (const c of input.discoveredCandidates) {
      if (c.dungeonSlug.trim().toLowerCase() !== slug) continue;
      const id = identityKey(c.discoveryIdentity.reportCode, c.discoveryIdentity.fightId);
      if (fights.some((f) => f.dedupeIdentity === id)) continue;
      fights.push({
        reportCode: c.discoveryIdentity.reportCode,
        fightId: c.discoveryIdentity.fightId,
        reportRevision: c.reportRevision ?? null,
        completedAt: c.completedAt,
        keyLevel: c.keyLevel,
        timed: c.timed,
        runScore: c.runScore,
        actorId: c.actorId,
        identityResolution: c.identityResolution ?? null,
        accessState: c.accessState ?? null,
        fightAccessible: c.fightAccessible ?? null,
        reportHydrated: true,
        excludedByHydrationCap: false,
        dungeonSlug: slug,
        eligibility: "ELIGIBLE_UNSELECTED",
        rejectionReason: null,
        dedupeIdentity: id,
        sameSourceFightAsSelected: selectedIdentities.has(id),
      });
    }
  }

  const uniqueIds = new Set(fights.map((f) => f.dedupeIdentity));
  const uniqueCandidateIdentities = uniqueIds.size;
  const eligibleUniqueIdentities = selectedIdentities.size;
  const notes: string[] = [];

  // Distinct non-duplicate rejected identities would imply an incorrect exclusion.
  const distinctRejectedOther = new Set(
    fights
      .filter((f) => f.eligibility === "REJECTED" && !f.sameSourceFightAsSelected)
      .map((f) => f.dedupeIdentity),
  );

  let classification: IncompleteDungeonClassification;
  if (distinctRejectedOther.size > 0) {
    classification = "SECOND_DISTINCT_RUN_EXISTS_BUT_WAS_INCORRECTLY_EXCLUDED";
    notes.push(
      `Found ${distinctRejectedOther.size} distinct rejected identities that are not the selected fight`,
    );
  } else if (
    input.hydrationBudgetExhaustedWhileShort === true &&
    uniqueCandidateIdentities <= 1
  ) {
    classification = "SECOND_RUN_NOT_HYDRATED_DUE_TO_DISCOVERY_CAP";
    notes.push(
      "Hydration budget exhausted while dungeon still short of two identities — do not infer the second run does not exist",
    );
  } else if (uniqueCandidateIdentities <= 1 && selectedIdentities.size <= 1) {
    classification = "ONLY_ONE_DISTINCT_CHARACTER_RUN_EXISTS";
    notes.push(
      "Selector saw a single distinct reportCode/fightId among persisted candidates; verify unhydrated reports before concluding history is insufficient",
    );
  } else if (
    uniqueCandidateIdentities >= 2 &&
    selectedIdentities.size < 2 &&
    distinctRejectedOther.size === 0
  ) {
    classification = "CHARACTER_OR_SPEC_IDENTITY_MISMATCH";
    notes.push("Multiple identities present but second slot not selected without duplicate reason");
  } else {
    classification = "ONLY_ONE_DISTINCT_CHARACTER_RUN_EXISTS";
    notes.push("Default: insufficient distinct runs for two-slot policy among persisted data");
  }

  return {
    dungeonSlug: slug,
    classification,
    selectedSlotCount: selected.length,
    expectedSlotsForDungeon: 2,
    uniqueCandidateIdentities,
    eligibleUniqueIdentities,
    fights,
    notes,
    providerCalls: 0,
  };
}

/** Detect the historical eligible-counter double-count (sum across shared slot chains). */
export function isEligibleCounterDoubleCounted(input: {
  candidateCount: number;
  eligibleCount: number;
  slotsPerDungeon?: number;
}): boolean {
  const slots = input.slotsPerDungeon ?? 2;
  return (
    input.candidateCount >= 1 &&
    input.eligibleCount === input.candidateCount * slots &&
    input.eligibleCount > input.candidateCount
  );
}
