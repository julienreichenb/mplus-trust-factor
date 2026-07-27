import { describe, expect, it } from "vitest";
import {
  combineCurrentSeasonScore,
  combineOverallPerformanceScore,
  computeCurrentSeasonConsistency,
  computeCurrentSeasonPeak,
  computeHistoricalPerformance,
  computePerformanceConfidence,
  computePerformanceDimension,
  resolvePerformanceMetricWeights,
  selectExplanatoryRunsForDungeon,
} from "./aggregate.js";
import type {
  HistoricalSeasonAggregateInput,
  PerformanceDungeonAggregate,
  PerformanceRunRefInput,
} from "./types.js";

/** Wallidrixe regression fixture — values from the live-season WCL aggregate table (tests only). */
const WALLIDRIXE_DUNGEONS: PerformanceDungeonAggregate[] = [
  {
    dungeonSlug: "algethar-academy",
    dungeonName: "Algeth'ar Academy",
    bestParsePercentile: 72,
    medianParsePercentile: 72,
    loggedRunCount: 4,
  },
  {
    dungeonSlug: "magisters-terrace",
    dungeonName: "Magisters' Terrace",
    bestParsePercentile: 91,
    medianParsePercentile: 86,
    loggedRunCount: 12,
  },
  {
    dungeonSlug: "maisara-caverns",
    dungeonName: "Maisara Caverns",
    bestParsePercentile: 77,
    medianParsePercentile: 77,
    loggedRunCount: 3,
  },
  {
    dungeonSlug: "nexus-point-xenas",
    dungeonName: "Nexus-Point Xenas",
    bestParsePercentile: 86,
    medianParsePercentile: 86,
    loggedRunCount: 8,
  },
  {
    dungeonSlug: "pit-of-saron",
    dungeonName: "Pit of Saron",
    bestParsePercentile: 95,
    medianParsePercentile: 75,
    loggedRunCount: 20,
  },
  {
    dungeonSlug: "seat-of-the-triumvirate",
    dungeonName: "Seat of the Triumvirate",
    bestParsePercentile: 59,
    medianParsePercentile: 59,
    loggedRunCount: 2,
  },
  {
    dungeonSlug: "skyreach",
    dungeonName: "Skyreach",
    bestParsePercentile: 98,
    medianParsePercentile: 98,
    loggedRunCount: 6,
  },
  {
    dungeonSlug: "windrunner-spire",
    dungeonName: "Windrunner Spire",
    bestParsePercentile: 69,
    medianParsePercentile: 69,
    loggedRunCount: 5,
  },
];

function histSeason(
  overrides: Partial<HistoricalSeasonAggregateInput> &
    Pick<HistoricalSeasonAggregateInput, "seasonSlug" | "recencyRank" | "dungeons">,
): HistoricalSeasonAggregateInput {
  return {
    specSlug: "affliction",
    roleSlug: "dps",
    ...overrides,
  };
}

describe("PERFORMANCE WCL aggregation", () => {
  it("1. equal dungeon weighting despite different run counts", () => {
    const uneven: PerformanceDungeonAggregate[] = [
      {
        dungeonSlug: "a",
        dungeonName: "A",
        bestParsePercentile: 100,
        medianParsePercentile: 100,
        loggedRunCount: 50,
      },
      {
        dungeonSlug: "b",
        dungeonName: "B",
        bestParsePercentile: 50,
        medianParsePercentile: 50,
        loggedRunCount: 1,
      },
    ];
    expect(computeCurrentSeasonPeak(uneven)).toBe(75);
    expect(computeCurrentSeasonConsistency(uneven)).toBe(75);
  });

  it("2. correct best and median percentile aggregation", () => {
    const peak = computeCurrentSeasonPeak(WALLIDRIXE_DUNGEONS);
    const consistency = computeCurrentSeasonConsistency(WALLIDRIXE_DUNGEONS);
    expect(peak).toBeCloseTo(80.875, 5);
    expect(consistency).toBeCloseTo(77.75, 5);
    expect(combineCurrentSeasonScore(peak, consistency)).toBeCloseTo(
      0.65 * 80.875 + 0.35 * 77.75,
      5,
    );
  });

  it("3. best run and latest run are different", () => {
    const runs: PerformanceRunRefInput[] = [
      {
        runId: "best",
        dungeonSlug: "skyreach",
        keyLevel: 12,
        completedAt: "2026-06-01T00:00:00.000Z",
        timed: true,
        parsePercentile: 98,
        scoreValue: 200,
        hasWclSource: true,
      },
      {
        runId: "latest",
        dungeonSlug: "skyreach",
        keyLevel: 10,
        completedAt: "2026-07-20T00:00:00.000Z",
        timed: true,
        parsePercentile: 70,
        scoreValue: 150,
        hasWclSource: true,
      },
    ];
    const selected = selectExplanatoryRunsForDungeon(runs, "skyreach", "Skyreach");
    expect(selected.bestRun?.runId).toBe("best");
    expect(selected.bestRun?.kind).toBe("BEST");
    expect(selected.latestRun?.runId).toBe("latest");
    expect(selected.latestRun?.kind).toBe("LATEST");
  });

  it("4. best run and latest run are the same → one BOTH result", () => {
    const runs: PerformanceRunRefInput[] = [
      {
        runId: "only",
        dungeonSlug: "skyreach",
        keyLevel: 12,
        completedAt: "2026-07-20T00:00:00.000Z",
        timed: true,
        parsePercentile: 98,
        scoreValue: 200,
        hasWclSource: true,
      },
    ];
    const selected = selectExplanatoryRunsForDungeon(runs, "skyreach", "Skyreach");
    expect(selected.bestRun?.kind).toBe("BOTH");
    expect(selected.latestRun?.runId).toBe(selected.bestRun?.runId);

    const result = computePerformanceDimension({
      currentSeasonDungeons: [
        {
          dungeonSlug: "skyreach",
          dungeonName: "Skyreach",
          bestParsePercentile: 98,
          medianParsePercentile: 98,
          loggedRunCount: 1,
        },
      ],
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 1,
      explanatoryRuns: runs,
    });
    const dungeon = result.summary.currentSeason.dungeons[0]!;
    expect(dungeon.bestRun?.kind).toBe("BOTH");
    expect(dungeon.latestRun).toBeNull();
  });

  it("5. missing dungeon does not become a zero", () => {
    const withGap = WALLIDRIXE_DUNGEONS.slice(0, 7);
    const peak = computeCurrentSeasonPeak(withGap);
    expect(peak).not.toBeNull();
    expect(peak!).toBeGreaterThan(70);
    // Not diluted by an 8th zero dungeon
    expect(peak).toBe(
      withGap.reduce((s, d) => s + d.bestParsePercentile!, 0) / withGap.length,
    );
  });

  it("6. missing dungeon reduces confidence", () => {
    const full = computePerformanceDimension({
      currentSeasonDungeons: WALLIDRIXE_DUNGEONS,
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.8,
      logFreshness: 0.9,
    });
    const partial = computePerformanceDimension({
      currentSeasonDungeons: WALLIDRIXE_DUNGEONS.slice(0, 3),
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.8,
      logFreshness: 0.9,
    });
    expect(partial.confidence).toBeLessThan(full.confidence);
  });

  it("7. one, two and three historical seasons with weight renormalization", () => {
    const s1 = histSeason({
      seasonSlug: "prev",
      recencyRank: 1,
      dungeons: [
        {
          dungeonSlug: "a",
          dungeonName: "A",
          bestParsePercentile: 80,
          medianParsePercentile: 70,
          loggedRunCount: 3,
        },
      ],
    });
    const s2 = histSeason({
      seasonSlug: "prev-2",
      recencyRank: 2,
      dungeons: [
        {
          dungeonSlug: "a",
          dungeonName: "A",
          bestParsePercentile: 60,
          medianParsePercentile: 50,
          loggedRunCount: 3,
        },
      ],
    });
    const s3 = histSeason({
      seasonSlug: "prev-3",
      recencyRank: 3,
      dungeons: [
        {
          dungeonSlug: "a",
          dungeonName: "A",
          bestParsePercentile: 40,
          medianParsePercentile: 30,
          loggedRunCount: 3,
        },
      ],
    });

    const one = computeHistoricalPerformance([s1]);
    expect(one?.score).toBe(80);
    expect(one?.seasonsUsed).toBe(1);

    const two = computeHistoricalPerformance([s1, s2]);
    expect(two?.score).toBeCloseTo((0.6 * 80 + 0.3 * 60) / 0.9, 5);
    expect(two?.seasonsUsed).toBe(2);

    const three = computeHistoricalPerformance([s1, s2, s3]);
    expect(three?.score).toBeCloseTo(0.6 * 80 + 0.3 * 60 + 0.1 * 40, 5);
    expect(three?.seasonsUsed).toBe(3);
  });

  it("8. no historical seasons → current season becomes 100% of available score", () => {
    const peak = 80.875;
    const consistency = 77.75;
    const current = combineCurrentSeasonScore(peak, consistency)!;
    expect(combineOverallPerformanceScore(current, null)).toBe(current);

    const weights = resolvePerformanceMetricWeights(false);
    expect(weights.map((w) => w.metricKey)).toEqual([
      "performance.current_season_peak",
      "performance.current_season_consistency",
    ]);
    expect(weights.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 10);
  });

  it("9. historical data from another spec or role is excluded", () => {
    const wrongSpec = histSeason({
      seasonSlug: "prev",
      recencyRank: 1,
      specSlug: "destruction",
      roleSlug: "dps",
      dungeons: [
        {
          dungeonSlug: "a",
          dungeonName: "A",
          bestParsePercentile: 99,
          medianParsePercentile: 99,
          loggedRunCount: 5,
        },
      ],
    });
    const result = computeHistoricalPerformance([wrongSpec], "affliction", "dps");
    expect(result).toBeNull();
  });

  it("10. historical runs are not exposed as detailed selected runs", () => {
    const result = computePerformanceDimension({
      currentSeasonDungeons: WALLIDRIXE_DUNGEONS.slice(0, 2),
      historicalSeasons: [
        histSeason({
          seasonSlug: "prev",
          recencyRank: 1,
          dungeons: [
            {
              dungeonSlug: "old-dungeon",
              dungeonName: "Old Dungeon",
              bestParsePercentile: 90,
              medianParsePercentile: 80,
              loggedRunCount: 4,
            },
          ],
        }),
      ],
      activeSpecSlug: "affliction",
      activeRoleSlug: "dps",
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.5,
      explanatoryRuns: [
        {
          runId: "hist-should-not-appear",
          dungeonSlug: "old-dungeon",
          keyLevel: 20,
          completedAt: "2025-01-01T00:00:00.000Z",
          timed: true,
          parsePercentile: 90,
          scoreValue: 300,
          hasWclSource: true,
        },
      ],
    });

    expect(result.summary.historical).not.toBeNull();
    const exposedSlugs = result.summary.currentSeason.dungeons.flatMap((d) => [
      d.bestRun?.dungeonSlug,
      d.latestRun?.dungeonSlug,
    ]);
    expect(exposedSlugs).not.toContain("old-dungeon");
    expect(JSON.stringify(result.summary)).not.toContain("hist-should-not-appear");
  });

  it("11. Mythic+ rating is not treated as a percentile", () => {
    const result = computePerformanceDimension({
      currentSeasonDungeons: WALLIDRIXE_DUNGEONS,
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.8,
    });
    expect(result.performanceScore).toBeCloseTo(0.65 * 80.875 + 0.35 * 77.75, 5);
    expect(result.performanceScore).not.toBeCloseTo(2845 / 36, 0);
    expect(JSON.stringify(result.summary)).not.toContain("mythic_rating");
  });

  it("12. no WCL percentile data → neutral/unrated PERFORMANCE, confidence 0", () => {
    const result = computePerformanceDimension({
      currentSeasonDungeons: [],
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0,
    });
    expect(result.performanceScore).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.summary.currentSeason.peakScore).toBeNull();
    expect(result.summary.currentSeason.dungeonCount).toBe(0);
  });

  it("13. current-season data excludes stale runs from old seasons", () => {
    // Historical season aggregates are separate inputs — only currentSeasonDungeons feed peak/consistency.
    const result = computePerformanceDimension({
      currentSeasonDungeons: [
        {
          dungeonSlug: "skyreach",
          dungeonName: "Skyreach",
          bestParsePercentile: 98,
          medianParsePercentile: 98,
          loggedRunCount: 2,
        },
      ],
      historicalSeasons: [
        histSeason({
          seasonSlug: "old",
          recencyRank: 1,
          dungeons: [
            {
              dungeonSlug: "old",
              dungeonName: "Old",
              bestParsePercentile: 10,
              medianParsePercentile: 10,
              loggedRunCount: 50,
            },
          ],
        }),
      ],
      activeSpecSlug: "affliction",
      activeRoleSlug: "dps",
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 1,
    });
    expect(result.summary.currentSeason.peakScore).toBe(98);
    expect(result.summary.currentSeason.dungeons).toHaveLength(1);
    expect(result.summary.historical?.score).toBe(10);
  });

  it("14. previous score model snapshots remain distinguishable by modelVersion", () => {
    const v1Weights = resolvePerformanceMetricWeights(false);
    const v2WithHist = resolvePerformanceMetricWeights(true);
    expect(v1Weights).not.toEqual(v2WithHist);
    // Model version itself is owned by ScoreModelConfig — assert weight keys changed from mythic_rating.
    expect(v2WithHist.every((w) => w.metricKey !== "performance.mythic_rating")).toBe(true);
  });

  it("15. Wallidrixe fixture produces the expected peak and consistency aggregates", () => {
    const result = computePerformanceDimension({
      currentSeasonDungeons: WALLIDRIXE_DUNGEONS,
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.75,
      logFreshness: 0.85,
    });
    expect(result.summary.currentSeason.peakScore).toBeCloseTo(80.875, 5);
    expect(result.summary.currentSeason.consistencyScore).toBeCloseTo(77.75, 5);
    expect(result.summary.currentSeason.dungeonCount).toBe(8);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("single exceptional parse does not yield high confidence", () => {
    const conf = computePerformanceConfidence({
      dungeonCount: 1,
      expectedDungeonCount: 8,
      totalLoggedRuns: 1,
      dungeonsWithBothPercentiles: 1,
      dungeonsWithAnyPercentile: 1,
      logFreshness: 1,
      selectedRunWclCoverage: 1,
      hasResolvedSpecAndRole: true,
      hasHistorical: true,
    });
    expect(conf).toBeLessThan(0.55);
  });
});
