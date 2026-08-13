/**
 * Reconcile deferred scoring digests onto refresh presentation / coverage.
 * Refresh may skip legacy analyze-run; detailed evidence still arrives via
 * scoreCharacter orchestration digests.
 */

export type DetailedAcquisitionSlotState =
  | "no_candidate"
  | "candidate_selected"
  | "missing_report_identity"
  | "missing_revision"
  | "actor_unresolved"
  | "ownership_rejected"
  | "acquisition_failed"
  | "package_created"
  | "package_reused"
  | "digest_created"
  | "digest_reused"
  | "dimension_dataset_missing";

export interface SelectedRunReconcileInput {
  canonicalRunId: string;
  dungeonSlug: string;
}

export interface DigestReconcileInput {
  dungeonSlug: string;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  utilityCompleteness: string;
  survivalCompleteness: string;
}

export interface FightAccountingReconcileInput {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  packageCreated: boolean;
  digestsCreated: number;
  digestsReused: number;
}

export interface DetailedAcquisitionReconcileResult {
  detailedRunIds: string[];
  detailedRunCount: number;
  runCoverageById: Record<string, number>;
  presentationMetaPatch: Record<
    string,
    {
      wclReportMatched: boolean;
      wclCoverageRatio: number;
      hasDetailedAnalysis: boolean;
    }
  >;
  slotDiagnostics: Array<{
    dungeonSlug: string;
    canonicalRunId: string | null;
    state: DetailedAcquisitionSlotState;
    reportCode: string | null;
    fightId: number | null;
    reportRevision: number | null;
    utilityCompleteness: string | null;
    survivalCompleteness: string | null;
  }>;
}

export function reconcileDetailedAcquisitionFromDigests(input: {
  selectedRuns: SelectedRunReconcileInput[];
  digests: DigestReconcileInput[];
  fightAccounting?: FightAccountingReconcileInput[];
  targetDigestFailures?: Array<{ slotId: string; code: string }>;
  fightFailures?: Array<{
    sourceFight: { reportCode: string; fightId: number; reportRevision: number };
    code: string;
  }>;
}): DetailedAcquisitionReconcileResult {
  const digestsByDungeon = new Map<string, DigestReconcileInput>();
  for (const digest of input.digests) {
    const key = digest.dungeonSlug.trim().toLowerCase();
    if (!digestsByDungeon.has(key)) digestsByDungeon.set(key, digest);
  }

  const accountingByFight = new Map<string, FightAccountingReconcileInput>();
  for (const row of input.fightAccounting ?? []) {
    accountingByFight.set(
      `${row.reportCode}:${row.fightId}:${row.reportRevision}`,
      row,
    );
  }

  const failureByFight = new Map<string, string>();
  for (const fail of input.fightFailures ?? []) {
    failureByFight.set(
      `${fail.sourceFight.reportCode}:${fail.sourceFight.fightId}:${fail.sourceFight.reportRevision}`,
      fail.code,
    );
  }

  const detailedRunIds: string[] = [];
  const runCoverageById: Record<string, number> = {};
  const presentationMetaPatch: DetailedAcquisitionReconcileResult["presentationMetaPatch"] =
    {};
  const slotDiagnostics: DetailedAcquisitionReconcileResult["slotDiagnostics"] = [];

  for (const selected of input.selectedRuns) {
    const dungeonKey = selected.dungeonSlug.trim().toLowerCase();
    const digest = digestsByDungeon.get(dungeonKey) ?? null;

    if (!digest) {
      slotDiagnostics.push({
        dungeonSlug: selected.dungeonSlug,
        canonicalRunId: selected.canonicalRunId,
        state: "no_candidate",
        reportCode: null,
        fightId: null,
        reportRevision: null,
        utilityCompleteness: null,
        survivalCompleteness: null,
      });
      continue;
    }

    const fightKey = `${digest.reportCode}:${digest.fightId}:${digest.reportRevision}`;
    const accounting = accountingByFight.get(fightKey);
    const fightFail = failureByFight.get(fightKey);

    let state: DetailedAcquisitionSlotState = "digest_reused";
    if (fightFail) {
      state = "acquisition_failed";
    } else if (digest.utilityCompleteness === "UNAVAILABLE") {
      state = "dimension_dataset_missing";
    } else if (accounting?.packageCreated) {
      state = "package_created";
    } else if ((accounting?.digestsCreated ?? 0) > 0) {
      state = "digest_created";
    } else if (accounting && !accounting.packageCreated) {
      state = "package_reused";
    } else {
      state = "candidate_selected";
    }

    // A persisted target digest means detailed analysis evidence exists for the slot.
    detailedRunIds.push(selected.canonicalRunId);
    runCoverageById[selected.canonicalRunId] = 1;
    presentationMetaPatch[selected.canonicalRunId] = {
      wclReportMatched: true,
      wclCoverageRatio: 1,
      hasDetailedAnalysis: true,
    };

    slotDiagnostics.push({
      dungeonSlug: selected.dungeonSlug,
      canonicalRunId: selected.canonicalRunId,
      state,
      reportCode: digest.reportCode,
      fightId: digest.fightId,
      reportRevision: digest.reportRevision,
      utilityCompleteness: digest.utilityCompleteness,
      survivalCompleteness: digest.survivalCompleteness,
    });
  }

  return {
    detailedRunIds,
    detailedRunCount: detailedRunIds.length,
    runCoverageById,
    presentationMetaPatch,
    slotDiagnostics,
  };
}
