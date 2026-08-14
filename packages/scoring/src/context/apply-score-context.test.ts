import { describe, expect, it } from "vitest";
import type { SeasonScoreContextRevisionDoc } from "@mplus/contracts";
import type { ScoringRunSelection } from "../selection/scoring-run-selection.js";
import {
  applyScoreContext,
  defaultNeutralTierFactors,
  isCompleteCanonicalRunSelection,
} from "./apply-score-context.js";
import { computeTrueMedian } from "./median.js";
import { validateMedianKeyDistributionPoints } from "./validate-distribution.js";

const EIGHT = [
  "ara-kara",
  "city-of-threads",
  "the-dawnbreaker",
  "the-stonevault",
  "mists-of-tirna-scithe",
  "the-necrotic-wake",
  "siege-of-boralus",
  "grim-batol",
] as const;

function selection(keys: number[], expected = 8): ScoringRunSelection {
  return {
    seasonSlug: "s1",
    expectedDungeonCount: expected,
    selectedRuns: keys.map((keyLevel, i) => ({
      dungeonSlug: EIGHT[i] ?? `dungeon-${i}`,
      canonicalRunId: `run-${i}`,
      keyLevel,
      timed: true,
      completedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 1000,
      raiderIoScore: 200,
      wclReportMatched: true,
      wclCoverageRatio: 1,
      selectionReason: "HIGHEST_KEY",
    })),
  };
}

function revision(overrides: Partial<SeasonScoreContextRevisionDoc> = {}): SeasonScoreContextRevisionDoc {
  return {
    id: "rev-1",
    blizzardSeasonId: 17,
    seasonId: "season-a",
    version: 1,
    status: "PUBLISHED",
    publishedAt: "2026-01-01T00:00:00.000Z",
    tierFactors: defaultNeutralTierFactors(),
    specAssignments: [],
    percentileAnchors: [
      { percentileBps: 8000, factor: 0.9 },
      { percentileBps: 9000, factor: 1.0 },
      { percentileBps: 9900, factor: 1.1 },
      { percentileBps: 9990, factor: 1.5 },
    ],
    regionSnapshots: [],
    distribution: {
      id: "dist-1",
      seasonId: "season-a",
      source: "MANUAL_IMPORT",
      provenance: { note: "test" },
      sourceVersion: "v1",
      collectedAt: "2026-01-01T00:00:00.000Z",
      effectiveAt: null,
      contentHash: "abc",
      points: [
        { percentileBps: 8000, medianKeyThreshold: 16 },
        { percentileBps: 9000, medianKeyThreshold: 20 },
        { percentileBps: 9900, medianKeyThreshold: 22 },
        { percentileBps: 9990, medianKeyThreshold: 24 },
      ],
    },
    ...overrides,
  };
}

describe("canonical 8-run median", () => {
  it("B: [18,18,19,19,20,20,21,22] => 19.5", () => {
    expect(computeTrueMedian([18, 18, 19, 19, 20, 20, 21, 22])).toBe(19.5);
  });

  it("C: 16-slot trap — extra internal slots do not change median", () => {
    const eight = selection([18, 18, 19, 19, 20, 20, 21, 22]);
    const sixteenKeys = [18, 18, 19, 19, 20, 20, 21, 22, 99, 99, 99, 99, 99, 99, 99, 99];
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 70,
      canonicalRunSelection: eight,
      seasonContextRevision: revision(),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(applied.key.medianKeyLevel).toBe(19.5);
    expect(computeTrueMedian(sixteenKeys)).not.toBe(applied.key.medianKeyLevel);
    expect(applied.key.canonicalRuns).toHaveLength(8);
  });

  it("D: 7/8 is incomplete — no median-of-7", () => {
    const seven = selection([18, 18, 19, 19, 20, 20, 21], 8);
    expect(isCompleteCanonicalRunSelection(seven)).toBe(false);
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 70,
      canonicalRunSelection: seven,
      seasonContextRevision: revision(),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(applied.key.status).toBe("INCOMPLETE_SELECTION");
    expect(applied.key.medianKeyLevel).toBeNull();
    expect(applied.key.factor).toBe(1);
    expect(applied.key.reason).toBe("INCOMPLETE_CANONICAL_SELECTION");
  });
});

describe("applyScoreContext", () => {
  it("A: neutral 1×1 preserves exact raw", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 73.421,
      canonicalRunSelection: selection([18, 18, 19, 19, 20, 20, 21, 22]),
      seasonContextRevision: revision({
        percentileAnchors: [{ percentileBps: 9000, factor: 1 }],
        distribution: {
          ...revision().distribution!,
          points: [{ percentileBps: 9000, medianKeyThreshold: 19.5 }],
        },
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 3 }],
        tierFactors: defaultNeutralTierFactors(),
      }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(applied.key.factor).toBe(1);
    expect(applied.meta.factor).toBe(1);
    expect(applied.combinedFactor).toBe(1);
    expect(applied.finalScore).toBe(73.421);
    expect(applied.wasClamped).toBe(false);
  });

  it("A2: 75 × 1.10 × 1.05 uses exact multiply then clamp (IEEE, no extra rounding)", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 75,
      canonicalRunSelection: selection([22, 22, 22, 22, 22, 22, 22, 22]),
      seasonContextRevision: revision({
        percentileAnchors: [{ percentileBps: 9900, factor: 1.1 }],
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 4 }],
        tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1.05, 5: 1 },
        distribution: {
          ...revision().distribution!,
          points: [{ percentileBps: 9900, medianKeyThreshold: 22 }],
        },
      }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "test" },
      gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
    });
    const expectedCombined = 1.1 * 1.05;
    const expectedPreClamp = 75 * expectedCombined;
    expect(applied.combinedFactor).toBe(expectedCombined);
    expect(applied.preClampAdjustedScore).toBe(expectedPreClamp);
    expect(applied.finalScore).toBe(expectedPreClamp);
    expect(applied.finalGrade).toBe("A");
  });

  it("E: step anchors at exact / between / below / above", () => {
    const rev = revision();
    const spec = { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" as const };
    const atExact = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: rev,
      seasonScoringSpec: spec,
    });
    expect(atExact.key.appliedAnchorPercentileBps).toBe(9000);
    expect(atExact.key.factor).toBe(1.0);

    const between = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([21, 21, 21, 21, 21, 21, 21, 21]),
      seasonContextRevision: rev,
      seasonScoringSpec: spec,
    });
    expect(between.key.appliedAnchorPercentileBps).toBe(9000);
    expect(between.key.appliedAnchorKeyThreshold).toBe(20);
    expect(between.key.nextAnchorPercentileBps).toBe(9900);

    const below = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([10, 10, 10, 10, 10, 10, 10, 10]),
      seasonContextRevision: rev,
      seasonScoringSpec: spec,
    });
    expect(below.key.appliedAnchorPercentileBps).toBe(8000);
    expect(below.key.factor).toBe(0.9);

    const above = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([30, 30, 30, 30, 30, 30, 30, 30]),
      seasonContextRevision: rev,
      seasonScoringSpec: spec,
    });
    expect(above.key.appliedAnchorPercentileBps).toBe(9990);
    expect(above.key.factor).toBe(1.5);
  });

  it("F: duplicate threshold — greatest percentileBps wins", () => {
    const rev = revision({
      percentileAnchors: [
        { percentileBps: 9900, factor: 1.1 },
        { percentileBps: 9990, factor: 1.5 },
      ],
      distribution: {
        ...revision().distribution!,
        points: [
          { percentileBps: 9900, medianKeyThreshold: 22 },
          { percentileBps: 9990, medianKeyThreshold: 22 },
        ],
      },
    });
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([22, 22, 22, 22, 22, 22, 22, 22]),
      seasonContextRevision: rev,
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(applied.key.appliedAnchorPercentileBps).toBe(9990);
    expect(applied.key.factor).toBe(1.5);
  });

  it("F2: duplicate threshold winner is greatest percentileBps, not larger factor", () => {
    const rev = revision({
      percentileAnchors: [
        { percentileBps: 9900, factor: 1.5 },
        { percentileBps: 9990, factor: 1.05 },
      ],
      distribution: {
        ...revision().distribution!,
        points: [
          { percentileBps: 9900, medianKeyThreshold: 22 },
          { percentileBps: 9990, medianKeyThreshold: 22 },
        ],
      },
    });
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([22, 22, 22, 22, 22, 22, 22, 22]),
      seasonContextRevision: rev,
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(applied.key.appliedAnchorPercentileBps).toBe(9990);
    expect(applied.key.factor).toBe(1.05);
  });

  it("G: missing distribution → ×1 UNKNOWN", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: revision({ distribution: null }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(applied.key.status).toBe("UNKNOWN");
    expect(applied.key.factor).toBe(1);
    expect(applied.key.reason).toBe("MEDIAN_KEY_DISTRIBUTION_MISSING");
  });

  it("H: mapped Tier 5 uses configured factor", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: revision({
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 5 }],
        tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1.2 },
      }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(applied.meta.status).toBe("AVAILABLE");
    expect(applied.meta.tier).toBe(5);
    expect(applied.meta.factor).toBe(1.2);
  });

  it("I: missing mapping is NOT_CONFIGURED not Tier 3", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: revision(),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(applied.meta.status).toBe("NOT_CONFIGURED");
    expect(applied.meta.tier).toBeNull();
    expect(applied.meta.factor).toBe(1);
    expect(applied.meta.reason).toBe("NOT_CONFIGURED");
  });

  it("J: clamp retains preClamp and wasClamped", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 90,
      canonicalRunSelection: selection([24, 24, 24, 24, 24, 24, 24, 24]),
      seasonContextRevision: revision({
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 5 }],
        tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
      }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(applied.combinedFactor).toBe(1.5);
    expect(applied.preClampAdjustedScore).toBe(135);
    expect(applied.finalScore).toBe(100);
    expect(applied.wasClamped).toBe(true);
  });

  it("K: season isolation — same spec different tiers", () => {
    const spec = { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" as const };
    const a = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: revision({
        id: "rev-a",
        seasonId: "season-a",
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 1 }],
        tierFactors: { 1: 0.8, 2: 1, 3: 1, 4: 1, 5: 1 },
      }),
      seasonScoringSpec: spec,
    });
    const b = applyScoreContext({
      seasonId: "season-b",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: revision({
        id: "rev-b",
        seasonId: "season-b",
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 5 }],
        tierFactors: { 1: 0.8, 2: 1, 3: 1, 4: 1, 5: 1.25 },
      }),
      seasonScoringSpec: spec,
    });
    expect(a.meta.tier).toBe(1);
    expect(a.meta.factor).toBe(0.8);
    expect(b.meta.tier).toBe(5);
    expect(b.meta.factor).toBe(1.25);
  });

  it("L: applied snapshot retains revision identity after a later revision exists", () => {
    const first = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: revision({ id: "rev-n", version: 1 }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(first.contextRevisionId).toBe("rev-n");
    expect(first.contextRevisionVersion).toBe(1);
    const later = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: revision({ id: "rev-n1", version: 2 }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "WCL_ACTIVE_DUNGEONS" },
    });
    expect(later.contextRevisionId).toBe("rev-n1");
    expect(first.contextRevisionId).not.toBe(later.contextRevisionId);
  });

  it("SPEC_UNKNOWN when spec missing", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 80,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: revision(),
      seasonScoringSpec: { classSlug: "mage", specSlug: null, source: "WCL_SEASON_SPEC_AMBIGUOUS" },
    });
    expect(applied.meta.status).toBe("SPEC_UNKNOWN");
    expect(applied.meta.factor).toBe(1);
  });
});

describe("distribution import validation", () => {
  it("rejects duplicate percentile identities", () => {
    const result = validateMedianKeyDistributionPoints([
      { percentileBps: 9000, medianKeyThreshold: 20 },
      { percentileBps: 9000, medianKeyThreshold: 21 },
    ]);
    expect(result.ok).toBe(false);
  });

  it("allows repeated concrete thresholds", () => {
    const result = validateMedianKeyDistributionPoints([
      { percentileBps: 9900, medianKeyThreshold: 22 },
      { percentileBps: 9990, medianKeyThreshold: 22 },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects decreasing thresholds", () => {
    const result = validateMedianKeyDistributionPoints([
      { percentileBps: 9000, medianKeyThreshold: 22 },
      { percentileBps: 9900, medianKeyThreshold: 20 },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects percentile outside 1..10000", () => {
    expect(
      validateMedianKeyDistributionPoints([{ percentileBps: 0, medianKeyThreshold: 20 }]).ok,
    ).toBe(false);
    expect(
      validateMedianKeyDistributionPoints([{ percentileBps: 10001, medianKeyThreshold: 20 }]).ok,
    ).toBe(false);
  });

  it("rejects NaN and Infinity thresholds", () => {
    expect(
      validateMedianKeyDistributionPoints([{ percentileBps: 9000, medianKeyThreshold: Number.NaN }]).ok,
    ).toBe(false);
    expect(
      validateMedianKeyDistributionPoints([
        { percentileBps: 9000, medianKeyThreshold: Number.POSITIVE_INFINITY },
      ]).ok,
    ).toBe(false);
  });

  it("rejects malformed median key values", () => {
    expect(
      validateMedianKeyDistributionPoints([{ percentileBps: 9000, medianKeyThreshold: "20" }]).ok,
    ).toBe(false);
    expect(validateMedianKeyDistributionPoints("not-an-array").ok).toBe(false);
  });
});

describe("raw vs final grade", () => {
  const thresholds = { S: 90, A: 80, B: 65, C: 50 };

  it("A: neutral factors keep identical raw/final grades", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 75,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: revision({
        percentileAnchors: [{ percentileBps: 9000, factor: 1 }],
        distribution: {
          id: "dist-1",
          seasonId: "season-a",
          source: "MANUAL_IMPORT",
          provenance: {},
          sourceVersion: "v1",
          collectedAt: "2026-01-01T00:00:00.000Z",
          effectiveAt: null,
          contentHash: "x",
          points: [{ percentileBps: 9000, medianKeyThreshold: 16 }],
        },
      }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "arcane", source: "test" },
      gradeThresholds: thresholds,
    });
    expect(applied.finalScore).toBe(75);
    expect(applied.rawGrade).toBe("B");
    expect(applied.finalGrade).toBe("B");
  });

  it("B: promotion uses finalScore thresholds (75 × 1.25 → 93.75 S)", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 75,
      canonicalRunSelection: selection([20, 20, 20, 20, 20, 20, 20, 20]),
      seasonContextRevision: revision({
        percentileAnchors: [{ percentileBps: 9000, factor: 1.25 }],
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 5 }],
        tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
        distribution: {
          id: "dist-1",
          seasonId: "season-a",
          source: "MANUAL_IMPORT",
          provenance: {},
          sourceVersion: "v1",
          collectedAt: "2026-01-01T00:00:00.000Z",
          effectiveAt: null,
          contentHash: "x",
          points: [{ percentileBps: 9000, medianKeyThreshold: 16 }],
        },
      }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "test" },
      gradeThresholds: thresholds,
    });
    expect(applied.rawGrade).toBe("B");
    expect(applied.finalScore).toBe(93.75);
    expect(applied.finalGrade).toBe("S");
  });

  it("C: penalty can drop S to A", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 92,
      canonicalRunSelection: selection([16, 16, 16, 16, 16, 16, 16, 16]),
      seasonContextRevision: revision({
        percentileAnchors: [{ percentileBps: 9000, factor: 0.9 }],
        distribution: {
          id: "dist-1",
          seasonId: "season-a",
          source: "MANUAL_IMPORT",
          provenance: {},
          sourceVersion: "v1",
          collectedAt: "2026-01-01T00:00:00.000Z",
          effectiveAt: null,
          contentHash: "x",
          points: [{ percentileBps: 9000, medianKeyThreshold: 20 }],
        },
      }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "arcane", source: "test" },
      gradeThresholds: thresholds,
    });
    expect(applied.rawGrade).toBe("S");
    expect(applied.finalScore).toBeCloseTo(82.8, 5);
    expect(applied.finalGrade).toBe("A");
  });

  it("D: clamp 90 × 1.5 → 100 grades from 100", () => {
    const applied = applyScoreContext({
      seasonId: "season-a",
      rawScoreBeforeContext: 90,
      canonicalRunSelection: selection([24, 24, 24, 24, 24, 24, 24, 24]),
      seasonContextRevision: revision({
        percentileAnchors: [{ percentileBps: 9990, factor: 1.5 }],
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 5 }],
        tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
        distribution: {
          id: "dist-1",
          seasonId: "season-a",
          source: "MANUAL_IMPORT",
          provenance: {},
          sourceVersion: "v1",
          collectedAt: "2026-01-01T00:00:00.000Z",
          effectiveAt: null,
          contentHash: "x",
          points: [{ percentileBps: 9990, medianKeyThreshold: 16 }],
        },
      }),
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "test" },
      gradeThresholds: thresholds,
    });
    expect(applied.preClampAdjustedScore).toBe(135);
    expect(applied.wasClamped).toBe(true);
    expect(applied.finalScore).toBe(100);
    expect(applied.finalGrade).toBe("S");
  });
});

describe("shared percentile policy across regional distributions", () => {
  const policy = revision({
    distribution: null,
    percentileAnchors: [
      { percentileBps: 6000, factor: 0.9 },
      { percentileBps: 7500, factor: 0.95 },
      { percentileBps: 9000, factor: 1.1 },
      { percentileBps: 9900, factor: 1.1 },
      { percentileBps: 9990, factor: 1.2 },
    ],
  });
  const euDist = {
    id: "snap-eu",
    seasonId: "eu-s17",
    source: "RAIDER_IO_ADDON",
    provenance: {},
    sourceVersion: "v1",
    collectedAt: "2026-01-01T00:00:00.000Z",
    effectiveAt: null,
    contentHash: "eu",
    points: [
      { percentileBps: 6000, medianKeyThreshold: 14 },
      { percentileBps: 7500, medianKeyThreshold: 16 },
      { percentileBps: 9000, medianKeyThreshold: 18 },
      { percentileBps: 9900, medianKeyThreshold: 22 },
      { percentileBps: 9990, medianKeyThreshold: 23 },
    ],
  };
  const usDist = {
    ...euDist,
    id: "snap-us",
    seasonId: "us-s17",
    contentHash: "us",
    points: [
      { percentileBps: 6000, medianKeyThreshold: 13 },
      { percentileBps: 7500, medianKeyThreshold: 15 },
      { percentileBps: 9000, medianKeyThreshold: 17 },
      { percentileBps: 9900, medianKeyThreshold: 21 },
      { percentileBps: 9990, medianKeyThreshold: 22 },
    ],
  };

  it("A: EU +18 and US +17 both resolve to shared P90 factor", () => {
    const eu = applyScoreContext({
      seasonId: "eu-s17",
      rawScoreBeforeContext: 70,
      canonicalRunSelection: selection([18, 18, 18, 18, 18, 18, 18, 18]),
      seasonContextRevision: policy,
      regionalDistribution: euDist,
      seasonScoringSpec: null,
    });
    const us = applyScoreContext({
      seasonId: "us-s17",
      rawScoreBeforeContext: 70,
      canonicalRunSelection: selection([17, 17, 17, 17, 17, 17, 17, 17]),
      seasonContextRevision: policy,
      regionalDistribution: usDist,
      seasonScoringSpec: null,
    });
    expect(eu.key.appliedAnchorPercentileBps).toBe(9000);
    expect(us.key.appliedAnchorPercentileBps).toBe(9000);
    expect(eu.key.factor).toBe(1.1);
    expect(us.key.factor).toBe(1.1);
    expect(eu.key.appliedAnchorKeyThreshold).toBe(18);
    expect(us.key.appliedAnchorKeyThreshold).toBe(17);
  });

  it("C: missing US snapshot is UNKNOWN ×1 and does not use EU", () => {
    const us = applyScoreContext({
      seasonId: "us-s17",
      rawScoreBeforeContext: 70,
      canonicalRunSelection: selection([18, 18, 18, 18, 18, 18, 18, 18]),
      seasonContextRevision: policy,
      regionalDistribution: null,
      regionalDistributionMissing: true,
      seasonScoringSpec: null,
    });
    expect(us.key.factor).toBe(1);
    expect(us.key.status).toBe("UNKNOWN");
    expect(us.key.reason).toBe("REGIONAL_DISTRIBUTION_MISSING");
    expect(us.key.appliedAnchorKeyThreshold).toBeNull();
  });

  it("D: different regional thresholds at the same percentile keep the same factor", () => {
    const eu = applyScoreContext({
      seasonId: "eu-s17",
      rawScoreBeforeContext: 70,
      canonicalRunSelection: selection([18, 18, 18, 18, 18, 18, 18, 18]),
      seasonContextRevision: policy,
      regionalDistribution: euDist,
      seasonScoringSpec: null,
    });
    const us = applyScoreContext({
      seasonId: "us-s17",
      rawScoreBeforeContext: 70,
      canonicalRunSelection: selection([17, 17, 17, 17, 17, 17, 17, 17]),
      seasonContextRevision: policy,
      regionalDistribution: usDist,
      seasonScoringSpec: null,
    });
    expect(eu.key.factor).toBe(us.key.factor);
  });

  it("M: applied context pins policy revision id and regional snapshot id", () => {
    const applied = applyScoreContext({
      seasonId: "eu-s17",
      rawScoreBeforeContext: 70,
      canonicalRunSelection: selection([18, 18, 18, 18, 18, 18, 18, 18]),
      seasonContextRevision: policy,
      regionalDistribution: euDist,
      seasonScoringSpec: null,
    });
    expect(applied.contextRevisionId).toBe(policy.id);
    expect(applied.distributionSnapshotId).toBe("snap-eu");
    expect(applied.key.distributionSnapshotId).toBe("snap-eu");
  });
});

