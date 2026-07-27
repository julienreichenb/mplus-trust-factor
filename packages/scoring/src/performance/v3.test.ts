import { describe, expect, it } from "vitest";
import {
  computePerformanceDimension,
  computePerformanceDimensionV3,
  computeRunPerformance,
  PERFORMANCE_V3_EXECUTION_WEIGHT,
  PERFORMANCE_V3_KEY_DIFFICULTY_WEIGHT,
  PERFORMANCE_V3_FORMULA_VERSION,
} from "../index.js";
import type { PerformanceV3DungeonInput } from "./v3.js";

/** Wallidrixe eight-dungeon selected-run fixture (synthetic season-relative keys + parses). */
const WALLIDRIXE_V3_RUNS: PerformanceV3DungeonInput[] = [
  {
    dungeonSlug: "algethar-academy",
    dungeonName: "Algeth'ar Academy",
    canonicalRunId: "wall-aa",
    keyLevel: 12,
    timed: true,
    completedAt: "2026-07-20T12:00:00.000Z",
    executionPercentile: 72,
    wclReportMatched: true,
    wclCoverageRatio: 0.9,
    bracketMatched: true,
  },
  {
    dungeonSlug: "magisters-terrace",
    dungeonName: "Magisters' Terrace",
    canonicalRunId: "wall-mt",
    keyLevel: 14,
    timed: true,
    completedAt: "2026-07-19T12:00:00.000Z",
    executionPercentile: 91,
    wclReportMatched: true,
    wclCoverageRatio: 0.95,
    bracketMatched: true,
  },
  {
    dungeonSlug: "maisara-caverns",
    dungeonName: "Maisara Caverns",
    canonicalRunId: "wall-mc",
    keyLevel: 11,
    timed: true,
    completedAt: "2026-07-18T12:00:00.000Z",
    executionPercentile: 77,
    wclReportMatched: true,
    wclCoverageRatio: 0.8,
    bracketMatched: true,
  },
  {
    dungeonSlug: "nexus-point-xenas",
    dungeonName: "Nexus-Point Xenas",
    canonicalRunId: "wall-nx",
    keyLevel: 13,
    timed: true,
    completedAt: "2026-07-17T12:00:00.000Z",
    executionPercentile: 86,
    wclReportMatched: true,
    wclCoverageRatio: 0.85,
    bracketMatched: true,
  },
  {
    dungeonSlug: "pit-of-saron",
    dungeonName: "Pit of Saron",
    canonicalRunId: "wall-pos",
    keyLevel: 15,
    timed: true,
    completedAt: "2026-07-16T12:00:00.000Z",
    executionPercentile: 95,
    wclReportMatched: true,
    wclCoverageRatio: 1,
    bracketMatched: true,
  },
  {
    dungeonSlug: "seat-of-the-triumvirate",
    dungeonName: "Seat of the Triumvirate",
    canonicalRunId: "wall-sot",
    keyLevel: 10,
    timed: false,
    completedAt: "2026-07-15T12:00:00.000Z",
    executionPercentile: 59,
    wclReportMatched: true,
    wclCoverageRatio: 0.7,
    bracketMatched: true,
  },
  {
    dungeonSlug: "skyreach",
    dungeonName: "Skyreach",
    canonicalRunId: "wall-sky",
    keyLevel: 14,
    timed: true,
    completedAt: "2026-07-14T12:00:00.000Z",
    executionPercentile: 98,
    wclReportMatched: true,
    wclCoverageRatio: 0.9,
    bracketMatched: true,
  },
  {
    dungeonSlug: "windrunner-spire",
    dungeonName: "Windrunner Spire",
    canonicalRunId: "wall-ws",
    keyLevel: 12,
    timed: true,
    completedAt: "2026-07-13T12:00:00.000Z",
    executionPercentile: 69,
    wclReportMatched: true,
    wclCoverageRatio: 0.75,
    bracketMatched: true,
  },
];

describe("Performance v3 formula", () => {
  it("applies 65/35 per dungeon and equal dungeon weighting", () => {
    expect(
      computeRunPerformance({
        executionPercentile: 80,
        keyDifficultyPercentile: 60,
      }),
    ).toBeCloseTo(
      PERFORMANCE_V3_EXECUTION_WEIGHT * 80 + PERFORMANCE_V3_KEY_DIFFICULTY_WEIGHT * 60,
      8,
    );

    const result = computePerformanceDimensionV3({
      dungeons: WALLIDRIXE_V3_RUNS,
      expectedDungeonCount: 8,
      keyDifficultyContext: {
        seasonSlug: "season-midnight-s1",
        region: "EU",
        top25CutoffScore: null,
      },
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 1,
      logFreshness: 0.9,
    });

    expect(result.formulaVersion).toBe(PERFORMANCE_V3_FORMULA_VERSION);
    expect(result.dungeonCount).toBe(8);
    expect(result.performanceScore).not.toBeNull();
    expect(result.dungeons.every((d) => d.runPerformance != null)).toBe(true);

    const manualMean =
      result.dungeons.reduce((s, d) => s + (d.runPerformance ?? 0), 0) / 8;
    expect(result.performanceScore).toBeCloseTo(manualMean, 8);
  });

  it("proves a strong high-key parse outranks an excellent medium-key parse", () => {
    const highKeyStrong = computeRunPerformance({
      executionPercentile: 80,
      keyDifficultyPercentile: 92, // ~+18 band
    });
    const mediumKeyExcellent = computeRunPerformance({
      executionPercentile: 98,
      keyDifficultyPercentile: 52, // ~+10 band
    });
    expect(highKeyStrong).not.toBeNull();
    expect(mediumKeyExcellent).not.toBeNull();
    expect(highKeyStrong!).toBeGreaterThan(mediumKeyExcellent!);

    // Pure execution-only ranking would reverse this — v3 must not.
    expect(80).toBeLessThan(98);
  });

  it("omits missing dungeon detail instead of scoring zero", () => {
    const withGap = WALLIDRIXE_V3_RUNS.map((d, i) =>
      i === 0
        ? { ...d, executionPercentile: null as number | null, wclReportMatched: false }
        : d,
    );
    const result = computePerformanceDimensionV3({
      dungeons: withGap,
      expectedDungeonCount: 8,
      keyDifficultyContext: {
        seasonSlug: "season-midnight-s1",
        region: "EU",
      },
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.875,
    });
    expect(result.dungeonCount).toBe(7);
    expect(result.dungeons[0]!.runPerformance).toBeNull();
    expect(result.dungeons[0]!.unavailableReason).toBeTruthy();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(1);
  });

  it("does not blend historical seasons into current Performance v3", () => {
    const result = computePerformanceDimensionV3({
      dungeons: WALLIDRIXE_V3_RUNS.slice(0, 2),
      expectedDungeonCount: 8,
      keyDifficultyContext: {
        seasonSlug: "season-midnight-s1",
        region: "EU",
        top25CutoffScore: 3000,
      },
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.25,
    });
    expect(result.observations.runPerformance).toBe(result.performanceScore);
    // Contrast: v2 still exposes historical blend helpers independently.
    const v2 = computePerformanceDimension({
      currentSeasonDungeons: [
        {
          dungeonSlug: "a",
          dungeonName: "A",
          bestParsePercentile: 90,
          medianParsePercentile: 80,
          loggedRunCount: 2,
        },
      ],
      historicalSeasons: [
        {
          seasonSlug: "prev",
          recencyRank: 1,
          dungeons: [
            {
              dungeonSlug: "a",
              dungeonName: "A",
              bestParsePercentile: 50,
              medianParsePercentile: 50,
              loggedRunCount: 1,
            },
          ],
        },
      ],
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 1,
    });
    expect(v2.summary.historical).not.toBeNull();
    expect(result.formulaVersion).not.toEqual(v2.summary.currentSeason.formulaVersion ?? "v2");
  });

  it("Wallidrixe before/after payloads: v2 peak/median vs v3 selected-run blend", () => {
    const before = computePerformanceDimension({
      currentSeasonDungeons: WALLIDRIXE_V3_RUNS.map((d) => ({
        dungeonSlug: d.dungeonSlug,
        dungeonName: d.dungeonName,
        bestParsePercentile: d.executionPercentile,
        medianParsePercentile: d.executionPercentile,
        loggedRunCount: 3,
      })),
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 1,
      logFreshness: 0.9,
    });

    const after = computePerformanceDimensionV3({
      dungeons: WALLIDRIXE_V3_RUNS,
      expectedDungeonCount: 8,
      keyDifficultyContext: {
        seasonSlug: "season-midnight-s1",
        region: "EU",
        top25CutoffScore: 2800,
        observedKeyLevels: WALLIDRIXE_V3_RUNS.map((r) => r.keyLevel),
      },
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 1,
      logFreshness: 0.9,
    });

    const beforePayload = {
      driver: "performance.current_season_peak+consistency",
      score: before.performanceScore,
      peak: before.observations.peak,
      consistency: before.observations.consistency,
      confidence: before.confidence,
      dungeons: before.summary.currentSeason.dungeons.map((d) => ({
        dungeonSlug: d.dungeonSlug,
        bestParsePercentile: d.bestParsePercentile,
        medianParsePercentile: d.medianParsePercentile,
      })),
    };

    const afterPayload = {
      driver: "performance.v3.run_performance",
      formulaVersion: after.formulaVersion,
      score: after.performanceScore,
      meanExecution: after.meanExecutionPercentile,
      meanKeyDifficulty: after.meanKeyDifficultyPercentile,
      confidence: after.confidence,
      dungeons: after.dungeons.map((d) => ({
        dungeonSlug: d.dungeonSlug,
        keyLevel: d.keyLevel,
        executionPercentile: d.executionPercentile,
        keyDifficultyPercentile: d.keyDifficultyPercentile,
        runPerformance: d.runPerformance,
        source: d.source,
        confidence: d.confidence,
      })),
    };

    expect(beforePayload.dungeons).toHaveLength(8);
    expect(afterPayload.dungeons).toHaveLength(8);
    expect(afterPayload.formulaVersion).toBe(PERFORMANCE_V3_FORMULA_VERSION);
    expect(afterPayload.score).not.toBeNull();
    // v3 score incorporates key difficulty — generally differs from pure parse mean.
    expect(afterPayload.meanKeyDifficulty).not.toBeNull();
    expect(afterPayload.dungeons.every((d) => d.keyDifficultyPercentile != null)).toBe(true);

    // Expose payloads for handoff documentation (assertion anchors).
    expect(beforePayload.driver).toContain("peak");
    expect(afterPayload.driver).toBe("performance.v3.run_performance");
  });
});
