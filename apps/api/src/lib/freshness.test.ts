import { describe, expect, it } from "vitest";
import { determineDetailedRefreshStatus } from "./freshness.js";

describe("determineDetailedRefreshStatus", () => {
  it("returns FAILED when there is no score and the last job failed (terminal for polling)", () => {
    expect(
      determineDetailedRefreshStatus({
        hasScore: false,
        fresh: false,
        activeJobStatus: null,
        lastJobFailed: true,
      }),
    ).toBe("FAILED");
  });

  it("returns IN_PROGRESS / QUEUED only while a non-terminal job is active", () => {
    expect(
      determineDetailedRefreshStatus({
        hasScore: false,
        fresh: false,
        activeJobStatus: "ACTIVE",
        lastJobFailed: false,
      }),
    ).toBe("IN_PROGRESS");
    expect(
      determineDetailedRefreshStatus({
        hasScore: false,
        fresh: false,
        activeJobStatus: "QUEUED",
        lastJobFailed: true,
      }),
    ).toBe("QUEUED");
  });

  it("does not keep polling forever after a failed job with no score", () => {
    const status = determineDetailedRefreshStatus({
      hasScore: false,
      fresh: false,
      activeJobStatus: null,
      lastJobFailed: true,
    });
    expect(status).not.toBe("QUEUED");
    expect(status).not.toBe("IN_PROGRESS");
    expect(status).toBe("FAILED");
  });
});
