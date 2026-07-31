import { describe, expect, it } from "vitest";
import { decideScoreRefresh, isWithinFailureBackoff } from "./score-refresh-decision.js";

describe("CANCELLED refresh status consumers", () => {
  it("does not enter failure backoff for CANCELLED", () => {
    expect(
      isWithinFailureBackoff("CANCELLED", new Date(), 3600, Date.now(), "CANCELLED"),
    ).toBe(false);
  });

  it("does not auto-enqueue solely because latest job is CANCELLED when score is fresh", () => {
    const decision = decideScoreRefresh({
      hasPublishedScore: true,
      scoreCalculatedAt: new Date(),
      scoreTtlSeconds: 604_800,
      failureBackoffSeconds: 3600,
      activeJobStatus: null,
      latestJobStatus: "CANCELLED",
      latestJobFinishedAt: new Date(),
      latestJobErrorCode: "CANCELLED",
      contractReasons: [],
    });
    expect(decision.action).toBe("NONE");
    expect(decision.detailedRefreshStatus).not.toBe("IN_PROGRESS");
    expect(decision.detailedRefreshStatus).not.toBe("QUEUED");
    expect(decision.profileRefreshStatus).toBe("FRESH");
  });

  it("reuses ACTIVE cancel-requested job without enqueueing another", () => {
    const decision = decideScoreRefresh({
      hasPublishedScore: true,
      scoreCalculatedAt: new Date(),
      scoreTtlSeconds: 604_800,
      failureBackoffSeconds: 3600,
      activeJobStatus: "ACTIVE",
      latestJobStatus: "ACTIVE",
      latestJobFinishedAt: null,
      contractReasons: [],
    });
    expect(decision.action).toBe("REUSE_ACTIVE_JOB");
    expect(decision.profileRefreshStatus).toBe("REFRESHING");
  });
});
