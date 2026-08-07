/**
 * Functional Performance Phase 1 requirement coverage (A–H).
 * Reuses Performance V2 internals that back Phase 2.
 */
import { describe, expect, it } from "vitest";
import {
  adjustParseForDifficulty,
  computeDetailedSeasonPerformance,
  computeDungeonPerformance,
  computePerformanceV2,
  type PerformanceRunParseFactV2,
  type PerformanceV2ComputeInput,
  type SeasonDifficultyPolicyV2,
} from "../v2/index.js";

const POLICY: SeasonDifficultyPolicyV2 = {
  id: "policy-manual-s1",
  seasonId: "season-1",
  region: "eu",
  role: "dps",
  specSlug: "fire",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  k50: 8,
  k90: 12,
  k99: 15,
  source: "MANUAL",
  sampleSize: 1000,
  confidence: 0.8,
  version: "sdp-v1",
};

const ACTIVE = [
  "dungeon-a",
  "dungeon-b",
  "dungeon-c",
  "dungeon-d",
  "dungeon-e",
  "dungeon-f",
  "dungeon-g",
  "dungeon-h",
];

function fact(
  overrides: Partial<PerformanceRunParseFactV2> &
    Pick<PerformanceRunParseFactV2, "slotId" | "dungeonSlug" | "keyLevel">,
): PerformanceRunParseFactV2 {
  return {
    parsePercentile: 70,
    semantic: "BRACKET_PERCENT",
    partition: 1,
    rawDps: 500_000,
    reportCode: "AbCdEfGh",
    fightId: 1,
    reportRevision: 1,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<PerformanceV2ComputeInput> = {},
): PerformanceV2ComputeInput {
  return {
    manifest: {
      contentHash: "manifest-hash-1",
      schemaVersion: "2.0.0",
      selectorVersion: "evidence-selector-v2.0.0",
      characterId: "char-1",
      seasonId: "season-1",
      seasonSlug: "season-slug-1",
      specSlug: "fire",
      role: "DPS",
      highKeyPolicyId: "hk-1",
      activeDungeonSlugs: ACTIVE,
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    },
    runParseFacts: [],
    profileAggregate: null,
    difficultyPolicy: POLICY,
    expectedPartition: 1,
    logFreshness: 0.9,
    computedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("Performance Phase 1 requirements", () => {
  it("A — consumes at most two selected runs per dungeon (ignores a third)", () => {
    const facts = [
      fact({
        slotId: "dungeon-a:0",
        dungeonSlug: "dungeon-a",
        keyLevel: 15,
        parsePercentile: 90,
      }),
      fact({
        slotId: "dungeon-a:1",
        dungeonSlug: "dungeon-a",
        keyLevel: 14,
        parsePercentile: 85,
      }),
      fact({
        slotId: "dungeon-a:2",
        dungeonSlug: "dungeon-a",
        keyLevel: 13,
        parsePercentile: 99,
      }),
    ];
    const detailed = computeDetailedSeasonPerformance({
      runParseFacts: facts,
      activeDungeonSlugs: ["dungeon-a"],
      difficultyPolicy: POLICY,
      runParseAllowed: true,
    });
    expect(detailed.dungeons).toHaveLength(1);
    expect(detailed.dungeons[0]!.runCount).toBe(2);
    expect(detailed.dungeons[0]!.runs.map((r) => r.slotId).sort()).toEqual([
      "dungeon-a:0",
      "dungeon-a:1",
    ]);
    expect(detailed.validDetailedSlotCount).toBe(2);
  });

  it("B — strong consistent player beats high peak + low floor", () => {
    const strong = computeDungeonPerformance([
      {
        slotId: "a:0",
        dungeonSlug: "a",
        keyLevel: 12,
        rawParsePercentile: 90,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 90,
      },
      {
        slotId: "a:1",
        dungeonSlug: "a",
        keyLevel: 12,
        rawParsePercentile: 88,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 88,
      },
    ])!;
    const volatile = computeDungeonPerformance([
      {
        slotId: "a:0",
        dungeonSlug: "a",
        keyLevel: 12,
        rawParsePercentile: 90,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 90,
      },
      {
        slotId: "a:1",
        dungeonSlug: "a",
        keyLevel: 12,
        rawParsePercentile: 20,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 20,
      },
    ])!;
    expect(strong.dungeonPerformance).toBeGreaterThan(volatile.dungeonPerformance);
  });

  it("C — consistently weak parses remain weak (small delta alone is not strong)", () => {
    const weak = computeDungeonPerformance([
      {
        slotId: "a:0",
        dungeonSlug: "a",
        keyLevel: 12,
        rawParsePercentile: 25,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 25,
      },
      {
        slotId: "a:1",
        dungeonSlug: "a",
        keyLevel: 12,
        rawParsePercentile: 27,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 27,
      },
    ])!;
    expect(weak.consistency).toBe(98);
    expect(weak.dungeonPerformance).toBeLessThan(40);
  });

  it("D — high-key weighting: same parse worth more at high season-relative key", () => {
    const low = adjustParseForDifficulty(90, 2, POLICY);
    const high = adjustParseForDifficulty(90, 15, POLICY);
    expect(high.adjustedParse).toBeGreaterThan(low.adjustedParse);
  });

  it("E — profile aggregate contributes via validated blend", () => {
    const detailedOnly = computePerformanceV2(
      baseInput({
        runParseFacts: ACTIVE.flatMap((slug) => [
          fact({
            slotId: `${slug}:0`,
            dungeonSlug: slug,
            keyLevel: 12,
            parsePercentile: 80,
          }),
          fact({
            slotId: `${slug}:1`,
            dungeonSlug: slug,
            keyLevel: 11,
            parsePercentile: 75,
          }),
        ]),
        profileAggregate: null,
      }),
    );
    const withProfile = computePerformanceV2(
      baseInput({
        runParseFacts: ACTIVE.flatMap((slug) => [
          fact({
            slotId: `${slug}:0`,
            dungeonSlug: slug,
            keyLevel: 12,
            parsePercentile: 80,
          }),
          fact({
            slotId: `${slug}:1`,
            dungeonSlug: slug,
            keyLevel: 11,
            parsePercentile: 75,
          }),
        ]),
        profileAggregate: {
          bestDpsPercentileAverage: 50,
          medianDpsPercentileAverage: 40,
          perDungeon: ACTIVE.map((slug) => ({
            dungeonSlug: slug,
            bestParsePercentile: 50,
            medianParsePercentile: 40,
            loggedRunCount: 3,
          })),
          partition: 1,
          zoneId: 42,
          totalLoggedRuns: 30,
          latestObservedAt: null,
        },
      }),
    );
    expect(detailedOnly.score).not.toBeNull();
    expect(withProfile.score).not.toBeNull();
    expect(withProfile.profilePerformance).not.toBeNull();
    expect(withProfile.detailedWeight).toBeLessThan(1);
    expect(withProfile.score!).toBeLessThan(detailedOnly.score!);
  });

  it("F — missing second run is partial evidence without fabricated zero", () => {
    const dungeon = computeDungeonPerformance([
      {
        slotId: "a:0",
        dungeonSlug: "a",
        keyLevel: 12,
        rawParsePercentile: 77,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 77,
      },
    ])!;
    expect(dungeon.runCount).toBe(1);
    expect(dungeon.dungeonPerformance).toBe(77);
    expect(dungeon.consistency).toBeNull();
    expect(dungeon.oneRunConfidenceCapped).toBe(true);
  });

  it("G — missing dungeons are omitted, not zero-filled", () => {
    const detailed = computeDetailedSeasonPerformance({
      runParseFacts: [
        fact({
          slotId: "dungeon-a:0",
          dungeonSlug: "dungeon-a",
          keyLevel: 12,
          parsePercentile: 80,
        }),
      ],
      activeDungeonSlugs: ACTIVE,
      difficultyPolicy: POLICY,
      runParseAllowed: true,
    });
    expect(detailed.dungeons).toHaveLength(1);
    expect(detailed.dungeons[0]!.dungeonSlug).toBe("dungeon-a");
    expect(detailed.dungeons.map((d) => d.dungeonPerformance)).not.toContain(0);
  });

  it("H — non-active dungeon rows do not contribute", () => {
    const detailed = computeDetailedSeasonPerformance({
      runParseFacts: [
        fact({
          slotId: "dungeon-a:0",
          dungeonSlug: "dungeon-a",
          keyLevel: 12,
          parsePercentile: 80,
        }),
        fact({
          slotId: "legacy-dungeon:0",
          dungeonSlug: "legacy-dungeon",
          keyLevel: 20,
          parsePercentile: 99,
        }),
      ],
      activeDungeonSlugs: ["dungeon-a"],
      difficultyPolicy: POLICY,
      runParseAllowed: true,
    });
    expect(detailed.dungeons).toHaveLength(1);
    expect(detailed.dungeons[0]!.dungeonSlug).toBe("dungeon-a");
  });

  it("invalid key level is omitted (no silent difficulty default)", () => {
    const detailed = computeDetailedSeasonPerformance({
      runParseFacts: [
        fact({
          slotId: "dungeon-a:0",
          dungeonSlug: "dungeon-a",
          keyLevel: 0,
          parsePercentile: 99,
        }),
      ],
      activeDungeonSlugs: ["dungeon-a"],
      difficultyPolicy: POLICY,
      runParseAllowed: true,
    });
    expect(detailed.dungeons).toHaveLength(0);
    expect(detailed.detailedSeasonPerformance).toBeNull();
  });
});
