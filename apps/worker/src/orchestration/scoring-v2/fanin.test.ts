import { describe, expect, it } from "vitest";
import { recountEvidenceV2Slots, isEvidenceV2SlotTerminal } from "./fanin.js";
import type { EvidenceV2SlotJobStatus } from "@mplus/contracts";

describe("evidence v2 fan-in", () => {
  it("16-slot mixed terminal → ready", () => {
    const statuses: EvidenceV2SlotJobStatus[] = [
      "SUCCEEDED",
      "SUCCEEDED",
      "PARTIAL",
      "PARTIAL",
      "UNAVAILABLE",
      "UNAVAILABLE",
      "FAILED",
      "SUCCEEDED",
      "PARTIAL",
      "UNAVAILABLE",
      "SUCCEEDED",
      "FAILED",
      "CANCELLED",
      "SUPERSEDED",
      "SUCCEEDED",
      "PARTIAL",
    ];
    expect(statuses).toHaveLength(16);
    const r = recountEvidenceV2Slots(statuses, 16);
    expect(r.terminalSlotCount).toBe(16);
    expect(r.allTerminal).toBe(true);
    expect(r.readyToFinalize).toBe(true);
    expect(r.succeededSlotCount).toBe(5);
    expect(r.partialSlotCount).toBe(4);
  });

  it("partial pending → not ready", () => {
    const r = recountEvidenceV2Slots(["SUCCEEDED", "PENDING", "RUNNING"], 3);
    expect(r.terminalSlotCount).toBe(1);
    expect(r.readyToFinalize).toBe(false);
  });

  it("zero expected slots → immediately ready", () => {
    const r = recountEvidenceV2Slots([], 0);
    expect(r.readyToFinalize).toBe(true);
  });

  it("marks terminal statuses correctly", () => {
    expect(isEvidenceV2SlotTerminal("SUCCEEDED")).toBe(true);
    expect(isEvidenceV2SlotTerminal("PARTIAL")).toBe(true);
    expect(isEvidenceV2SlotTerminal("RUNNING")).toBe(false);
    expect(isEvidenceV2SlotTerminal("PENDING")).toBe(false);
  });

  it("duplicate terminal recount is deterministic", () => {
    const a = recountEvidenceV2Slots(["SUCCEEDED", "UNAVAILABLE", "FAILED"], 3);
    const b = recountEvidenceV2Slots(["SUCCEEDED", "UNAVAILABLE", "FAILED"], 3);
    expect(a).toEqual(b);
  });
});
