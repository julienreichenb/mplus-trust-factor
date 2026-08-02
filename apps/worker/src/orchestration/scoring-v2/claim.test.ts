import { describe, expect, it } from "vitest";
import { isEvidenceV2SlotTerminal, recountEvidenceV2Slots } from "./fanin.js";
import type { EvidenceV2SlotJobStatus } from "@mplus/contracts";

/**
 * Compare-and-set claim / terminal redelivery algebra (mirrors repository behaviour).
 */
function claimSlot(
  status: EvidenceV2SlotJobStatus,
): "claimed" | "already_terminal" | "lost_claim" {
  if (isEvidenceV2SlotTerminal(status)) return "already_terminal";
  if (status === "RUNNING") return "lost_claim";
  return "claimed";
}

describe("scoring v2 slot claim / redelivery", () => {
  it("claims PENDING once", () => {
    expect(claimSlot("PENDING")).toBe("claimed");
  });

  it("terminal redelivery is a no-op", () => {
    for (const status of [
      "SUCCEEDED",
      "PARTIAL",
      "UNAVAILABLE",
      "FAILED",
      "CANCELLED",
      "SUPERSEDED",
    ] as const) {
      expect(claimSlot(status)).toBe("already_terminal");
    }
  });

  it("concurrent RUNNING loses claim", () => {
    expect(claimSlot("RUNNING")).toBe("lost_claim");
  });

  it("all 16 terminal enables finalize even with partials", () => {
    const statuses = Array.from({ length: 16 }, (_, i) =>
      i % 3 === 0 ? "PARTIAL" : i % 3 === 1 ? "SUCCEEDED" : "UNAVAILABLE",
    ) as EvidenceV2SlotJobStatus[];
    const r = recountEvidenceV2Slots(statuses, 16);
    expect(r.readyToFinalize).toBe(true);
  });
});
