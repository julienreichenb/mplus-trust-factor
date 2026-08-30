/**
 * Pure selection logic for ability-catalog:dev:reset (local dev only).
 */

export type DevResetReviewBatch = {
  id: string;
  items: Array<{
    id: string;
    decisionAction: string | null;
    draftRule: { id: string } | null;
    draftTopology: { id: string } | null;
    decisionEvents: Array<{ id: string }>;
  }>;
};

export type DevResetReleaseRow = {
  id: string;
  releaseKey: string;
  status: string;
  previousReleaseId?: string | null;
};

/**
 * Local dev reset clears all review/import workflow batches.
 * A single curator decision must not pin stale evidence for the whole batch.
 */
export function selectReviewBatchesForDevReset(batches: DevResetReviewBatch[]): DevResetReviewBatch[] {
  return batches;
}

export function expandReferencedReleaseLineage(
  seedReleaseIds: Iterable<string>,
  releases: Array<{ id: string; previousReleaseId: string | null }>,
): Set<string> {
  const referenced = new Set(seedReleaseIds);
  let frontier = [...referenced];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const release of releases) {
      if (!frontier.includes(release.id)) continue;
      const parentId = release.previousReleaseId;
      if (parentId && !referenced.has(parentId)) {
        referenced.add(parentId);
        next.push(parentId);
      }
    }
    frontier = next;
  }
  return referenced;
}

export function selectDisposableCandidateReleases(
  candidates: DevResetReleaseRow[],
  referencedReleaseIds: ReadonlySet<string>,
): DevResetReleaseRow[] {
  return candidates.filter(
    (release) =>
      (release.status === "DRAFT_BUILD" ||
        release.status === "VALIDATED" ||
        release.status === "REJECTED") &&
      !referencedReleaseIds.has(release.id),
  );
}

export type AbilityCatalogDevResetPlan = {
  removeBatchIds: string[];
  removeBatchCount: number;
  removeItemCount: number;
  removeDraftRuleCount: number;
  removeDraftTopologyCount: number;
  removeDecisionEventCount: number;
  preserveDecisionBatchIds: string[];
  preserveActiveReleaseIds: string[];
  preserveReferencedReleaseIds: string[];
  removeCandidateReleaseIds: string[];
  removeCandidateReleases: DevResetReleaseRow[];
};

export function buildAbilityCatalogDevResetPlan(input: {
  batches: DevResetReviewBatch[];
  activeReleases: DevResetReleaseRow[];
  characterScoreReleaseIds: string[];
  scoreSnapshotReleaseIds: string[];
  allReleasesForLineage: Array<{ id: string; previousReleaseId: string | null }>;
  candidateReleases: DevResetReleaseRow[];
}): AbilityCatalogDevResetPlan {
  const disposableBatches = selectReviewBatchesForDevReset(input.batches);
  const referencedReleaseIds = expandReferencedReleaseLineage(
    [
      ...input.activeReleases.map((release) => release.id),
      ...input.characterScoreReleaseIds,
      ...input.scoreSnapshotReleaseIds,
    ],
    input.allReleasesForLineage,
  );
  const removableCandidates = selectDisposableCandidateReleases(
    input.candidateReleases,
    referencedReleaseIds,
  );

  return {
    removeBatchIds: disposableBatches.map((batch) => batch.id),
    removeBatchCount: disposableBatches.length,
    removeItemCount: disposableBatches.reduce((count, batch) => count + batch.items.length, 0),
    removeDraftRuleCount: disposableBatches.reduce(
      (count, batch) => count + batch.items.filter((item) => item.draftRule).length,
      0,
    ),
    removeDraftTopologyCount: disposableBatches.reduce(
      (count, batch) => count + batch.items.filter((item) => item.draftTopology).length,
      0,
    ),
    removeDecisionEventCount: disposableBatches.reduce(
      (count, batch) =>
        count + batch.items.reduce((eventCount, item) => eventCount + item.decisionEvents.length, 0),
      0,
    ),
    preserveDecisionBatchIds: [],
    preserveActiveReleaseIds: input.activeReleases.map((release) => release.id),
    preserveReferencedReleaseIds: [...referencedReleaseIds],
    removeCandidateReleaseIds: removableCandidates.map((release) => release.id),
    removeCandidateReleases: removableCandidates,
  };
}
