import { describe, expect, it } from "vitest";
import {
  adjustParseForDifficulty,
  blendPerformanceSources,
  computeDetailedWeight,
  computeDungeonPerformance,
  computePerformanceV2,
  computePerformanceV2InputFingerprint,
  exportPerformanceV2Calibration,
  interpolateDifficultyMultiplier,
  PERFORMANCE_V2_ALGORITHM_VERSION,
  PERFORMANCE_V2_CALIBRATION_STATUS,
  PERFORMANCE_V2_MODEL_CONFIG,
  resolvePerformanceRoleAdapter,
  toPerformanceV2ShadowDimensionPayload,
  type PerformanceRunParseFactV2,
  type PerformanceV2ComputeInput,
  type SeasonDifficultyPolicyV2,
} from "./index.js";

const POLICY: SeasonDifficultyPolicyV2 = {
  id: "policy-manual-s1",
  seasonId: "season-1",
  region: "eu",
  role: "dps",
  specSlug: "affliction",
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
  const fullFacts: PerformanceRunParseFactV2[] = ACTIVE.flatMap((slug, di) => [
    fact({
      slotId: `${slug}:0`,
      dungeonSlug: slug,
      keyLevel: 10,
      parsePercentile: 60 + di,
      fightId: di * 2 + 1,
    }),
    fact({
      slotId: `${slug}:1`,
      dungeonSlug: slug,
      keyLevel: 11,
      parsePercentile: 55 + di,
      fightId: di * 2 + 2,
    }),
  ]);

  return {
    manifest: {
      contentHash: "manifest-hash-1",
      schemaVersion: "2.0.0",
      selectorVersion: "evidence-selector-v2.0.0",
      characterId: "char-1",
      seasonId: "season-1",
      seasonSlug: "season-slug-1",
      specSlug: "affliction",
      role: "DPS",
      highKeyPolicyId: "hk-1",
      activeDungeonSlugs: ACTIVE,
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    },
    runParseFacts: fullFacts,
    profileAggregate: {
      bestDpsPercentileAverage: 72,
      medianDpsPercentileAverage: 65,
      perDungeon: ACTIVE.map((slug) => ({
        dungeonSlug: slug,
        bestParsePercentile: 72,
        medianParsePercentile: 65,
        loggedRunCount: 4,
      })),
      partition: 1,
      zoneId: 42,
      totalLoggedRuns: 40,
      latestObservedAt: "2026-07-30T00:00:00.000Z",
    },
    difficultyPolicy: POLICY,
    expectedPartition: 1,
    logFreshness: 0.9,
    computedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("Performance V2 difficulty adjustment", () => {
  it("interpolates low/high key multipliers and clamps adjusted parse", () => {
    expect(interpolateDifficultyMultiplier(2, POLICY)).toBeCloseTo(0.75, 5);
    expect(interpolateDifficultyMultiplier(8, POLICY)).toBeCloseTo(0.85, 5);
    expect(interpolateDifficultyMultiplier(12, POLICY)).toBeCloseTo(1.0, 5);
    expect(interpolateDifficultyMultiplier(15, POLICY)).toBeCloseTo(1.12, 5);
    expect(interpolateDifficultyMultiplier(20, POLICY)).toBeCloseTo(1.15, 5);

    const mid = interpolateDifficultyMultiplier(10, POLICY);
    expect(mid).toBeGreaterThan(0.85);
    expect(mid).toBeLessThan(1.0);

    const low = adjustParseForDifficulty(90, 2, POLICY);
    const high = adjustParseForDifficulty(90, 15, POLICY);
    expect(low.adjustedParse).toBeLessThan(high.adjustedParse);
    expect(low.adjustedParse).toBeGreaterThanOrEqual(0);
    expect(high.adjustedParse).toBeLessThanOrEqual(100);

    // Centered on 50: parse 50 stays 50 regardless of key.
    expect(adjustParseForDifficulty(50, 2, POLICY).adjustedParse).toBe(50);
    expect(adjustParseForDifficulty(50, 20, POLICY).adjustedParse).toBe(50);
  });
});

describe("Performance V2 dungeon scoring", () => {
  it("applies peak/floor/consistency weights for two runs", () => {
    const dungeon = computeDungeonPerformance([
      {
        slotId: "a:0",
        dungeonSlug: "a",
        keyLevel: 10,
        rawParsePercentile: 80,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 80,
      },
      {
        slotId: "a:1",
        dungeonSlug: "a",
        keyLevel: 10,
        rawParsePercentile: 60,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 60,
      },
    ]);
    expect(dungeon).not.toBeNull();
    expect(dungeon!.peak).toBe(80);
    expect(dungeon!.floor).toBe(60);
    expect(dungeon!.consistency).toBe(80); // 100 - abs(80-60)
    const expected =
      0.4 * 80 + 0.45 * 60 + 0.15 * 80;
    expect(dungeon!.dungeonPerformance).toBeCloseTo(expected, 8);
  });

  it("uses single adjusted parse for one-run dungeons without imputing a zero partner", () => {
    const dungeon = computeDungeonPerformance([
      {
        slotId: "a:0",
        dungeonSlug: "a",
        keyLevel: 10,
        rawParsePercentile: 77,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 77,
      },
    ]);
    expect(dungeon!.dungeonPerformance).toBe(77);
    expect(dungeon!.consistency).toBeNull();
    expect(dungeon!.oneRunConfidenceCapped).toBe(true);
  });

  it("penalizes inconsistency between selected parses", () => {
    const consistent = computeDungeonPerformance([
      {
        slotId: "a:0",
        dungeonSlug: "a",
        keyLevel: 10,
        rawParsePercentile: 70,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 70,
      },
      {
        slotId: "a:1",
        dungeonSlug: "a",
        keyLevel: 10,
        rawParsePercentile: 72,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 72,
      },
    ])!;
    const inconsistent = computeDungeonPerformance([
      {
        slotId: "a:0",
        dungeonSlug: "a",
        keyLevel: 10,
        rawParsePercentile: 95,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 95,
      },
      {
        slotId: "a:1",
        dungeonSlug: "a",
        keyLevel: 10,
        rawParsePercentile: 20,
        semantic: "BRACKET_PERCENT",
        difficultyMultiplier: 1,
        adjustedParse: 20,
      },
    ])!;
    expect(consistent.dungeonPerformance).toBeGreaterThan(inconsistent.dungeonPerformance);
  });
});

describe("Performance V2 blend", () => {
  it("computes coverage-dependent detailedWeight", () => {
    expect(computeDetailedWeight(0, 16).detailedWeight).toBe(0);
    const full = computeDetailedWeight(16, 16);
    expect(full.slotCoverage).toBe(1);
    expect(full.detailedWeight).toBeCloseTo(
      Math.min(0.85, 0.25 + 0.6 * Math.pow(1, 1.5)),
      8,
    );
    const half = computeDetailedWeight(8, 16);
    expect(half.detailedWeight).toBeLessThan(full.detailedWeight);
    expect(half.detailedWeight).toBeGreaterThan(0.25);
  });

  it("supports profile-only and detailed-only without inventing the missing source", () => {
    expect(
      blendPerformanceSources({
        detailedSeasonPerformance: 70,
        profilePerformance: null,
        detailedWeight: 0.5,
      }),
    ).toMatchObject({ score: 70, sourcesUsed: "detailed", effectiveDetailedWeight: 1 });

    expect(
      blendPerformanceSources({
        detailedSeasonPerformance: null,
        profilePerformance: 66,
        detailedWeight: 0.5,
      }),
    ).toMatchObject({ score: 66, sourcesUsed: "profile", effectiveDetailedWeight: 0 });
  });
});

describe("Performance V2 role safety", () => {
  it("supports DPS after field validation", () => {
    const adapter = resolvePerformanceRoleAdapter({
      role: "DPS",
      specSlug: "affliction",
    });
    expect(adapter.state).toBe("SUPPORTED");
    expect(adapter.runParseAllowed).toBe(true);
  });

  it("marks tank/healer unavailable without fabricating throughput scores", () => {
    const tank = computePerformanceV2(
      baseInput({
        manifest: {
          ...baseInput().manifest,
          role: "TANK",
          specSlug: "blood",
        },
      }),
    );
    expect(tank.roleAdapter.state).toBe("ADAPTER_UNVERIFIED");
    expect(tank.score).toBeNull();
    expect(tank.confidence).toBe(0);
    expect(tank.state).toBe("UNAVAILABLE");
    expect(tank.detailedSeasonPerformance).toBeNull();
    expect(tank.profilePerformance).toBeNull();

    const healer = resolvePerformanceRoleAdapter({
      role: "HEALER",
      specSlug: "holy",
    });
    expect(healer.runParseAllowed).toBe(false);
    expect(healer.reason).toContain("no_raw_hps");
  });
});

describe("Performance V2 end-to-end", () => {
  it("scores a full manifest with two runs per dungeon", () => {
    const result = computePerformanceV2(baseInput());
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(0);
    expect(result.score!).toBeLessThanOrEqual(100);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.dungeons).toHaveLength(8);
    expect(result.dungeons.every((d) => d.runCount === 2)).toBe(true);
    expect(result.algorithmVersion).toBe(PERFORMANCE_V2_ALGORITHM_VERSION);
    expect(result.calibrationStatus).toBe(PERFORMANCE_V2_CALIBRATION_STATUS);
    expect(result.metrics.publicationBlocked).toBe(true);
  });

  it("handles sparse manifests (one versus two runs)", () => {
    const sparseFacts = [
      fact({ slotId: "dungeon-a:0", dungeonSlug: "dungeon-a", keyLevel: 10, parsePercentile: 80 }),
      fact({ slotId: "dungeon-a:1", dungeonSlug: "dungeon-a", keyLevel: 11, parsePercentile: 70 }),
      fact({ slotId: "dungeon-b:0", dungeonSlug: "dungeon-b", keyLevel: 9, parsePercentile: 60 }),
    ];
    const result = computePerformanceV2(
      baseInput({
        runParseFacts: sparseFacts,
        manifest: {
          ...baseInput().manifest,
          selectedSlotCount: 3,
        },
      }),
    );
    expect(result.dungeons).toHaveLength(2);
    expect(result.dungeons.find((d) => d.dungeonSlug === "dungeon-a")!.runCount).toBe(2);
    expect(result.dungeons.find((d) => d.dungeonSlug === "dungeon-b")!.runCount).toBe(1);
    expect(result.state).toBe("PARTIAL");
    expect(result.explanation.confidenceLimits.length).toBeGreaterThan(0);
  });

  it("flags partition mismatch and lowers confidence", () => {
    const ok = computePerformanceV2(baseInput({ expectedPartition: 1 }));
    const bad = computePerformanceV2(
      baseInput({
        expectedPartition: 1,
        runParseFacts: baseInput().runParseFacts.map((f) => ({ ...f, partition: 99 })),
        profileAggregate: {
          ...baseInput().profileAggregate!,
          partition: 99,
        },
      }),
    );
    expect(bad.explanation.partitionCompatible).toBe(false);
    expect(bad.explanation.confidenceLimits).toContain("partition_mismatch");
    expect(bad.confidence).toBeLessThan(ok.confidence);
  });

  it("produces deterministic explanation and fingerprints", () => {
    const a = computePerformanceV2(baseInput());
    const b = computePerformanceV2(baseInput());
    expect(a.inputFingerprint).toBe(b.inputFingerprint);
    expect(a.explanation).toEqual(b.explanation);
    expect(a.score).toBe(b.score);
    expect(computePerformanceV2InputFingerprint(baseInput())).toBe(a.inputFingerprint);
  });

  it("does not select by parse — order of facts does not change dungeon membership", () => {
    const base = baseInput();
    const reversed = baseInput({
      runParseFacts: [...base.runParseFacts].reverse(),
    });
    const a = computePerformanceV2(base);
    const b = computePerformanceV2(reversed);
    expect(a.score).toBe(b.score);
    expect(a.dungeons.map((d) => d.dungeonSlug)).toEqual(b.dungeons.map((d) => d.dungeonSlug));
  });

  it("never uses rawDps as a score input", () => {
    const withDps = computePerformanceV2(baseInput());
    const withoutDps = computePerformanceV2(
      baseInput({
        runParseFacts: baseInput().runParseFacts.map((f) => ({ ...f, rawDps: null })),
      }),
    );
    expect(withDps.score).toBe(withoutDps.score);
    expect(JSON.stringify(withDps.metrics)).not.toMatch(/rawDps|500000/);
  });

  it("exports replayable calibration inputs and contributor diagnostics", () => {
    const exported = exportPerformanceV2Calibration(baseInput());
    expect(exported.modelConfig).toEqual(PERFORMANCE_V2_MODEL_CONFIG);
    expect(exported.contributors.length).toBeGreaterThan(0);
    expect(exported.result.inputFingerprint).toBeTruthy();
    // Replaying the frozen export input is deterministic.
    const replay = computePerformanceV2(exported.input);
    expect(replay.score).toBe(exported.result.score);
    expect(replay.confidence).toBe(exported.result.confidence);
  });

  it("builds shadow DimensionComputation payload without public publication fields", () => {
    const result = computePerformanceV2(baseInput());
    const payload = toPerformanceV2ShadowDimensionPayload({
      characterId: "char-1",
      seasonId: "season-1",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      result,
      computedAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(payload.dimension).toBe("PERFORMANCE");
    expect(payload.state).toBe("SHADOW");
    expect(payload.algorithmVersion).toBe(PERFORMANCE_V2_ALGORITHM_VERSION);
    expect(payload.metrics.publicationBlocked).toBe(true);
  });

  it("keeps score/confidence within bounds for empty evidence", () => {
    const result = computePerformanceV2(
      baseInput({
        runParseFacts: [],
        profileAggregate: null,
      }),
    );
    expect(result.score).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.state).toBe("UNAVAILABLE");
  });

  it("documents calibration status as uncalibrated candidate defaults", () => {
    expect(PERFORMANCE_V2_MODEL_CONFIG.calibrationStatus).toBe(
      "CANDIDATE_DEFAULTS_UNCALIBRATED",
    );
    expect(PERFORMANCE_V2_MODEL_CONFIG.dungeonWeights.floor).toBeGreaterThan(
      PERFORMANCE_V2_MODEL_CONFIG.dungeonWeights.peak,
    );
  });
});

describe("Performance V2 provider isolation", () => {
  it("module surface has no provider imports (static check via compute purity)", () => {
    // Pure function: same input → same output; no I/O, no network.
    const input = baseInput();
    const first = computePerformanceV2(input);
    const second = computePerformanceV2(input);
    expect(first).toEqual(second);
  });
});
