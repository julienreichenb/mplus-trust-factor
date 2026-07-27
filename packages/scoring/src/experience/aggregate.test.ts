import { describe, expect, it } from "vitest";
import {
  AGE_DECAY_FLOOR,
  applyAgeDecay,
  computeBreadthWithDiminishingReturns,
  computeCurrentPeak,
  computeExperienceDimension,
  computeHistoricalPeak,
  computeLongevityScore,
  EXPERIENCE_CURRENT_BREADTH_WEIGHT,
  EXPERIENCE_CURRENT_PEAK_WEIGHT,
  EXPERIENCE_HISTORICAL_PEAK_WEIGHT,
  EXPERIENCE_LONGEVITY_WEIGHT,
  EXPERIENCE_V3_METRIC_KEYS,
  normalizeScoreAgainstTop25Cutoff,
  resolveExperienceV3MetricWeights,
} from "./aggregate.js";
import type { ExperienceCharacterHistory, ExperienceSeasonFact } from "./types.js";

function season(
  overrides: Partial<ExperienceSeasonFact> & Pick<ExperienceSeasonFact, "seasonSlug" | "seasonsAgo">,
): ExperienceSeasonFact {
  return {
    rawScore: 2500,
    seasonNormalizedScore: 70,
    dungeonCount: 8,
    active: true,
    sourceProvider: "raiderio",
    ...overrides,
  };
}

/** Wallidrixe-shaped public character history (no account auth). */
const WALLIDRIXE_PUBLIC: ExperienceCharacterHistory = {
  characterKey: "eu/archimonde/wallidrixe",
  displayName: "Wallidrixe",
  verified: false,
  seasons: [
    season({
      seasonSlug: "season-mn-1",
      seasonsAgo: 0,
      rawScore: 2845,
      seasonNormalizedScore: 78,
      dungeonCount: 8,
    }),
    season({
      seasonSlug: "season-tww-3",
      seasonsAgo: 1,
      rawScore: 3100,
      seasonNormalizedScore: 82,
      dungeonCount: 8,
    }),
    season({
      seasonSlug: "season-tww-1",
      seasonsAgo: 3,
      rawScore: 2900,
      seasonNormalizedScore: 88,
      dungeonCount: 6,
    }),
  ],
};

describe("Experience v3 season normalization", () => {
  it("never treats raw scores from different seasons as comparable without normalization", () => {
    const legionRaw = 150; // era-incompatible raw
    const modernRaw = 2845;
    expect(legionRaw).toBeLessThan(modernRaw);
    // Without seasonNormalizedScore both are omitted from peak math.
    const { score } = computeHistoricalPeak([
      season({
        seasonSlug: "season-legion",
        seasonsAgo: 20,
        rawScore: legionRaw,
        seasonNormalizedScore: null,
      }),
      season({
        seasonSlug: "season-mn-1",
        seasonsAgo: 1,
        rawScore: modernRaw,
        seasonNormalizedScore: null,
      }),
    ]);
    expect(score).toBeNull();
  });

  it("normalizes against top-25% cutoff into a 0–100 season-local scale", () => {
    const normalized = normalizeScoreAgainstTop25Cutoff(2700, 2700);
    expect(normalized).toBeCloseTo(75, 5);
    expect(normalizeScoreAgainstTop25Cutoff(0, 2700)).toBe(0);
    expect(normalizeScoreAgainstTop25Cutoff(2700, 0)).toBeNull();
  });
});

describe("Experience v3 age decay", () => {
  it("applies decay but never below the exceptional floor multiplier", () => {
    const fresh = applyAgeDecay(100, 0);
    expect(fresh).toBe(100);
    const oneAgo = applyAgeDecay(100, 1);
    expect(oneAgo).toBeCloseTo(85, 5);
    const veryOld = applyAgeDecay(100, 20);
    expect(veryOld).toBeCloseTo(100 * AGE_DECAY_FLOOR, 5);
    expect(veryOld).toBeGreaterThan(0);
  });
});

describe("Experience v3 breadth and longevity", () => {
  it("applies diminishing returns so the 8th dungeon adds less than the 1st", () => {
    const one = computeBreadthWithDiminishingReturns(1, 8)!;
    const two = computeBreadthWithDiminishingReturns(2, 8)!;
    const eight = computeBreadthWithDiminishingReturns(8, 8)!;
    expect(two - one).toBeLessThan(one);
    expect(eight).toBeCloseTo(100, 5);
    expect(computeBreadthWithDiminishingReturns(0, 8)).toBeNull();
  });

  it("maps active season count toward a longevity target", () => {
    expect(computeLongevityScore(3, 6)).toBeCloseTo(50, 5);
    expect(computeLongevityScore(6, 6)).toBeCloseTo(100, 5);
    expect(computeLongevityScore(0, 6)).toBeNull();
  });
});

describe("Experience v3 public CHARACTER_HISTORY (Wallidrixe)", () => {
  it("scores public character history without inventing alts", () => {
    const result = computeExperienceDimension({
      characters: [WALLIDRIXE_PUBLIC],
      expectedDungeonCount: 8,
      accountLinkageVerified: false,
    });

    expect(result.summary.mode).toBe("CHARACTER_HISTORY");
    expect(result.summary.label).toBe("CHARACTER_HISTORY");
    expect(result.summary.accountGraph.availability).toBe("BLOCKED");
    expect(result.summary.missingMetrics).toContain("account_linked_alts");
    expect(result.observations.currentPeak).toBe(78);
    expect(result.observations.currentBreadth).toBeCloseTo(100, 5);
    expect(result.observations.historicalPeak).not.toBeNull();
    expect(result.observations.longevity).toBeCloseTo(50, 5); // 3/6 seasons
    expect(result.experienceScore).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("does not lower the score because the alt graph is missing", () => {
    const withBlockedAlts = computeExperienceDimension({
      characters: [WALLIDRIXE_PUBLIC],
      expectedDungeonCount: 8,
      accountLinkageVerified: false,
    });
    // Same inputs but pretend linkage flag flipped without verified characters —
    // still CHARACTER_HISTORY; score must match.
    const stillPublic = computeExperienceDimension({
      characters: [WALLIDRIXE_PUBLIC],
      expectedDungeonCount: 8,
      accountLinkageVerified: true, // no verified:true characters → stays public
    });
    expect(stillPublic.summary.mode).toBe("CHARACTER_HISTORY");
    expect(stillPublic.experienceScore).toBe(withBlockedAlts.experienceScore);
    expect(withBlockedAlts.summary.accountGraph.availability).toBe("BLOCKED");
  });

  it("renormalizes weights when historical seasons are unavailable", () => {
    const currentOnly: ExperienceCharacterHistory = {
      ...WALLIDRIXE_PUBLIC,
      seasons: [WALLIDRIXE_PUBLIC.seasons[0]!],
    };
    const result = computeExperienceDimension({
      characters: [currentOnly],
      expectedDungeonCount: 8,
      accountLinkageVerified: false,
    });
    expect(result.observations.historicalPeak).toBeNull();
    expect(result.summary.missingMetrics).toContain("experience.historical_peak");
    const w = result.effectiveWeights;
    expect(w.historicalPeak).toBe(0);
    expect(w.currentPeak + w.currentBreadth + w.longevity).toBeCloseTo(1, 5);
  });
});

describe("Experience v3 VERIFIED_ACCOUNT_HISTORY", () => {
  it("aggregates peak across explicitly verified characters only", () => {
    const main: ExperienceCharacterHistory = {
      characterKey: "eu/archimonde/main",
      displayName: "Main",
      verified: true,
      seasons: [
        season({
          seasonSlug: "season-mn-1",
          seasonsAgo: 0,
          seasonNormalizedScore: 70,
          dungeonCount: 5,
        }),
      ],
    };
    const alt: ExperienceCharacterHistory = {
      characterKey: "eu/archimonde/alt",
      displayName: "Alt",
      verified: true,
      seasons: [
        season({
          seasonSlug: "season-mn-1",
          seasonsAgo: 0,
          seasonNormalizedScore: 92,
          dungeonCount: 8,
        }),
        season({
          seasonSlug: "season-tww-2",
          seasonsAgo: 2,
          seasonNormalizedScore: 95,
          dungeonCount: 8,
        }),
      ],
    };
    // Unverified roster mate must be ignored.
    const inferred: ExperienceCharacterHistory = {
      characterKey: "eu/archimonde/guildmate",
      displayName: "Guildmate",
      verified: false,
      seasons: [
        season({
          seasonSlug: "season-mn-1",
          seasonsAgo: 0,
          seasonNormalizedScore: 99,
          dungeonCount: 8,
        }),
      ],
    };

    const result = computeExperienceDimension({
      characters: [main, alt, inferred],
      expectedDungeonCount: 8,
      accountLinkageVerified: true,
      linkageSource: "BLIZZARD_OAUTH",
    });

    expect(result.summary.mode).toBe("VERIFIED_ACCOUNT_HISTORY");
    expect(result.summary.label).toBe("VERIFIED_ACCOUNT_HISTORY");
    expect(result.summary.linkageSource).toBe("BLIZZARD_OAUTH");
    expect(result.summary.accountGraph.availability).toBe("AVAILABLE");
    expect(result.summary.accountGraph.verifiedCharacterCount).toBe(2);
    expect(result.observations.currentPeak).toBe(92);
    expect(computeCurrentPeak(alt.seasons.filter((s) => s.seasonsAgo === 0))).toBe(92);
    expect(result.summary.missingMetrics).not.toContain("account_linked_alts");
    expect(JSON.stringify(result.summary.seasonsUsed)).not.toContain("guildmate");
  });
});

describe("Experience v3 Agent 27 model keys", () => {
  it("exports baseline weights summing to 1.0 for default@3 handoff", () => {
    const weights = resolveExperienceV3MetricWeights();
    expect(weights).toEqual([
      { metricKey: EXPERIENCE_V3_METRIC_KEYS.currentPeak, weight: EXPERIENCE_CURRENT_PEAK_WEIGHT },
      {
        metricKey: EXPERIENCE_V3_METRIC_KEYS.currentBreadth,
        weight: EXPERIENCE_CURRENT_BREADTH_WEIGHT,
      },
      {
        metricKey: EXPERIENCE_V3_METRIC_KEYS.historicalPeak,
        weight: EXPERIENCE_HISTORICAL_PEAK_WEIGHT,
      },
      { metricKey: EXPERIENCE_V3_METRIC_KEYS.longevity, weight: EXPERIENCE_LONGEVITY_WEIGHT },
    ]);
    const sum = weights.reduce((s, w) => s + w.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});
