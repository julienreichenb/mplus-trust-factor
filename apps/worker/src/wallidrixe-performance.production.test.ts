import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveWclContributionTypes } from "@mplus/contracts";
import { adaptPointsAndDamagePerformance } from "@mplus/provider-warcraftlogs";
import { buildWclPerformanceObservations } from "./orchestration/wcl-performance-metrics.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const wallidrixePadPath = resolve(
  root,
  "tools/fixtures/warcraftlogs/wallidrixe-points-and-damage.json",
);

describe("Wallidrixe production Performance path", () => {
  const fixture = JSON.parse(readFileSync(wallidrixePadPath, "utf8")) as {
    rawZoneRankingsPointsAndDamage: unknown;
  };

  it("emits peak/consistency observations and API-shaped performanceSummary", () => {
    const adapted = adaptPointsAndDamagePerformance({
      raw: fixture.rawZoneRankingsPointsAndDamage,
      expectedDungeonCount: 8,
    });
    expect(adapted.state).toBe("OK");

    const built = buildWclPerformanceObservations({
      currentSeasonDungeons: adapted.dungeonAggregates.map((d) => ({
        dungeonSlug: d.dungeonSlug,
        dungeonName: d.dungeonName,
        encounterId: d.encounterId,
        bestParsePercentile: d.bestParsePercentile,
        medianParsePercentile: d.medianParsePercentile,
        loggedRunCount: d.loggedRunCount,
        specSlug: d.specSlug,
        roleSlug: d.roleSlug,
        keystoneLevel: d.keystoneLevel,
        throughputBracket: d.throughputBracket,
        ratingPoints: d.ratingPoints,
        scoreRank: d.scoreRank,
        regionRank: d.regionRank,
        serverRank: d.serverRank,
        scoreRankPercent: d.scoreRankPercent,
        specialization: d.specialization,
        bestDps: d.bestDps,
        completion: d.completion,
      })),
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      activeSpecSlug: "demonology",
      activeRoleSlug: "dps",
      selectedRunWclCoverage: 1,
      observedAt: "2026-07-28T18:00:00.000Z",
    });

    built.summary.currentSeason.provenance = "AGGREGATE_ZONE_RANKINGS";
    built.summary.currentSeason.totalMythicPlusScore = adapted.global?.totalMythicPlusScore ?? null;
    built.summary.currentSeason.totalLoggedRuns = adapted.global?.totalLoggedRuns;
    built.summary.currentSeason.partition = adapted.global?.partition ?? null;
    built.summary.currentSeason.zoneId = adapted.global?.zoneId ?? null;
    built.summary.currentSeason.specRanks = adapted.global?.specRanks;
    built.summary.currentSeason.availableDungeonCount = built.summary.currentSeason.dungeonCount;
    built.summary.currentSeason.diagnostics = {
      ratingPointsExcludedFromScore: true,
      keystoneLevelExcludedFromScore: true,
      scoreRankPercentExcludedFromScore: true,
      throughputSampleCountUnavailable: true,
      performanceState: adapted.state,
    };

    const peak = built.observations.find((o) => o.metricKey === "performance.current_season_peak");
    const consistency = built.observations.find(
      (o) => o.metricKey === "performance.current_season_consistency",
    );
    expect(peak?.rawValue).toBeCloseTo(80.875, 5);
    expect(consistency?.rawValue).toBeCloseTo(77, 5);
    expect(built.summary.currentSeason.provenance).toBe("AGGREGATE_ZONE_RANKINGS");
    expect(built.summary.currentSeason.dungeonCount).toBe(8);
    expect(built.summary.currentSeason.dungeons.every((d) => !d.dungeonSlug.includes("icecrown"))).toBe(
      true,
    );

    const contrib = deriveWclContributionTypes(built.observations);
    expect(contrib).toContain("PERFORMANCE");

    // Production API output fragment (ScoreSnapshot.explanation.performanceSummary)
    const apiOutput = {
      performanceSummary: built.summary,
      rawZoneRankingsPointsAndDamage: adapted.raw,
      observations: built.observations.map((o) => ({
        metricKey: o.metricKey,
        rawValue: o.rawValue,
        sourceProvider: o.sourceProvider,
      })),
      contributionTypes: contrib,
    };
    expect(apiOutput.performanceSummary.currentSeason.peakScore).toBeCloseTo(80.875, 5);
    expect(apiOutput.performanceSummary.currentSeason.consistencyScore).toBeCloseTo(77, 5);
    expect(apiOutput.performanceSummary.currentSeason.totalMythicPlusScore).toBeCloseTo(4133.25, 5);
    expect(apiOutput.performanceSummary.currentSeason.totalLoggedRuns).toBe(143);
    expect(apiOutput.rawZoneRankingsPointsAndDamage).toBe(fixture.rawZoneRankingsPointsAndDamage);
  });

  it("does not invent observations when Performance query failed", () => {
    const built = buildWclPerformanceObservations({
      currentSeasonDungeons: [],
      expectedDungeonCount: 8,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0,
      observedAt: "2026-07-28T18:00:00.000Z",
    });
    expect(built.observations).toEqual([]);
    expect(built.summary.currentSeason.dungeonCount).toBe(0);
  });
});
