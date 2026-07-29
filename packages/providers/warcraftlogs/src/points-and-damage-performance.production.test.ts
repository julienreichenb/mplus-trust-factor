import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adaptPointsAndDamagePerformance,
  isPointsAndDamageSchema,
} from "./discovery/points-and-damage-performance.js";
import { loadFixtureScenario } from "./fixture/loader.js";
import { FixtureWarcraftLogsProvider } from "./fixture/fixture-provider.js";
import { parseJsonScalar } from "./probe/performance-probe-logic.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const wallidrixePadPath = resolve(
  root,
  "tools/fixtures/warcraftlogs/wallidrixe-points-and-damage.json",
);

describe("production points_and_damage Performance adapter (Wallidrixe)", () => {
  const fixture = JSON.parse(readFileSync(wallidrixePadPath, "utf8")) as {
    rawZoneRankingsPointsAndDamage: unknown;
  };

  it("adapts validated payload: 8 dungeons, no Icecrown, peak 80.875, consistency 77", () => {
    const adapted = adaptPointsAndDamagePerformance({
      raw: fixture.rawZoneRankingsPointsAndDamage,
      expectedDungeonCount: 8,
    });

    expect(adapted.state).toBe("OK");
    expect(adapted.dungeonAggregates).toHaveLength(8);
    expect(adapted.dungeonAggregates.every((d) => !d.dungeonSlug.includes("icecrown"))).toBe(
      true,
    );
    expect(adapted.global?.totalMythicPlusScore).toBeCloseTo(4133.25, 5);
    expect(adapted.global?.totalLoggedRuns).toBe(143);
    expect(adapted.global?.bestDpsPercentileAverage).toBeCloseTo(80.875, 5);
    expect(adapted.global?.medianDpsPercentileAverage).toBeCloseTo(77, 5);
    expect(adapted.diagnostics.provenance).toBe("AGGREGATE_ZONE_RANKINGS");
    expect(adapted.diagnostics.throughputSampleCountUnavailable).toBe(true);
    expect(adapted.diagnostics.ratingPointsExcludedFromScore).toBe(true);

    for (const d of adapted.dungeonAggregates) {
      expect(d.bestParsePercentile).not.toBeNull();
      expect(d.medianParsePercentile).not.toBeNull();
      expect(d.bestDps!).toBeGreaterThan(0);
      expect(d.completion?.completionTimeMs).toBeNull();
      expect(d.loggedRunCount).toBeGreaterThan(0);
    }
  });

  it("rejects playerscore-only payloads as SCHEMA_UNSUPPORTED", () => {
    expect(isPointsAndDamageSchema({ metric: "playerscore", rankings: [] })).toBe(false);
    const adapted = adaptPointsAndDamagePerformance({
      raw: {
        metric: "playerscore",
        rankings: [{ encounter: { id: 1, name: "X" }, rankPercent: 50 }],
      },
    });
    expect(adapted.state).toBe("SCHEMA_UNSUPPORTED");
    expect(adapted.dungeonAggregates).toEqual([]);
  });

  it("keeps Performance available when combat-event collection fails (fixture provider)", async () => {
    const provider = new FixtureWarcraftLogsProvider();
    const discovery = provider.discoverCharacter(
      { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      {
        region: "EU",
        now: "2026-07-28T18:00:00.000Z",
        requestId: "test",
        correlationId: "test",
        forceRefresh: false,
        targetCharacter: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      },
    );

    expect(discovery.performance?.state).toBe("OK");
    expect(discovery.dungeonAggregates).toHaveLength(8);
    expect(discovery.performance?.global?.bestDpsPercentileAverage).toBeCloseTo(80.875, 5);

    await expect(
      provider.getReportFightDetails("MissingReport", 1, {
        region: "EU",
        now: "2026-07-28T18:00:00.000Z",
        requestId: "test",
        correlationId: "test",
        forceRefresh: false,
        targetCharacter: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      }),
    ).rejects.toBeTruthy();
    expect(discovery.dungeonAggregates).toHaveLength(8);
  });

  it("loads wallidrixe-performance fixture with preserved raw points_and_damage", () => {
    const bundle = loadFixtureScenario("wallidrixe-performance");
    const raw = parseJsonScalar(
      (
        bundle.zoneRankingsPointsAndDamage as {
          data: { characterData: { character: { zoneRankings: unknown } } };
        }
      ).data.characterData.character.zoneRankings,
    );
    expect(isPointsAndDamageSchema(raw)).toBe(true);
    expect(adaptPointsAndDamagePerformance({ raw }).state).toBe("OK");
  });
});
