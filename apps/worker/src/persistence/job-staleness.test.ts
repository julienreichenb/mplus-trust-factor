import { describe, expect, it } from "vitest";
import { DEFAULT_STALE_ACTIVE_MS, isStaleActive, isStaleQueued } from "./job-staleness.js";

describe("job staleness", () => {
  it("detects stale QUEUED without startedAt", () => {
    const scheduledAt = new Date(Date.now() - 20 * 60 * 1000);
    expect(
      isStaleQueued({ status: "QUEUED", startedAt: null, scheduledAt }),
    ).toBe(true);
    expect(
      isStaleQueued({ status: "QUEUED", startedAt: new Date(), scheduledAt }),
    ).toBe(false);
  });

  it("detects stale ACTIVE from startedAt age", () => {
    const startedAt = new Date(Date.now() - DEFAULT_STALE_ACTIVE_MS - 1_000);
    expect(
      isStaleActive({ status: "ACTIVE", startedAt, scheduledAt: startedAt }),
    ).toBe(true);
    expect(
      isStaleActive({
        status: "ACTIVE",
        startedAt: new Date(),
        scheduledAt: new Date(),
      }),
    ).toBe(false);
    expect(
      isStaleActive({
        status: "QUEUED",
        startedAt: null,
        scheduledAt: new Date(Date.now() - DEFAULT_STALE_ACTIVE_MS - 1_000),
      }),
    ).toBe(false);
  });
});
