import { describe, expect, it, vi } from "vitest";
import {
  persistShadowDimensionComputations,
  resolveEnabledShadowDimensions,
} from "./dimension-finalizer.js";

describe("persistShadowDimensionComputations isolation", () => {
  it("continues sibling persists when one write fails", async () => {
    const create = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("dimension_computation_conflict: reason=fingerprint_mismatch");
      })
      .mockImplementation(async (input: { dimension: string }) => ({
        row: { id: `id-${input.dimension}` },
        created: true,
      }));

    const logger = { error: vi.fn(), info: vi.fn() };
    const container = {
      logger,
      repositories: {
        evidence: {
          listFactSetsForManifest: vi.fn().mockResolvedValue([]),
          createDimensionComputationIdempotent: create,
        },
      },
    };

    const result = await persistShadowDimensionComputations(container as never, {
      characterId: "00000000-0000-4000-8000-000000000001",
      seasonId: "00000000-0000-4000-8000-000000000002",
      scoreModelId: "00000000-0000-4000-8000-000000000003",
      manifestId: "00000000-0000-4000-8000-000000000004",
      expectedManifestContentHash: "manifest-hash-empty",
      enabledDimensions: ["PERFORMANCE", "SURVIVAL", "EXPERIENCE"],
      experienceHistory: null,
      manifestDocument: {
        schemaVersion: "2.0.0",
        selectorVersion: "sel",
        characterId: "00000000-0000-4000-8000-000000000001",
        seasonId: "00000000-0000-4000-8000-000000000002",
        seasonSlug: "season",
        classSlug: "warlock",
        specSlug: "affliction",
        role: "DPS",
        refreshContractHash: "r",
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        highKeyPolicyId: "hk",
        activeDungeonSlugs: [],
        expectedSlotCount: 0,
        selectedSlotCount: 0,
        selectedAt: "2026-08-01T12:00:00.000Z",
        acquisitionPlanContentHash: "p",
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
      },
      computedAt: new Date("2026-08-01T12:00:00.000Z"),
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.integrityConflict).toBe(true);
    expect(result.persisted).toHaveLength(2);
    expect(result.allPersisted).toBe(false);
  });

  it("resolveEnabledShadowDimensions respects flags", () => {
    expect(
      resolveEnabledShadowDimensions({
        SCORING_ENABLED: true,
        SCORING_ENABLED: false,
        SCORING_ENABLED: true,
        SCORING_ENABLED: false,
      }),
    ).toEqual(["PERFORMANCE", "UTILITY"]);
  });
});
