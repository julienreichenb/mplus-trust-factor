import { describe, expect, it } from "vitest";
import { runBenchmark } from "./benchmark.js";

describe("synthetic benchmark", () => {
  it("builds 10k dataset under reasonable time", () => {
    const result = runBenchmark(10_000, "2026-07-27T09:00:00.000Z");
    expect(result.eligibleCount).toBeGreaterThan(5000);
    expect(result.buildMs).toBeLessThan(30_000);
  });
});
