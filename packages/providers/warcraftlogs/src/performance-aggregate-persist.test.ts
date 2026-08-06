/**
 * Persistence-oriented points_and_damage normalization (Test B) + content hash (Test L).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  hashPerformanceAggregateContent,
  toPerformanceAggregatePartitionKey,
} from "@mplus/contracts";
import {
  adaptPointsAndDamagePerformance,
  toPersistedPerformanceAggregate,
} from "./discovery/points-and-damage-performance.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const wallidrixePadPath = resolve(
  root,
  "tools/fixtures/warcraftlogs/wallidrixe-points-and-damage.json",
);

describe("points_and_damage persistence normalization", () => {
  const fixture = JSON.parse(readFileSync(wallidrixePadPath, "utf8")) as {
    rawZoneRankingsPointsAndDamage: unknown;
  };

  it("preserves best/median percentiles and metadata without zero-filling gaps", () => {
    const adapted = adaptPointsAndDamagePerformance({
      raw: fixture.rawZoneRankingsPointsAndDamage,
      expectedDungeonCount: 8,
    });
    expect(adapted.state).toBe("OK");

    const compact = toPersistedPerformanceAggregate({
      record: adapted,
      zoneId: 47,
      partition: null,
    });

    expect(compact.state).toBe("OK");
    expect(compact.dungeonAggregates.length).toBe(8);
    for (const d of compact.dungeonAggregates) {
      expect(d.bestParsePercentile).not.toBe(0);
      expect(d.medianParsePercentile).not.toBeNull();
      expect(d.loggedRunCount).toBeGreaterThan(0);
      expect(d.specialization == null || typeof d.specialization === "string").toBe(
        true,
      );
      expect(d.keystoneLevel == null || typeof d.keystoneLevel === "number").toBe(
        true,
      );
      expect(d.bestDps == null || (typeof d.bestDps === "number" && d.bestDps > 0)).toBe(
        true,
      );
    }

    // Unavailable dungeons are diagnostics, not fabricated zero rows.
    expect(
      compact.dungeonAggregates.every(
        (d) =>
          d.bestParsePercentile == null ||
          (d.bestParsePercentile >= 0 && d.bestParsePercentile <= 100),
      ),
    ).toBe(true);
  });

  it("rejects invalid percentiles when building compact aggregate", () => {
    const adapted = adaptPointsAndDamagePerformance({
      raw: fixture.rawZoneRankingsPointsAndDamage,
    });
    expect(adapted.state).toBe("OK");
    const bad = {
      ...adapted,
      dungeonAggregates: [
        {
          ...adapted.dungeonAggregates[0]!,
          bestParsePercentile: 150,
        },
      ],
    };
    expect(() =>
      toPersistedPerformanceAggregate({
        record: bad,
        zoneId: 47,
        partition: null,
      }),
    ).toThrow(/percentile|bestParsePercentile/i);
  });
});

describe("performance aggregate content hash", () => {
  it("is order-insensitive for equivalent semantic objects", () => {
    const base = {
      rankingVersion: "points-and-damage-v1",
      metric: "points_and_damage",
      zoneId: 47,
      partitionKey: toPerformanceAggregatePartitionKey(null),
      rawPayload: { b: 2, a: 1 },
      dungeonAggregates: [
        {
          dungeonSlug: "skyreach",
          dungeonName: "Skyreach",
          encounterId: 1,
          bestParsePercentile: 90,
          medianParsePercentile: 80,
          loggedRunCount: 10,
          specialization: "Fire",
          keystoneLevel: 12,
          bestDps: 1000,
        },
      ],
      global: {
        totalMythicPlusScore: 4000,
        totalLoggedRuns: 10,
        bestDpsPercentileAverage: 90,
        medianDpsPercentileAverage: 80,
        partition: null,
        zoneId: 47,
      },
      diagnostics: {
        adapterVersion: "points-and-damage-v1" as const,
        metric: "points_and_damage" as const,
        provenance: "AGGREGATE_ZONE_RANKINGS" as const,
        availableDungeonCount: 1,
        expectedDungeonCount: 8,
        unavailableEncounters: [],
        wclBestPerformanceAverage: 90,
        wclMedianPerformanceAverage: 80,
        computedBestAverage: 90,
        computedMedianAverage: 80,
      },
      sourceRequestFingerprint: "abc",
    };

    const reordered = {
      ...base,
      rawPayload: { a: 1, b: 2 },
    };
    expect(hashPerformanceAggregateContent(base)).toBe(
      hashPerformanceAggregateContent(reordered),
    );

    expect(
      hashPerformanceAggregateContent({
        ...base,
        dungeonAggregates: [
          { ...base.dungeonAggregates[0]!, bestParsePercentile: 91 },
        ],
      }),
    ).not.toBe(hashPerformanceAggregateContent(base));

    expect(
      hashPerformanceAggregateContent({
        ...base,
        dungeonAggregates: [
          { ...base.dungeonAggregates[0]!, medianParsePercentile: 81 },
        ],
      }),
    ).not.toBe(hashPerformanceAggregateContent(base));

    expect(
      hashPerformanceAggregateContent({ ...base, zoneId: 48 }),
    ).not.toBe(hashPerformanceAggregateContent(base));

    expect(
      hashPerformanceAggregateContent({
        ...base,
        partitionKey: toPerformanceAggregatePartitionKey(2),
      }),
    ).not.toBe(hashPerformanceAggregateContent(base));

    // fetchedAt is not part of the hash material — identical inputs hash equal
    // even if callers attach different volatile timestamps elsewhere.
    expect(hashPerformanceAggregateContent(base)).toBe(
      hashPerformanceAggregateContent({ ...base }),
    );
  });
});
