import { describe, expect, it } from "vitest";
import {
  extractRefreshEta,
  formatCoarseWaitRange,
  formatJobsAhead,
  presentRefreshEtaSummary,
  schedulingExplanation,
} from "./refreshEta";

describe("refreshEta presentation", () => {
  it("returns null when ETA fields are absent (flag off)", () => {
    expect(extractRefreshEta({ jobId: "x" } as never)).toBeNull();
    expect(extractRefreshEta(null)).toBeNull();
  });

  it("formats coarse wait ranges without false precision", () => {
    expect(formatCoarseWaitRange(0)).toBe("starting soon");
    expect(formatCoarseWaitRange(30)).toBe("under 30s");
    expect(formatCoarseWaitRange(300)).toBe("about 2–5 min");
    expect(formatCoarseWaitRange(null)).toBeNull();
  });

  it("formats approximate jobs ahead", () => {
    expect(formatJobsAhead(0)).toContain("none");
    expect(formatJobsAhead(4)).toBe("Approximate jobs ahead: ~4");
  });

  it("explains blocked scheduling states", () => {
    expect(schedulingExplanation("PAUSED")).toMatch(/paused/i);
    expect(schedulingExplanation("CIRCUIT_OPEN")).toMatch(/circuit/i);
  });

  it("summarizes wait or explanation", () => {
    const withWait = presentRefreshEtaSummary({
      activeRefreshCount: 1,
      effectiveWorkerCapacity: 0,
      observedThroughput: 0.02,
      queuePosition: 2,
      estimatedWaitSeconds: 120,
      estimateConfidence: "MEDIUM",
      schedulingState: "RUNNING",
    });
    expect(withWait.waitRange).toBeTruthy();
    expect(withWait.explanation).toBeNull();

    const blocked = presentRefreshEtaSummary({
      activeRefreshCount: 0,
      effectiveWorkerCapacity: 0,
      observedThroughput: null,
      queuePosition: 3,
      estimatedWaitSeconds: null,
      estimateConfidence: "LOW",
      schedulingState: "PAUSED",
    });
    expect(blocked.waitRange).toBeNull();
    expect(blocked.explanation).toMatch(/paused/i);
  });
});
