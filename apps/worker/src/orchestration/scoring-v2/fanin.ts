import type { EvidenceV2SlotJobStatus } from "@mplus/contracts";

const TERMINAL: ReadonlySet<EvidenceV2SlotJobStatus> = new Set([
  "SUCCEEDED",
  "PARTIAL",
  "UNAVAILABLE",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
]);

export function isEvidenceV2SlotTerminal(status: EvidenceV2SlotJobStatus): boolean {
  return TERMINAL.has(status);
}

export interface EvidenceV2FanInCounts {
  expectedSlotCount: number;
  terminalSlotCount: number;
  succeededSlotCount: number;
  partialSlotCount: number;
  unavailableSlotCount: number;
  failedSlotCount: number;
  cancelledSlotCount: number;
  supersededSlotCount: number;
  allTerminal: boolean;
  readyToFinalize: boolean;
}

/** Pure fan-in algebra for V2 slot statuses (16-slot batches included). */
export function recountEvidenceV2Slots(
  statuses: readonly EvidenceV2SlotJobStatus[],
  expectedSlotCount?: number,
): EvidenceV2FanInCounts {
  const expected = expectedSlotCount ?? statuses.length;
  const succeededSlotCount = statuses.filter((s) => s === "SUCCEEDED").length;
  const partialSlotCount = statuses.filter((s) => s === "PARTIAL").length;
  const unavailableSlotCount = statuses.filter((s) => s === "UNAVAILABLE").length;
  const failedSlotCount = statuses.filter((s) => s === "FAILED").length;
  const cancelledSlotCount = statuses.filter((s) => s === "CANCELLED").length;
  const supersededSlotCount = statuses.filter((s) => s === "SUPERSEDED").length;
  const terminalSlotCount = statuses.filter((s) => isEvidenceV2SlotTerminal(s)).length;
  const allTerminal = expected === 0 || (statuses.length >= expected && terminalSlotCount >= expected);
  return {
    expectedSlotCount: expected,
    terminalSlotCount,
    succeededSlotCount,
    partialSlotCount,
    unavailableSlotCount,
    failedSlotCount,
    cancelledSlotCount,
    supersededSlotCount,
    allTerminal,
    readyToFinalize: allTerminal,
  };
}
