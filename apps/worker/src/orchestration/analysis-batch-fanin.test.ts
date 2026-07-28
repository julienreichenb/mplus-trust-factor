import { describe, expect, it } from "vitest";
import { recountForTest } from "./analysis-batch-fanin-test-helpers.js";

/**
 * Pure fan-in counter semantics (mirrors analysis-batch-repository recount).
 * Full DB-backed tests require migrate; these lock the completion algebra.
 */
describe("analysis batch fan-in counters", () => {
  it("zero children → immediately ready", () => {
    const r = recountForTest([]);
    expect(r.terminalRunCount).toBe(0);
    expect(r.finalizationStatus).toBe("READY_TO_FINALIZE");
  });

  it("one child success → ready", () => {
    const r = recountForTest(["SUCCEEDED"]);
    expect(r.successfulRunCount).toBe(1);
    expect(r.finalizationStatus).toBe("READY_TO_FINALIZE");
  });

  it("eight children mixed terminal → ready", () => {
    const r = recountForTest([
      "SUCCEEDED",
      "SUCCEEDED",
      "UNAVAILABLE",
      "UNAVAILABLE",
      "FAILED",
      "SUCCEEDED",
      "UNAVAILABLE",
      "SUCCEEDED",
    ]);
    expect(r.terminalRunCount).toBe(8);
    expect(r.successfulRunCount).toBe(4);
    expect(r.unavailableRunCount).toBe(3);
    expect(r.failedRunCount).toBe(1);
    expect(r.finalizationStatus).toBe("READY_TO_FINALIZE");
  });

  it("partial pending → not ready", () => {
    const r = recountForTest(["SUCCEEDED", "PENDING", "RUNNING"]);
    expect(r.terminalRunCount).toBe(1);
    expect(r.finalizationStatus).toBe("PENDING");
  });

  it("duplicate terminal completion does not inflate counts", () => {
    const first = recountForTest(["SUCCEEDED", "UNAVAILABLE"]);
    const duplicate = recountForTest(["SUCCEEDED", "UNAVAILABLE"]);
    expect(first).toEqual(duplicate);
  });

  it("child unavailable and permanent failure still allow finalization", () => {
    const r = recountForTest(["UNAVAILABLE", "FAILED"]);
    expect(r.finalizationStatus).toBe("READY_TO_FINALIZE");
  });
});
