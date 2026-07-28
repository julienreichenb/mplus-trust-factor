import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPerformanceDatasetFromRaw,
} from "./performance-probe.js";
import {
  collectUnavailableEncounters,
  decodeMplusCompletionTimeMs,
  normalizeZoneRankingsSummary,
  parseJsonScalar,
} from "./performance-probe-logic.js";
import type { ProbeZoneEncounter } from "./types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const fixturePath = resolve(
  root,
  "tools/fixtures/warcraftlogs/wallidrixe-zone-rankings-summary.json",
);

describe("performance-probe-logic", () => {
  it("parses JSON scalar strings permissively", () => {
    expect(parseJsonScalar('{"rankings":[]}')).toEqual({ rankings: [] });
    expect(parseJsonScalar("not-json")).toBe("not-json");
    expect(parseJsonScalar({ ok: true })).toEqual({ ok: true });
  });

  it("decodes packed M+ completion times from ranking speed/fastestKill", () => {
    expect(decodeMplusCompletionTimeMs(1_800_000)).toBe(1_800_000);
    expect(decodeMplusCompletionTimeMs(-438186914)).toBe(Math.abs(-438186914) & 0xffffff);
    expect(decodeMplusCompletionTimeMs(null)).toBeNull();
    expect(decodeMplusCompletionTimeMs(-1)).toBeNull();
  });

  it("marks missing dungeons as unavailable without failing", () => {
    const encounters: ProbeZoneEncounter[] = [
      { id: 1, name: "A", dungeonSlug: "a" },
      { id: 2, name: "B", dungeonSlug: "b" },
    ];
    const unavailable = collectUnavailableEncounters(encounters, [
      {
        encounterId: 1,
        encounterName: "A",
        dungeonSlug: "a",
        keystoneLevel: 10,
        completionTimeMs: null,
        loggedRunCount: 1,
        ratingPoints: 100,
        scoreRank: 1,
        regionRank: null,
        serverRank: null,
        specialization: "Fire",
        bestDps: null,
        bestPerformancePercentile: 90,
        medianPerformancePercentile: 80,
        lockedIn: true,
      },
    ]);
    expect(unavailable).toEqual([
      {
        encounterID: 2,
        encounterName: "B",
        dungeonSlug: "b",
        reason: "no_zone_rankings_row",
      },
    ]);
  });
});

describe("Wallidrixe zoneRankings summary fixture", () => {
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
        encounters: ProbeZoneEncounter[];
        partitions: Array<{ id: number; name: string | null }>;
      };
      partitionUsed: number;
    };
    rawZoneRankings: unknown;
    expected: {
      totalMythicPlusScore: number;
      bestPerformanceAverage: number;
      medianPerformanceAverage: number;
      totalLoggedRuns: number;
      dungeonCount: number;
      spec: string;
      dungeons: Array<{
        name: string;
        encounterId: number;
        ratingPoints: number;
        keystoneLevel: number;
        bestPercentile: number;
        medianPercentile: number;
        loggedRuns: number;
      }>;
    };
  };

  it("reproduces the WCL Mythic+ character summary page from raw zoneRankings", () => {
    const summary = normalizeZoneRankingsSummary(fixture.rawZoneRankings);
    const { expected } = fixture;

    expect(summary.global.totalMythicPlusScore).toBeCloseTo(expected.totalMythicPlusScore, 5);
    expect(summary.global.bestPerformanceAverage).toBeCloseTo(
      expected.bestPerformanceAverage,
      5,
    );
    expect(summary.global.medianPerformanceAverage).toBeCloseTo(
      expected.medianPerformanceAverage,
      5,
    );
    expect(summary.global.totalLoggedRuns).toBe(expected.totalLoggedRuns);
    expect(summary.dungeons).toHaveLength(expected.dungeonCount);
    expect(summary.global.specRanks[0]?.spec).toBe(expected.spec);
    expect(summary.global.specRanks[0]?.points).toBeCloseTo(expected.totalMythicPlusScore, 5);

    for (const want of expected.dungeons) {
      const got = summary.dungeons.find((d) => d.encounterId === want.encounterId);
      expect(got, want.name).toBeTruthy();
      expect(got!.encounterName).toBe(want.name);
      expect(got!.ratingPoints).toBeCloseTo(want.ratingPoints, 5);
      expect(got!.keystoneLevel).toBe(want.keystoneLevel);
      expect(got!.bestPerformancePercentile).toBeCloseTo(want.bestPercentile, 5);
      expect(got!.medianPerformancePercentile).toBeCloseTo(want.medianPercentile, 5);
      expect(got!.loggedRunCount).toBe(want.loggedRuns);
      expect(got!.specialization).toBe(expected.spec);
      expect(got!.completionTimeMs).toBeGreaterThan(60_000);
      expect(got!.completionTimeMs).toBeLessThan(2 * 60 * 60 * 1000);
      // Explanatory only — ratingPoints already incorporates level/time.
      expect(got!.bestDps).toBeNull();
    }

    // Logged runs are confidence metadata, not a score input in this dataset.
    expect(summary.global.totalLoggedRuns).toBe(expected.totalLoggedRuns);
    expect(summary.global.totalLoggedRuns).not.toBe(expected.totalMythicPlusScore);
    // Global score comes from allStars; per-dungeon points may differ by float noise when summed.
    const scoreFromDungeons = summary.dungeons.reduce((s, d) => s + (d.ratingPoints ?? 0), 0);
    expect(scoreFromDungeons).toBeCloseTo(expected.totalMythicPlusScore, 1);
  });

  it("builds a v2 performance dataset without report scanning fields", () => {
    const dataset = buildPerformanceDatasetFromRaw({
      identity: fixture.identity,
      character: fixture.character,
      zone: fixture.zone,
      rawZoneRankings: fixture.rawZoneRankings,
      probedAt: "2026-07-28T15:12:51.318Z",
    });

    expect(dataset.probeVersion).toBe("2");
    expect(dataset.diagnostics.source).toBe("character.zoneRankings");
    expect(dataset.diagnostics.query.metric).toBe("playerscore");
    expect(dataset.diagnostics.query.byBracket).toBe(true);
    expect(dataset.diagnostics.query.compare).toBeNull();
    expect(dataset.summary.dungeons).toHaveLength(8);
    expect(dataset.summary.unavailableEncounters).toEqual([]);
    expect(dataset.rawZoneRankings).toBe(fixture.rawZoneRankings);
    expect(dataset).not.toHaveProperty("reports");
    expect(dataset).not.toHaveProperty("eligibleLoggedRuns");
    expect(dataset).not.toHaveProperty("selectedHighestRatedRuns");
    expect(dataset.diagnostics.note).toContain("confidence only");
    expect(dataset.diagnostics.note).toContain("No recentReports");
  });
});
