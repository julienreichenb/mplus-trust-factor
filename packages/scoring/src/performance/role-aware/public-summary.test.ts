/**
 * Agent 04D — role-aware Performance public summary projection tests.
 */
import { describe, expect, it } from "vitest";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  assertPersistedCharacterPerformanceAggregateV2,
} from "@mplus/contracts";
import {
  buildRoleAwarePerformanceSummary,
  computeRoleAwarePerformance,
  extractPersistedRoleAwarePerformanceEvidence,
  mergePublishedSelectedRunsIntoPerformanceSummary,
  projectPerformanceSummaryFromDimensionDetails,
} from "../../index.js";

const ACTIVE = ["algethar-academy", "magisters-terrace", "skyreach"] as const;

function dungeonAggregate(
  slug: string,
  best: number | null,
  median: number | null,
  loggedRunCount = 4,
) {
  return {
    dungeonSlug: slug,
    dungeonName: slug,
    encounterId: 1,
    bestParsePercentile: best,
    medianParsePercentile: median,
    loggedRunCount,
    specialization: "Test",
    keystoneLevel: 12,
    bestDps: 1000,
  };
}

function healerCompact() {
  return assertPersistedCharacterPerformanceAggregateV2({
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    role: "HEALER",
    targetSpecSlug: "restoration",
    zoneId: 47,
    partition: 1,
    damage: {
      metric: "points_and_damage",
      dungeonAggregates: [
        dungeonAggregate("algethar-academy", 54, 48, 26),
        dungeonAggregate("magisters-terrace", 40, 35, 10),
      ],
      bestPercentileAverage: 47,
      medianPercentileAverage: 41.5,
      totalLoggedRuns: 36,
      totalMythicPlusScore: 3000,
      partition: 1,
      zoneId: 47,
      observedSpecs: ["Restoration"],
      specBinding: "EXACT_MATCH",
      wclBestPerformanceAverage: 47,
      wclMedianPerformanceAverage: 41.5,
    },
    healing: {
      metric: "points_and_healing",
      dungeonAggregates: [
        dungeonAggregate("magisters-terrace", 91, 86, 26),
        dungeonAggregate("algethar-academy", 80, 75, 26),
        dungeonAggregate("skyreach", 70, 65, 1),
      ],
      bestPercentileAverage: 80.33,
      medianPercentileAverage: 75.33,
      totalLoggedRuns: 53,
      totalMythicPlusScore: 3000,
      partition: 1,
      zoneId: 47,
      observedSpecs: ["Restoration"],
      specBinding: "EXACT_MATCH",
      wclBestPerformanceAverage: 80.33,
      wclMedianPerformanceAverage: 75.33,
    },
    diagnostics: {
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      provenance: "AGGREGATE_ZONE_RANKINGS",
      role: "HEALER",
      targetSpecSlug: "restoration",
      damageDungeonCount: 2,
      healingDungeonCount: 2,
      expectedDungeonCount: 3,
      specBindingPolicy: "test",
      limitations: [],
    },
  });
}

function dpsCompact() {
  return assertPersistedCharacterPerformanceAggregateV2({
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    role: "DPS",
    targetSpecSlug: "demonology",
    zoneId: 47,
    partition: 1,
    damage: {
      metric: "points_and_damage",
      dungeonAggregates: ACTIVE.map((slug) => dungeonAggregate(slug, 80, 70)),
      bestPercentileAverage: 80,
      medianPercentileAverage: 70,
      totalLoggedRuns: 12,
      totalMythicPlusScore: 3000,
      partition: 1,
      zoneId: 47,
      observedSpecs: ["Demonology"],
      specBinding: "EXACT_MATCH",
      wclBestPerformanceAverage: 80,
      wclMedianPerformanceAverage: 70,
    },
    healing: null,
    diagnostics: {
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      provenance: "AGGREGATE_ZONE_RANKINGS",
      role: "DPS",
      targetSpecSlug: "demonology",
      damageDungeonCount: 3,
      healingDungeonCount: 0,
      expectedDungeonCount: 3,
      specBindingPolicy: "test",
      limitations: [],
    },
  });
}

describe("role-aware public summary projection", () => {
  it("1. DPS roleAware summary exposes damage only", () => {
    const roleAware = computeRoleAwarePerformance({
      role: "DPS",
      specSlug: "demonology",
      activeDungeonSlugs: ACTIVE,
      damage: {
        kind: "damage",
        metric: "points_and_damage",
        bestPercentileAverage: 80,
        medianPercentileAverage: 70,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 12,
        observedSpecs: ["Demonology"],
        specBinding: "EXACT_MATCH",
        perDungeon: ACTIVE.map((slug) => ({
          dungeonSlug: slug,
          bestParsePercentile: 80,
          medianParsePercentile: 70,
        })),
      },
      healing: null,
      cooldownRuns: [],
    });
    const evidence = extractPersistedRoleAwarePerformanceEvidence({
      roleAware,
      activeDungeonSlugs: ACTIVE,
    });
    const summary = buildRoleAwarePerformanceSummary({
      evidence,
      compact: dpsCompact(),
      performanceScore: roleAware.score,
      confidence: roleAware.confidence,
    });
    expect(summary.roleAware?.role).toBe("DPS");
    expect(summary.roleAware?.healing).toBeNull();
    expect(summary.roleAware?.damage.dungeons).toHaveLength(3);
  });

  it("2. Tank roleAware summary exposes damage only", () => {
    const roleAware = computeRoleAwarePerformance({
      role: "TANK",
      specSlug: "guardian",
      activeDungeonSlugs: ACTIVE,
      damage: {
        kind: "damage",
        metric: "points_and_damage",
        bestPercentileAverage: 80,
        medianPercentileAverage: 70,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 12,
        observedSpecs: ["Guardian"],
        specBinding: "EXACT_MATCH",
        perDungeon: ACTIVE.map((slug) => ({
          dungeonSlug: slug,
          bestParsePercentile: 80,
          medianParsePercentile: 70,
        })),
      },
      healing: null,
      cooldownRuns: [],
    });
    const summary = buildRoleAwarePerformanceSummary({
      evidence: extractPersistedRoleAwarePerformanceEvidence({
        roleAware,
        activeDungeonSlugs: ACTIVE,
      }),
      compact: { ...dpsCompact(), role: "TANK", targetSpecSlug: "guardian" },
      performanceScore: roleAware.score,
      confidence: roleAware.confidence,
    });
    expect(summary.roleAware?.role).toBe("TANK");
    expect(summary.roleAware?.healing).toBeNull();
  });

  it("3. Healer exposes damage + healing", () => {
    const compact = healerCompact();
    const roleAware = computeRoleAwarePerformance({
      role: "HEALER",
      specSlug: "restoration",
      activeDungeonSlugs: ACTIVE,
      damage: {
        kind: "damage",
        metric: "points_and_damage",
        bestPercentileAverage: 47,
        medianPercentileAverage: 41.5,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 36,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        perDungeon: compact.damage.dungeonAggregates.map((dungeon) => ({
          dungeonSlug: dungeon.dungeonSlug,
          bestParsePercentile: dungeon.bestParsePercentile,
          medianParsePercentile: dungeon.medianParsePercentile,
        })),
      },
      healing: {
        kind: "healing",
        metric: "points_and_healing",
        bestPercentileAverage: 85.5,
        medianPercentileAverage: 80.5,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 52,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        perDungeon: compact.healing!.dungeonAggregates.map((dungeon) => ({
          dungeonSlug: dungeon.dungeonSlug,
          bestParsePercentile: dungeon.bestParsePercentile,
          medianParsePercentile: dungeon.medianParsePercentile,
        })),
      },
      cooldownRuns: [],
    });
    const summary = buildRoleAwarePerformanceSummary({
      evidence: extractPersistedRoleAwarePerformanceEvidence({
        roleAware,
        activeDungeonSlugs: ACTIVE,
      }),
      compact,
      performanceScore: roleAware.score,
      confidence: roleAware.confidence,
    });
    expect(summary.roleAware?.healing).not.toBeNull();
    expect(summary.roleAware?.damage.dungeons.length).toBeGreaterThan(0);
    expect(summary.roleAware?.healing?.dungeons.length).toBeGreaterThan(0);
  });

  it("4. Healer dungeon merge is by dungeonSlug, not array index", () => {
    const compact = healerCompact();
    const roleAware = computeRoleAwarePerformance({
      role: "HEALER",
      specSlug: "restoration",
      activeDungeonSlugs: ACTIVE,
      damage: {
        kind: "damage",
        metric: "points_and_damage",
        bestPercentileAverage: 47,
        medianPercentileAverage: 41.5,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 36,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        perDungeon: compact.damage.dungeonAggregates.map((dungeon) => ({
          dungeonSlug: dungeon.dungeonSlug,
          bestParsePercentile: dungeon.bestParsePercentile,
          medianParsePercentile: dungeon.medianParsePercentile,
        })),
      },
      healing: {
        kind: "healing",
        metric: "points_and_healing",
        bestPercentileAverage: 85.5,
        medianPercentileAverage: 80.5,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 52,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        perDungeon: compact.healing!.dungeonAggregates.map((dungeon) => ({
          dungeonSlug: dungeon.dungeonSlug,
          bestParsePercentile: dungeon.bestParsePercentile,
          medianParsePercentile: dungeon.medianParsePercentile,
        })),
      },
      cooldownRuns: [],
    });
    const summary = buildRoleAwarePerformanceSummary({
      evidence: extractPersistedRoleAwarePerformanceEvidence({
        roleAware,
        activeDungeonSlugs: ACTIVE,
      }),
      compact,
      performanceScore: roleAware.score,
      confidence: roleAware.confidence,
    });
    const healingMagisters = summary.roleAware?.healing?.dungeons.find(
      (dungeon) => dungeon.dungeonSlug === "magisters-terrace",
    );
    const damageMagisters = summary.roleAware?.damage.dungeons.find(
      (dungeon) => dungeon.dungeonSlug === "magisters-terrace",
    );
    expect(healingMagisters?.bestParsePercentile).toBe(91);
    expect(damageMagisters?.bestParsePercentile).toBe(40);
  });

  it("5-7. Missing channel cells are null; loggedRunCount preserved per channel", () => {
    const compact = healerCompact();
    const roleAware = computeRoleAwarePerformance({
      role: "HEALER",
      specSlug: "restoration",
      activeDungeonSlugs: ACTIVE,
      damage: {
        kind: "damage",
        metric: "points_and_damage",
        bestPercentileAverage: 47,
        medianPercentileAverage: 41.5,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 36,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        perDungeon: compact.damage.dungeonAggregates.map((dungeon) => ({
          dungeonSlug: dungeon.dungeonSlug,
          bestParsePercentile: dungeon.bestParsePercentile,
          medianParsePercentile: dungeon.medianParsePercentile,
        })),
      },
      healing: {
        kind: "healing",
        metric: "points_and_healing",
        bestPercentileAverage: 80.33,
        medianPercentileAverage: 75.33,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 53,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        perDungeon: compact.healing!.dungeonAggregates.map((dungeon) => ({
          dungeonSlug: dungeon.dungeonSlug,
          bestParsePercentile: dungeon.bestParsePercentile,
          medianParsePercentile: dungeon.medianParsePercentile,
        })),
      },
      cooldownRuns: [],
    });
    const summary = buildRoleAwarePerformanceSummary({
      evidence: extractPersistedRoleAwarePerformanceEvidence({
        roleAware,
        activeDungeonSlugs: ACTIVE,
      }),
      compact,
      performanceScore: roleAware.score,
      confidence: roleAware.confidence,
    });
    const skyreachDamage = summary.roleAware?.damage.dungeons.find(
      (dungeon) => dungeon.dungeonSlug === "skyreach",
    );
    const skyreachHealing = summary.roleAware?.healing?.dungeons.find(
      (dungeon) => dungeon.dungeonSlug === "skyreach",
    );
    expect(skyreachDamage).toBeUndefined();
    expect(skyreachHealing?.loggedRunCount).toBe(1);
    expect(
      compact.damage.dungeonAggregates.find((d) => d.dungeonSlug === "algethar-academy")
        ?.loggedRunCount,
    ).toBe(26);
    expect(
      compact.healing.dungeonAggregates.find((d) => d.dungeonSlug === "magisters-terrace")
        ?.loggedRunCount,
    ).toBe(26);
  });

  it("8-9. dimensionDetails projection omits raw payload and exposes roleAware summary", () => {
    const compact = dpsCompact();
    const roleAware = computeRoleAwarePerformance({
      role: "DPS",
      specSlug: "demonology",
      activeDungeonSlugs: ACTIVE,
      damage: {
        kind: "damage",
        metric: "points_and_damage",
        bestPercentileAverage: 80,
        medianPercentileAverage: 70,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 12,
        observedSpecs: ["Demonology"],
        specBinding: "EXACT_MATCH",
        perDungeon: ACTIVE.map((slug) => ({
          dungeonSlug: slug,
          bestParsePercentile: 80,
          medianParsePercentile: 70,
        })),
      },
      healing: null,
      cooldownRuns: [],
    });
    const dimensionDetails = {
      performance: {
        confidence: roleAware.confidence,
        roleAware: extractPersistedRoleAwarePerformanceEvidence({
          roleAware,
          activeDungeonSlugs: ACTIVE,
        }),
      },
      performanceAggregate: {
        state: "AVAILABLE",
        compact,
      },
    };
    const summary = projectPerformanceSummaryFromDimensionDetails(
      dimensionDetails,
      roleAware.score,
      roleAware.confidence,
    );
    expect(summary?.roleAware).toBeDefined();
    expect(summary?.roleAware?.performanceScore).toBe(roleAware.score);
    expect(JSON.stringify(dimensionDetails)).not.toContain("rawPayload");
    expect(JSON.stringify(dimensionDetails)).not.toContain("reportCode");
  });

  it("10. mergePublishedSelectedRuns attaches legacy run refs without replacing roleAware cells", () => {
    const operational = buildRoleAwarePerformanceSummary({
      evidence: extractPersistedRoleAwarePerformanceEvidence({
        roleAware: computeRoleAwarePerformance({
          role: "DPS",
          specSlug: "demonology",
          activeDungeonSlugs: ["algethar-academy"],
          damage: {
            kind: "damage",
            metric: "points_and_damage",
            bestPercentileAverage: 80,
            medianPercentileAverage: 70,
            partition: 1,
            zoneId: 47,
            totalLoggedRuns: 4,
            observedSpecs: ["Demonology"],
            specBinding: "EXACT_MATCH",
            perDungeon: [
              {
                dungeonSlug: "algethar-academy",
                bestParsePercentile: 80,
                medianParsePercentile: 70,
              },
            ],
          },
          healing: null,
          cooldownRuns: [],
        }),
        activeDungeonSlugs: ["algethar-academy"],
      }),
      compact: dpsCompact(),
      performanceScore: 80,
      confidence: 1,
    });
    const published = {
      currentSeason: {
        peakScore: 10,
        consistencyScore: 10,
        score: 10,
        confidence: 0.1,
        dungeonCount: 1,
        expectedDungeonCount: 8,
        latestObservedAt: null,
        dungeons: [
          {
            dungeonSlug: "algethar-academy",
            dungeonName: "Algeth'ar Academy",
            bestParsePercentile: 10,
            medianParsePercentile: 10,
            loggedRunCount: 1,
            bestRun: {
              runId: "run-1",
              kind: "BEST" as const,
              dungeonSlug: "algethar-academy",
              dungeonName: "Algeth'ar Academy",
              keyLevel: 12,
              completedAt: "2026-01-01T00:00:00.000Z",
              timed: true,
              parsePercentile: 10,
              scoreValue: 100,
              wclUrl: "https://www.warcraftlogs.com/reports/ABC?fight=1",
            },
            latestRun: null,
          },
        ],
      },
      historical: null,
    };
    const merged = mergePublishedSelectedRunsIntoPerformanceSummary(operational, published);
    expect(merged.roleAware?.damage.dungeons[0]?.bestParsePercentile).toBe(80);
    expect(merged.currentSeason.dungeons[0]?.bestRun?.runId).toBe("run-1");
  });
});
