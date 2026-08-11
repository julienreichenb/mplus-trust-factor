import { describe, expect, it } from "vitest";
import type { RegionCode } from "@mplus/contracts";
import {
  buildSeasonPopulationPolicy,
  computeHistoricalStanding,
  SEASON_POPULATION_POLICY_VERSION,
  type NativeCutoffBand,
  type SeasonPopulationPolicy,
} from "../../index.js";

function completePolicy(
  seasonSlug: string,
  region: RegionCode,
  scores: { p999: number; p990: number; p900: number; p750: number; p600: number },
): SeasonPopulationPolicy {
  const built = buildSeasonPopulationPolicy(
    {
      region,
      seasonSlug,
      sourceUpdatedAt: null,
      top0_1Percent: { score: scores.p999, quantilePopulationCount: null, totalPopulationCount: null },
      top1Percent: { score: scores.p990, quantilePopulationCount: null, totalPopulationCount: null },
      top10Percent: { score: scores.p900, quantilePopulationCount: null, totalPopulationCount: null },
      top25Percent: { score: scores.p750, quantilePopulationCount: null, totalPopulationCount: null },
      top40Percent: { score: scores.p600, quantilePopulationCount: null, totalPopulationCount: null },
    },
    { region, seasonSlug },
  );
  if (!built.ok) throw new Error(built.reason);
  expect(built.policy.quality).toBe("COMPLETE");
  return built.policy;
}

const EU_TWW3 = completePolicy("season-tww-3", "EU", {
  p999: 3946.97,
  p990: 3602.13,
  p900: 3114.82,
  p750: 2876.44,
  p600: 2558.75,
});

describe("computeHistoricalStanding", () => {
  it("maps exact native-band boundaries (equality → stronger band)", () => {
    const cases: Array<{ rating: number; band: NativeCutoffBand; score: number }> = [
      { rating: 3946.97, band: "p999", score: 100 },
      { rating: 3602.13, band: "p990", score: 90 },
      { rating: 3114.82, band: "p900", score: 75 },
      { rating: 2876.44, band: "p750", score: 60 },
      { rating: 2558.75, band: "p600", score: 45 },
      { rating: 2558.74, band: "below_p600", score: 25 },
    ];
    for (const c of cases) {
      const result = computeHistoricalStanding({
        ratings: [
          {
            seasonId: "s15",
            seasonSlug: "blizzard-season-15",
            blizzardSeasonId: 15,
            rating: c.rating,
            state: "HAS_VALUE",
            source: "BLIZZARD",
          },
        ],
        policyBySeasonId: new Map([["s15", EU_TWW3]]),
        regionCode: "EU",
      });
      expect(result.historicalStandingScore).toBe(c.score);
      expect(result.winning?.nativeBand).toBe(c.band);
    }
  });

  it("does not interpolate between bands", () => {
    // Halfway between p990 (3602) and p900 (3114) → still p900 / 75, not a lerp.
    const mid = (3602.13 + 3114.82) / 2;
    const result = computeHistoricalStanding({
      ratings: [
        {
          seasonId: "s15",
          seasonSlug: "blizzard-season-15",
          blizzardSeasonId: 15,
          rating: mid,
          state: "HAS_VALUE",
          source: "BLIZZARD",
        },
      ],
      policyBySeasonId: new Map([["s15", EU_TWW3]]),
      regionCode: "EU",
    });
    expect(result.historicalStandingScore).toBe(75);
    expect(result.winning?.nativeBand).toBe("p900");
  });

  it("takes MAX across seasons; weak seasons do not reduce", () => {
    const df4 = completePolicy("season-df-4", "EU", {
      p999: 4000,
      p990: 3500,
      p900: 3000,
      p750: 2700,
      p600: 2400,
    });
    const result = computeHistoricalStanding({
      ratings: [
        {
          seasonId: "s11",
          seasonSlug: "blizzard-season-11",
          blizzardSeasonId: 11,
          rating: 2720,
          state: "HAS_VALUE",
          source: "BLIZZARD",
        },
        {
          seasonId: "s13",
          seasonSlug: "blizzard-season-13",
          blizzardSeasonId: 13,
          rating: 3286,
          state: "HAS_VALUE",
          source: "BLIZZARD",
        },
        {
          seasonId: "s14",
          seasonSlug: "blizzard-season-14",
          blizzardSeasonId: 14,
          rating: 3726,
          state: "HAS_VALUE",
          source: "BLIZZARD",
        },
        {
          seasonId: "s15",
          seasonSlug: "blizzard-season-15",
          blizzardSeasonId: 15,
          rating: 2000,
          state: "HAS_VALUE",
          source: "BLIZZARD",
        },
      ],
      policyBySeasonId: new Map([
        ["s11", df4],
        ["s13", EU_TWW3],
        ["s14", EU_TWW3],
        ["s15", EU_TWW3],
      ]),
      regionCode: "EU",
    });
    // 2720→p750=60 on df4; 3286→p900=75; 3726→p990=90; 2000→below=25
    expect(result.proofs.map((p) => p.standingScore).sort((a, b) => a - b)).toEqual([
      25, 60, 75, 90,
    ]);
    expect(result.historicalStandingScore).toBe(90);
    expect(result.winning?.blizzardSeasonId).toBe(14);
  });

  it("keeps unsupported seasons uncontextualized without scoring them", () => {
    const result = computeHistoricalStanding({
      ratings: [
        {
          seasonId: "s9",
          seasonSlug: "blizzard-season-9",
          blizzardSeasonId: 9,
          rating: 3144,
          state: "HAS_VALUE",
          source: "BLIZZARD",
        },
        {
          seasonId: "s15",
          seasonSlug: "blizzard-season-15",
          blizzardSeasonId: 15,
          rating: 3862,
          state: "HAS_VALUE",
          source: "BLIZZARD",
        },
      ],
      policyBySeasonId: new Map([
        ["s9", null],
        ["s15", EU_TWW3],
      ]),
      regionCode: "EU",
    });
    expect(result.uncontextualized).toHaveLength(1);
    expect(result.uncontextualized[0]!.blizzardSeasonId).toBe(9);
    expect(result.uncontextualized[0]!.reason).toBe("MISSING_POPULATION_POLICY");
    expect(result.historicalStandingScore).toBe(90);
    expect(result.winning?.blizzardSeasonId).toBe(15);
  });

  it("rejects wrong-region policy contamination", () => {
    const usPolicy = completePolicy("season-tww-3", "US", {
      p999: 100,
      p990: 90,
      p900: 80,
      p750: 70,
      p600: 60,
    });
    const result = computeHistoricalStanding({
      ratings: [
        {
          seasonId: "s15",
          seasonSlug: "blizzard-season-15",
          blizzardSeasonId: 15,
          rating: 3862,
          state: "HAS_VALUE",
          source: "BLIZZARD",
        },
      ],
      policyBySeasonId: new Map([["s15", usPolicy]]),
      regionCode: "EU",
    });
    expect(result.historicalStandingScore).toBeNull();
    expect(result.uncontextualized[0]!.reason).toBe("REGION_MISMATCH");
  });

  it("CONFIRMED_NO_ACTIVITY alone → no historical standing score (not global E0)", () => {
    const empty = computeHistoricalStanding({
      ratings: [],
      policyBySeasonId: new Map(),
      regionCode: "EU",
    });
    expect(empty.historicalStandingScore).toBeNull();
    expect(empty.confirmedNoActivityOnly).toBe(false);

    const absent = computeHistoricalStanding({
      ratings: [
        {
          seasonId: "s12",
          seasonSlug: "blizzard-season-12",
          blizzardSeasonId: 12,
          rating: null,
          state: "CONFIRMED_NO_ACTIVITY",
          source: "BLIZZARD",
        },
      ],
      policyBySeasonId: new Map(),
      regionCode: "EU",
    });
    // Diagnostic flag only — callers must not map this to CONFIRMED_NO_ACTIVITY → E0.
    expect(absent.confirmedNoActivityOnly).toBe(true);
    expect(absent.historicalStandingScore).toBeNull();
    expect(absent.proofs).toHaveLength(0);
    expect(absent.winning).toBeNull();
    expect(absent.uncontextualized).toHaveLength(0);
  });

  it("exposes policy version on proofs", () => {
    const result = computeHistoricalStanding({
      ratings: [
        {
          seasonId: "s15",
          seasonSlug: "blizzard-season-15",
          blizzardSeasonId: 15,
          rating: 3862,
          state: "HAS_VALUE",
          source: "BLIZZARD",
        },
      ],
      policyBySeasonId: new Map([["s15", EU_TWW3]]),
      regionCode: "EU",
    });
    expect(result.winning?.populationPolicyVersion).toBe(SEASON_POPULATION_POLICY_VERSION);
  });
});
