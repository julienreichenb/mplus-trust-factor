import { describe, expect, it } from "vitest";
import type { EvidenceAcquisitionPlanV2 } from "@mplus/contracts";
import { EVIDENCE_ACQUISITION_PLAN_SCHEMA_VERSION, EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";
import {
  assertPublicationBlocked,
  collectAcquisitionResultsForFinalize,
  isScoringV2ShadowOrchestrationEnabled,
} from "./acquisition.js";
import { buildEvidenceAcquisitionPlanV2 } from "@mplus/scoring";

function minimalPlan(slotCount: number): EvidenceAcquisitionPlanV2 {
  const dungeonCount = Math.ceil(slotCount / 2);
  const activeDungeonSlugs = Array.from({ length: dungeonCount }, (_, i) => `dungeon-${i}`);
  const candidates = activeDungeonSlugs.flatMap((dungeonSlug, di) =>
    [0, 1].map((slotIndex) => ({
      discoveryIdentity: {
        reportCode: `rep${di}${slotIndex}`,
        fightId: di * 10 + slotIndex + 1,
      },
      reportRevision: null,
      dungeonSlug,
      keyLevel: 12 - slotIndex,
      timed: true as boolean | null,
      runScore: 200 - slotIndex,
      evidenceCompleteness: 1,
      completedAt: "2026-08-01T00:00:00.000Z",
      fightDurationMs: 1_800_000,
      actorId: 1,
      accessState: "PUBLIC" as const,
      identityResolution: "RESOLVED" as const,
      fightAccessible: true,
      hardError: false,
      discoverySource: "test",
    })),
  );

  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope: {
      characterId: "char-1",
      seasonId: "season-1",
      seasonSlug: "season-tww-3",
      specializationId: null,
      classSlug: null,
      specSlug: null,
      role: "DPS",
      refreshContractHash: "contract",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2020-01-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs,
    },
    candidates,
    plannedAt: "2026-08-02T00:00:00.000Z",
  });
  expect(plan.schemaVersion).toBe(EVIDENCE_ACQUISITION_PLAN_SCHEMA_VERSION);
  expect(plan.expectedSlotCount).toBe(slotCount);
  return plan;
}

describe("scoring v2 orchestration invariants", () => {
  it("builds a 16-slot acquisition plan for fan-out", () => {
    const plan = minimalPlan(16);
    expect(plan.slots).toHaveLength(16);
    expect(new Set(plan.slots.map((s) => s.slotId)).size).toBe(16);
  });

  it("shadow orchestration requires enabled+selection+fetch", () => {
    expect(
      isScoringV2ShadowOrchestrationEnabled({
        SCORING_ENABLED: true,
        SCORING_ENABLED: true,
        SCORING_ENABLED: true,
      } as never),
    ).toBe(true);
    expect(
      isScoringV2ShadowOrchestrationEnabled({
        SCORING_ENABLED: true,
        SCORING_ENABLED: true,
        SCORING_ENABLED: false,
      } as never),
    ).toBe(false);
  });

  it("blocks publication at shadow checkpoint", () => {
    expect(() =>
      assertPublicationBlocked({ SCORING_PUBLICATION_ENABLED: true } as never),
    ).toThrow(/PUBLICATION/);
    expect(() =>
      assertPublicationBlocked({ SCORING_PUBLICATION_ENABLED: false } as never),
    ).not.toThrow();
  });

  it("collects unique acquisition results for finalize", () => {
    const results = collectAcquisitionResultsForFinalize([
      {
        acquisitionResult: {
          discoveryIdentity: { reportCode: "a", fightId: 1 },
          acquisitionStatus: "ACQUIRED",
          reportRevision: 1,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes: [],
          factSetHash: "f1",
          dimensionValidity: {
            performance: "PARTIAL",
            survival: "PARTIAL",
            utility: "PARTIAL",
            reasons: [],
          },
        },
      },
      {
        acquisitionResult: {
          discoveryIdentity: { reportCode: "a", fightId: 1 },
          acquisitionStatus: "ACQUIRED",
          reportRevision: 1,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes: [],
          factSetHash: "f1",
          dimensionValidity: {
            performance: "PARTIAL",
            survival: "PARTIAL",
            utility: "PARTIAL",
            reasons: [],
          },
        },
      },
      { acquisitionResult: null },
    ]);
    expect(results).toHaveLength(1);
  });

  it("does not import providers in finalize module surface", async () => {
    const mod = await import("./finalize.js");
    expect(typeof mod.runFinalizeEvidenceBatchV2).toBe("function");
    // Guard: finalize file must not re-export provider clients.
    expect(mod).not.toHaveProperty("createWarcraftLogsProvider");
  });
});
