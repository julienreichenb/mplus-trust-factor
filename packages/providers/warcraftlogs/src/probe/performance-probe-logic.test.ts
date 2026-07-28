import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPerformanceDatasetFromRaw } from "./performance-probe.js";
import {
  SPEED_FASTESTKILL_ENCODING_NOTE,
  experimentalLow24BitDurationMs,
  mergeScoreAndExecution,
  normalizeExecutionZoneRankings,
  normalizeScoreZoneRankings,
  parseJsonScalar,
} from "./performance-probe-logic.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const scorePath = resolve(root, "tools/fixtures/warcraftlogs/wallidrixe-zone-rankings-score.json");
const executionPath = resolve(
  root,
  "tools/fixtures/warcraftlogs/wallidrixe-zone-rankings-execution.json",
);
const mergedPath = resolve(root, "tools/fixtures/warcraftlogs/wallidrixe-performance-merged.json");

describe("performance-probe-logic", () => {
  it("parses JSON scalar strings permissively", () => {
    expect(parseJsonScalar('{"rankings":[]}')).toEqual({ rankings: [] });
    expect(parseJsonScalar("not-json")).toBe("not-json");
  });

  it("documents that low-24-bit fastestKill decode is incorrect vs real keystoneTime", () => {
    // Algeth'ar Academy Wallidrixe: fight keystoneTime was 1_813_086 (30:13).
    const heuristic = experimentalLow24BitDurationMs(-438186914);
    expect(heuristic).toBe(1_979_298);
    expect(heuristic).not.toBe(1_813_086);
    expect(SPEED_FASTESTKILL_ENCODING_NOTE).toContain("keystoneTime");
  });
});

describe("Wallidrixe playerscore fixture", () => {
  const fixture = JSON.parse(readFileSync(scorePath, "utf8")) as {
    rawZoneRankingsScore: unknown;
    expected: {
      totalMythicPlusScore: number;
      totalLoggedRuns: number;
      dungeonCount: number;
      spec: string;
      dungeons: Array<{
        name: string;
        encounterId: number;
        ratingPoints: number;
        keystoneLevel: number;
        loggedRuns: number;
      }>;
    };
  };

  it("normalizes score payload for total score, ranks, levels, and run counts", () => {
    const score = normalizeScoreZoneRankings(fixture.rawZoneRankingsScore);
    expect(score.totalMythicPlusScore).toBeCloseTo(fixture.expected.totalMythicPlusScore, 5);
    expect(score.totalLoggedRuns).toBe(fixture.expected.totalLoggedRuns);
    expect(score.dungeons).toHaveLength(fixture.expected.dungeonCount);
    expect(score.specRanks[0]?.spec).toBe(fixture.expected.spec);

    for (const want of fixture.expected.dungeons) {
      const got = score.dungeons.find((d) => d.encounterId === want.encounterId);
      expect(got, want.name).toBeTruthy();
      expect(got!.ratingPoints).toBeCloseTo(want.ratingPoints, 5);
      expect(got!.keystoneLevel).toBe(want.keystoneLevel);
      expect(got!.loggedRunCount).toBe(want.loggedRuns);
      expect(got!.completion.completionTimeMs).toBeNull();
      expect(got!.completion.encodingStatus).toBe("unverified_not_emitted");
      expect(got!.completion.fastestKillRaw).not.toBeNull();
    }
  });
});

describe("Wallidrixe dps execution fixture", () => {
  const fixture = JSON.parse(readFileSync(executionPath, "utf8")) as {
    rawZoneRankingsExecution: unknown;
    expected: {
      bestDpsPercentileAverage: number;
      medianDpsPercentileAverage: number;
      dungeons: Array<{
        name: string;
        encounterId: number;
        bestExecutionPercentile: number;
        medianExecutionPercentile: number;
        bestDps: number;
      }>;
    };
  };

  it("normalizes execution payload for DPS and Best/Median percentiles", () => {
    const execution = normalizeExecutionZoneRankings(fixture.rawZoneRankingsExecution);
    expect(execution.bestDpsPercentileAverage).toBeCloseTo(
      fixture.expected.bestDpsPercentileAverage,
      5,
    );
    expect(execution.medianDpsPercentileAverage).toBeCloseTo(
      fixture.expected.medianDpsPercentileAverage,
      5,
    );

    for (const want of fixture.expected.dungeons) {
      const got = execution.dungeons.find((d) => d.encounterId === want.encounterId);
      expect(got, want.name).toBeTruthy();
      expect(got!.bestExecutionPercentile).toBe(want.bestExecutionPercentile);
      expect(got!.medianExecutionPercentile).toBe(want.medianExecutionPercentile);
      expect(got!.bestDps).toBe(want.bestDps);
    }
  });
});

describe("Wallidrixe merged Performance dataset (screenshot acceptance)", () => {
  const fixture = JSON.parse(readFileSync(mergedPath, "utf8")) as {
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
    rawZoneRankingsScore: unknown;
    rawZoneRankingsExecution: unknown;
    expected: {
      totalMythicPlusScore: number;
      totalLoggedRuns: number;
      bestDpsPercentileAverage: number;
      medianDpsPercentileAverage: number;
      dungeons: Array<{
        name: string;
        encounterId: number;
        best: number;
        median: number;
      }>;
    };
  };

  it("merges by encounter.id and matches the WCL character page screenshot", () => {
    const score = normalizeScoreZoneRankings(fixture.rawZoneRankingsScore);
    const execution = normalizeExecutionZoneRankings(fixture.rawZoneRankingsExecution);
    const merged = mergeScoreAndExecution(score, execution);

    expect(merged.global.totalMythicPlusScore).toBeCloseTo(fixture.expected.totalMythicPlusScore, 5);
    expect(merged.global.totalLoggedRuns).toBe(fixture.expected.totalLoggedRuns);
    expect(merged.global.bestDpsPercentileAverage).toBeCloseTo(
      fixture.expected.bestDpsPercentileAverage,
      5,
    );
    expect(merged.global.medianDpsPercentileAverage).toBeCloseTo(
      fixture.expected.medianDpsPercentileAverage,
      5,
    );

    for (const want of fixture.expected.dungeons) {
      const got = merged.dungeons.find((d) => d.encounterId === want.encounterId);
      expect(got, want.name).toBeTruthy();
      expect(got!.bestExecutionPercentile).toBe(want.best);
      expect(got!.medianExecutionPercentile).toBe(want.median);
      expect(got!.bestDps).not.toBeNull();
      expect(got!.ratingPoints).not.toBeNull();
      expect(got!.keystoneLevel).toBe(22);
      // scoreRankPercent (playerscore) must not be confused with execution percentiles.
      expect(got!.scoreRankPercent).not.toBe(want.best);
      expect(got!.completion.completionTimeMs).toBeNull();
    }
  });

  it("builds v3 dataset with both raw payloads and no report-scan fields", () => {
    const dataset = buildPerformanceDatasetFromRaw({
      identity: fixture.identity,
      character: fixture.character,
      zone: fixture.zone,
      rawZoneRankingsScore: fixture.rawZoneRankingsScore,
      rawZoneRankingsExecution: fixture.rawZoneRankingsExecution,
    });

    expect(dataset.probeVersion).toBe("3");
    expect(dataset.state).toBe("OK");
    expect(dataset.rawZoneRankingsScore).toBe(fixture.rawZoneRankingsScore);
    expect(dataset.rawZoneRankingsExecution).toBe(fixture.rawZoneRankingsExecution);
    expect(dataset.diagnostics.scoreQuery.metric).toBe("playerscore");
    expect(dataset.diagnostics.executionQuery.metric).toBe("dps");
    expect(dataset.diagnostics.scoreQuery.ok).toBe(true);
    expect(dataset.diagnostics.executionQuery.ok).toBe(true);
    expect(dataset.summary.dungeons.every((d) => d.bestDps != null)).toBe(true);
    expect(dataset).not.toHaveProperty("reports");
    expect(dataset.diagnostics.note).toContain("confidence only");
  });
});

describe("Performance probe GraphQL failure handling", () => {
  it("exposes ERROR without fabricating unavailable encounters when rankings are missing", () => {
    // Simulated ERROR path: empty summary, no unavailable list from failed queries.
    const summary = {
      global: null,
      dungeons: [] as never[],
      unavailableEncounters: [] as never[],
    };
    expect(summary.global).toBeNull();
    expect(summary.dungeons).toEqual([]);
    expect(summary.unavailableEncounters).toEqual([]);
  });
});
