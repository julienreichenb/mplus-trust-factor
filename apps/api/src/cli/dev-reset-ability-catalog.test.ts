import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAbilityCatalogDevResetPlan,
  selectReviewBatchesForDevReset,
} from "./dev-reset-ability-catalog-plan.js";

function reviewBatch(input: {
  id?: string;
  items: Array<{
    id?: string;
    decisionAction?: string | null;
    withDraftRule?: boolean;
    withDraftTopology?: boolean;
    decisionEventCount?: number;
  }>;
}) {
  return {
    id: input.id ?? randomUUID(),
    items: input.items.map((item) => ({
      id: item.id ?? randomUUID(),
      decisionAction: item.decisionAction ?? null,
      draftRule: item.withDraftRule ? { id: randomUUID() } : null,
      draftTopology: item.withDraftTopology ? { id: randomUUID() } : null,
      decisionEvents: Array.from({ length: item.decisionEventCount ?? 0 }, () => ({
        id: randomUUID(),
      })),
    })),
  };
}

describe("ability-catalog dev reset plan", () => {
  it("selects all review batches, including mixed-decision batches", () => {
    const mixed = reviewBatch({
      items: [
        { decisionAction: "ACCEPT", withDraftRule: true, decisionEventCount: 2 },
        { decisionAction: null },
      ],
    });
    const undecidedOnly = reviewBatch({
      items: [{ decisionAction: null, withDraftTopology: true }],
    });

    expect(selectReviewBatchesForDevReset([mixed, undecidedOnly])).toEqual([mixed, undecidedOnly]);
  });

  it("plans deletion of mixed-decision workflow state while preserving referenced releases", () => {
    const activeId = randomUUID();
    const referencedDraftId = randomUUID();
    const disposableDraftId = randomUUID();
    const parentReleaseId = randomUUID();

    const mixedBatch = reviewBatch({
      items: [
        { decisionAction: "ACCEPT", withDraftRule: true, decisionEventCount: 1 },
        { decisionAction: null },
      ],
    });

    const plan = buildAbilityCatalogDevResetPlan({
      batches: [mixedBatch],
      activeReleases: [{ id: activeId, releaseKey: "active", status: "ACTIVE" }],
      characterScoreReleaseIds: [referencedDraftId],
      scoreSnapshotReleaseIds: [],
      allReleasesForLineage: [
        { id: activeId, previousReleaseId: parentReleaseId },
        { id: referencedDraftId, previousReleaseId: null },
        { id: disposableDraftId, previousReleaseId: null },
      ],
      candidateReleases: [
        { id: referencedDraftId, releaseKey: "referenced", status: "VALIDATED" },
        { id: disposableDraftId, releaseKey: "scratch", status: "DRAFT_BUILD" },
      ],
    });

    expect(plan.removeBatchIds).toEqual([mixedBatch.id]);
    expect(plan.removeItemCount).toBe(2);
    expect(plan.removeDraftRuleCount).toBe(1);
    expect(plan.removeDecisionEventCount).toBe(1);
    expect(plan.preserveDecisionBatchIds).toEqual([]);
    expect(plan.preserveActiveReleaseIds).toEqual([activeId]);
    expect(plan.preserveReferencedReleaseIds).toEqual(
      expect.arrayContaining([activeId, referencedDraftId, parentReleaseId]),
    );
    expect(plan.removeCandidateReleaseIds).toEqual([disposableDraftId]);
  });
});
