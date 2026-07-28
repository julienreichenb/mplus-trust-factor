import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPerformanceDatasetFromRaw } from "./performance-probe.js";
import {
  arithmeticMean,
  mergePointsAndDamage,
  normalizePointsAndDamage,
  parseJsonScalar,
} from "./performance-probe-logic.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const fixturePath = resolve(root, "tools/fixtures/warcraftlogs/wallidrixe-points-and-damage.json");

describe("performance-probe-logic helpers", () => {
  it("parses JSON scalar strings permissively", () => {
    expect(parseJsonScalar('{"rankings":[]}')).toEqual({ rankings: [] });
    expect(parseJsonScalar("not-json")).toBe("not-json");
  });

  it("computes arithmetic means of per-dungeon percentiles", () => {
    expect(arithmeticMean([72, 91, 77, 86, 95, 59, 98, 69])).toBeCloseTo(80.875, 5);
    expect(arithmeticMean([72, 80, 77, 86, 75, 59, 98, 69])).toBe(77);
    expect(arithmeticMean([])).toBeNull();
  });
});

describe("Wallidrixe points_and_damage fixture (screenshot acceptance)", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    identity: { region: "EU"; realmSlug: string; name: string };
    character: {
      id: number;
      canonicalID: number;
      name: string;
      level: number | null;
      classID: number | null;
      hidden: boolean;
      server: { slug: string; regionName: string | null };
    };
    zone: {
      config: {
        zoneId: number;
        expiresAt: string | null;
        source: "env";
        expired: boolean;
        warning: string | null;
      };
      worldData: {
        id: number;
        name: string;
        frozen: boolean | null;
        encounters: Array<{ id: number; name: string | null; dungeonSlug: string | null }>;
        partitions: Array<{ id: number; name: string | null }>;
      };
      partitionUsed: number;
    };
    rawZoneRankingsPointsAndDamage: unknown;
    expected: {
      totalMythicPlusScore: number;
      totalLoggedRuns: number;
      bestDpsPercentileAverage: number;
      medianDpsPercentileAverage: number;
      wclBestPerformanceAverage: number;
      wclMedianPerformanceAverage: number;
      dungeons: Array<{
        name: string;
        encounterId: number;
        best: number;
        median: number;
      }>;
    };
  };

  it("reads throughputRankings map and matches screenshot Best/Median per dungeon", () => {
    const normalized = normalizePointsAndDamage(fixture.rawZoneRankingsPointsAndDamage);
    const merged = mergePointsAndDamage(normalized);
    const { expected } = fixture;

    expect(merged.global.totalMythicPlusScore).toBeCloseTo(expected.totalMythicPlusScore, 5);
    expect(merged.global.totalLoggedRuns).toBe(expected.totalLoggedRuns);
    expect(merged.global.wclBestPerformanceAverage).toBeCloseTo(
      expected.wclBestPerformanceAverage,
      5,
    );
    expect(merged.global.wclMedianPerformanceAverage).toBeCloseTo(
      expected.wclMedianPerformanceAverage,
      5,
    );
    expect(merged.global.bestDpsPercentileAverage).toBeCloseTo(
      expected.bestDpsPercentileAverage,
      5,
    );
    expect(merged.global.medianDpsPercentileAverage).toBeCloseTo(
      expected.medianDpsPercentileAverage,
      5,
    );
    expect(merged.dungeons).toHaveLength(8);

    for (const want of expected.dungeons) {
      const got = merged.dungeons.find((d) => d.encounterId === want.encounterId);
      expect(got, want.name).toBeTruthy();
      expect(got!.encounterName).toBe(want.name);
      expect(got!.bestExecutionPercentile).toBe(want.best);
      expect(got!.medianExecutionPercentile).toBe(want.median);
      expect(got!.bestDps).not.toBeNull();
      expect(got!.bestDps!).toBeGreaterThan(0);
      expect(got!.keystoneLevel).toBe(22);
      expect(got!.throughputBracket).toBe(22);
      expect(got!.displayedRunCount).toBeGreaterThan(0);
      expect(got!.completion.completionTimeMs).toBeNull();
      // Score rank percent must not be confused with execution percentiles.
      expect(got!.scoreRankPercent).not.toBe(want.best);
    }

    // Displayed run total is contextual, not the throughput sample denominator.
    expect(merged.global.totalLoggedRuns).toBe(143);
  });

  it("builds v4 dataset from points_and_damage raw payload", () => {
    const dataset = buildPerformanceDatasetFromRaw({
      identity: fixture.identity,
      character: fixture.character,
      zone: fixture.zone,
      rawZoneRankingsPointsAndDamage: fixture.rawZoneRankingsPointsAndDamage,
    });

    expect(dataset.probeVersion).toBe("4");
    expect(dataset.state).toBe("OK");
    expect(dataset.diagnostics.query.metric).toBe("points_and_damage");
    expect(dataset.rawZoneRankingsPointsAndDamage).toBe(fixture.rawZoneRankingsPointsAndDamage);
    expect(dataset.summary.unavailableEncounters).toEqual([]);
    expect(dataset.summary.dungeons.every((d) => d.bestDps != null)).toBe(true);
    expect(dataset.diagnostics.averageComparison?.computedBestAverage).toBeCloseTo(80.875, 5);
    expect(dataset.diagnostics.averageComparison?.wclBestPerformanceAverage).toBeCloseTo(
      80.875,
      5,
    );
  });
});
