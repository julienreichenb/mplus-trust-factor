import { describe, expect, it } from "vitest";
import { buildWclPerformanceObservations } from "./wcl-performance-metrics.js";

describe("buildWclPerformanceObservations v3", () => {
  it("emits performance.v3.run_performance from selected runs", () => {
    const result = buildWclPerformanceObservations({
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 1,
      observedAt: "2026-07-28T00:00:00.000Z",
      seasonSlug: "season-midnight-s1",
      region: "EU",
      selectedRuns: [
        {
          dungeonSlug: "skyreach",
          dungeonName: "Skyreach",
          canonicalRunId: "run-1",
          keyLevel: 18,
          timed: true,
          completedAt: "2026-07-20T00:00:00.000Z",
          executionPercentile: 80,
          wclReportMatched: true,
          wclCoverageRatio: 1,
          bracketMatched: true,
        },
        {
          dungeonSlug: "pit-of-saron",
          dungeonName: "Pit of Saron",
          canonicalRunId: "run-2",
          keyLevel: 10,
          timed: true,
          completedAt: "2026-07-19T00:00:00.000Z",
          executionPercentile: 98,
          wclReportMatched: true,
          wclCoverageRatio: 1,
          bracketMatched: true,
        },
      ],
    });

    expect(result.formulaVersion).toContain("performance-v3");
    expect(result.performanceMetricWeights).toEqual([
      { metricKey: "performance.v3.run_performance", weight: 1 },
    ]);
    expect(result.observations.some((o) => o.metricKey === "performance.v3.run_performance")).toBe(
      true,
    );
    expect(result.summary.currentSeason.formulaVersion).toContain("performance-v3");
    expect(result.summary.historical).toBeNull();

    const sky = result.summary.currentSeason.dungeons.find((d) => d.dungeonSlug === "skyreach")!;
    const pit = result.summary.currentSeason.dungeons.find((d) => d.dungeonSlug === "pit-of-saron")!;
    expect(sky.runPerformance).not.toBeNull();
    expect(pit.runPerformance).not.toBeNull();
    // Strong high-key outranks excellent medium-key.
    expect(sky.runPerformance!).toBeGreaterThan(pit.runPerformance!);
  });
});
