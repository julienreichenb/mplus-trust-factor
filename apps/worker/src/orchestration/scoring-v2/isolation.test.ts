import { describe, expect, it } from "vitest";
import { QUEUE_NAMES } from "@mplus/contracts";
import {
  analyzeEvidenceSlotJobV2Schema,
  finalizeEvidenceBatchJobV2Schema,
} from "@mplus/contracts";
import {
  analyzeEvidenceSlotV2DedupeKey,
  finalizeEvidenceBatchV2DedupeKey,
} from "../../dedupe.js";

describe("scoring v2 queue isolation", () => {
  it("keeps V2 queues off calibration and refresh surfaces", () => {
    expect(QUEUE_NAMES.analyzeEvidenceSlot).toBe("analyze-evidence-slot");
    expect(QUEUE_NAMES.finalizeAnalysisBatch).toBe("finalize-analysis-batch");
    expect(QUEUE_NAMES.analyzeEvidenceSlot).not.toBe(QUEUE_NAMES.calibrationRun);
    expect(QUEUE_NAMES.finalizeAnalysisBatch).not.toBe(QUEUE_NAMES.calibrationRun);
    expect(QUEUE_NAMES.analyzeEvidenceSlot).not.toBe(QUEUE_NAMES.refreshCharacter);
    expect(QUEUE_NAMES.finalizeAnalysisBatch).not.toBe(QUEUE_NAMES.refreshCharacter);
  });

  it("builds deterministic slot/finalize dedupe keys", () => {
    const slot = analyzeEvidenceSlotJobV2Schema.parse({
      analysisBatchId: "11111111-1111-4111-8111-111111111111",
      acquisitionPlanContentHash: "plan-hash-abc",
      slotId: "dungeon-a:0",
      enabledConsumers: ["PERFORMANCE"],
      refreshGeneration: 1,
      requestedAt: "2026-08-02T00:00:00.000Z",
    });
    const slotKey = analyzeEvidenceSlotV2DedupeKey(slot);
    expect(analyzeEvidenceSlotV2DedupeKey(slot)).toBe(slotKey);

    const fin = finalizeEvidenceBatchJobV2Schema.parse({
      analysisBatchId: "11111111-1111-4111-8111-111111111111",
      acquisitionPlanContentHash: "plan-hash-abc",
      expectedTerminalSlotCount: 16,
      refreshGeneration: 1,
      requestedAt: "2026-08-02T00:00:00.000Z",
    });
    expect(finalizeEvidenceBatchV2DedupeKey(fin)).toBe(finalizeEvidenceBatchV2DedupeKey(fin));
  });
});
