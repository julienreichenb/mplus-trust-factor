import { describe, expect, it, vi } from "vitest";
import { runFinalizeEvidenceBatchV2 } from "./finalize.js";

const MANIFEST_DOC = {
  schemaVersion: "2.0.0",
  selectorVersion: "sel",
  characterId: "c1",
  seasonId: "s1",
  seasonSlug: "season",
  specSlug: "affliction",
  role: "DPS",
  refreshContractHash: "r",
  evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
  highKeyPolicyId: "hk",
  activeDungeonSlugs: [],
  expectedSlotCount: 0,
  selectedSlotCount: 0,
  selectedAt: "2026-08-01T12:00:00.000Z",
  acquisitionPlanContentHash: "plan",
  slots: [],
  rejectedCandidates: [],
  coverage: {
    state: "INSUFFICIENT",
    expectedSlotCount: 0,
    selectedSlotCount: 0,
    dungeonCount: 0,
    dungeonsRepresented: 0,
    slotFillRatio: 0,
    dungeonFillRatio: 0,
  },
  contentHash: "manifest-hash-empty",
  diagnostics: {
    candidatesConsidered: 0,
    candidatesEligible: 0,
    candidatesRejected: 0,
    rejectionReasonCounts: {},
    perDungeon: [],
  },
};

describe("runFinalizeEvidenceBatchV2 FINALIZING recovery", () => {
  it("releases FINALIZING claim when dimension persist fails so redelivery can reclaim", async () => {
    const releaseFinalizationClaim = vi.fn().mockResolvedValue({ ok: true });
    const claimFinalization = vi.fn().mockResolvedValue({
      batch: {
        characterId: "c1",
        seasonId: "s1",
        scoreModelId: "m1",
      },
      meta: {
        acquisitionPlanContentHash: "plan",
        refreshGeneration: 1,
        cancelled: false,
        manifestId: "manifest-1",
        manifestContentHash: "manifest-hash-empty",
        acquisitionPlan: { contentHash: "plan", expectedSlotCount: 0, slots: [] },
        slots: [],
      },
    });

    const container = {
      env: {
        SCORING_V2_ENABLED: true,
        SCORING_V2_DIMENSIONS_ENABLED: true,
        SCORING_V2_PUBLICATION_ENABLED: false,
        SCORING_V2_PERFORMANCE_ENABLED: true,
        SCORING_V2_SURVIVAL_ENABLED: false,
        SCORING_V2_UTILITY_ENABLED: false,
        SCORING_V2_EXPERIENCE_ENABLED: false,
        SCORING_V2_RELATIVE_DAMAGE_MODE: "off",
      },
      logger: { info: vi.fn(), error: vi.fn() },
      prisma: {
        evidenceManifest: {
          findUnique: vi.fn().mockResolvedValue({ document: MANIFEST_DOC }),
        },
      },
      repositories: {
        evidenceV2Batch: {
          getById: vi.fn().mockResolvedValue({
            batch: { finalizationStatus: "READY_TO_FINALIZE" },
            meta: {
              acquisitionPlanContentHash: "plan",
              refreshGeneration: 1,
              cancelled: false,
              manifestId: "manifest-1",
              manifestContentHash: "manifest-hash-empty",
            },
          }),
          claimFinalization,
          releaseFinalizationClaim,
          attachManifest: vi.fn(),
          markAdmissionReleased: vi.fn(),
          markFinalized: vi.fn(),
        },
        evidence: {
          listFactSetsForManifest: vi.fn().mockResolvedValue([]),
          createDimensionComputationIdempotent: vi
            .fn()
            .mockRejectedValue(new Error("dimension_computation_conflict: reason=fingerprint_mismatch")),
        },
      },
    };

    await expect(
      runFinalizeEvidenceBatchV2(container as never, {
        analysisBatchId: "batch-1",
        acquisitionPlanContentHash: "plan",
        refreshGeneration: 1,
      } as never),
    ).rejects.toThrow(/shadow_dimension_persist_partial_failure|fingerprint_mismatch/);

    expect(releaseFinalizationClaim).toHaveBeenCalledWith("batch-1");
    expect(container.repositories.evidenceV2Batch.markFinalized).not.toHaveBeenCalled();
  });
});
