import { describe, expect, it } from "vitest";
import { createRpmLimiter } from "./rate-limiter.js";

describe("TokenBucketRateLimiter", () => {
  it("allows bursts up to soft RPM then blocks", () => {
    const limiter = createRpmLimiter(5);
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.tryAcquire(now)).toBe(true);
    }
    expect(limiter.tryAcquire(now)).toBe(false);
  });

  it("refills tokens over time", () => {
    const limiter = createRpmLimiter(60);
    const start = Date.now();
    for (let i = 0; i < 60; i += 1) {
      limiter.tryAcquire(start);
    }
    expect(limiter.tryAcquire(start)).toBe(false);
    expect(limiter.tryAcquire(start + 60_000)).toBe(true);
  });
});
