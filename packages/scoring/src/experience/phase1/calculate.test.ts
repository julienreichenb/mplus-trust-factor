import { describe, expect, it } from "vitest";
import type { PreviousSeasonRelativeStanding } from "./season-population-policy.js";
import {
  calculateExperiencePhase1,
  EXPERIENCE_PHASE1_BELOW_TOP40_SCORE,
  EXPERIENCE_PHASE1_ELITE_FLOOR,
  scoreFromEstimatedTopPercent,
  scorePreviousSeasonStanding,
} from "./calculate.js";

function standing(
  partial: Partial<PreviousSeasonRelativeStanding> &
    Pick<PreviousSeasonRelativeStanding, "estimatedTopPercent" | "band" | "method">,
): PreviousSeasonRelativeStanding {
  return {
    rating: 3000,
    betterAnchor: null,
    worseAnchor: null,
    policyVersion: "season-population-policy-v1",
    region: "EU",
    seasonSlug: "season-tww-3",
    ...partial,
  };
}

describe("scoreFromEstimatedTopPercent", () => {
  it("maps exact 0.1 / 1 / 10 / 25 / 40 anchors", () => {
    expect(scoreFromEstimatedTopPercent(0.1)).toBe(100);
    expect(scoreFromEstimatedTopPercent(1)).toBe(90);
    expect(scoreFromEstimatedTopPercent(10)).toBe(75);
    expect(scoreFromEstimatedTopPercent(25)).toBe(60);
    expect(scoreFromEstimatedTopPercent(40)).toBe(45);
  });

  it("interpolates between anchors (e.g. top 30% → 55)", () => {
    expect(scoreFromEstimatedTopPercent(30)).toBeCloseTo(55, 10);
    // mid between 1 and 10 → 82.5
    expect(scoreFromEstimatedTopPercent(5.5)).toBeCloseTo(82.5, 10);
  });
});

describe("scorePreviousSeasonStanding", () => {
  it("scores below top40 as 25", () => {
    expect(
      scorePreviousSeasonStanding(
        standing({
          estimatedTopPercent: null,
          band: "BELOW_TOP_40",
          method: "BELOW_SUPPORTED_RANGE",
        }),
      ),
    ).toBe(EXPERIENCE_PHASE1_BELOW_TOP40_SCORE);
  });
});

describe("calculateExperiencePhase1", () => {
  it("scores exact standing anchors", () => {
    const cases: Array<{ topPercent: number; score: number; band: PreviousSeasonRelativeStanding["band"] }> = [
      { topPercent: 0.1, score: 100, band: "TOP_0_1_OR_BETTER" },
      { topPercent: 1, score: 90, band: "TOP_1" },
      { topPercent: 10, score: 75, band: "TOP_10" },
      { topPercent: 25, score: 60, band: "TOP_25" },
      { topPercent: 40, score: 45, band: "TOP_40" },
    ];
    for (const c of cases) {
      const result = calculateExperiencePhase1({
        previous: {
          state: "STANDING",
          standing: standing({
            estimatedTopPercent: c.topPercent,
            band: c.band,
            method: "EXACT_ANCHOR",
          }),
        },
        elite: { confirmedCount: 0 },
      });
      expect(result.available).toBe(true);
      expect(result.score).toBe(c.score);
      expect(result.previousStandingScore).toBe(c.score);
      expect(result.eliteFloorApplied).toBe(false);
    }
  });

  it("interpolates previous standing (top ~30% → ~55)", () => {
    const result = calculateExperiencePhase1({
      previous: {
        state: "STANDING",
        standing: standing({
          estimatedTopPercent: 30,
          band: "TOP_40",
          method: "INTERPOLATED",
        }),
      },
      elite: { confirmedCount: 0 },
    });
    expect(result.score).toBeCloseTo(55, 10);
  });

  it("maps below top40 to 25", () => {
    const result = calculateExperiencePhase1({
      previous: {
        state: "STANDING",
        standing: standing({
          estimatedTopPercent: null,
          band: "BELOW_TOP_40",
          method: "BELOW_SUPPORTED_RANGE",
        }),
      },
      elite: { confirmedCount: 0 },
    });
    expect(result.score).toBe(25);
  });

  it("applies elite floor of 90", () => {
    const result = calculateExperiencePhase1({
      previous: {
        state: "STANDING",
        standing: standing({
          estimatedTopPercent: 30,
          band: "TOP_40",
          method: "INTERPOLATED",
        }),
      },
      elite: { confirmedCount: 1 },
    });
    expect(result.score).toBe(EXPERIENCE_PHASE1_ELITE_FLOOR);
    expect(result.eliteFloorApplied).toBe(true);
    expect(result.previousStandingScore).toBeCloseTo(55, 10);
  });

  it("does not reduce a score already above the elite floor", () => {
    const result = calculateExperiencePhase1({
      previous: {
        state: "STANDING",
        standing: standing({
          estimatedTopPercent: 0.1,
          band: "TOP_0_1_OR_BETTER",
          method: "EXACT_ANCHOR",
        }),
      },
      elite: { confirmedCount: 1 },
    });
    expect(result.score).toBe(100);
    expect(result.eliteFloorApplied).toBe(false);
  });

  it("treats old and recent elite titles identically", () => {
    const basePrevious = {
      state: "STANDING" as const,
      standing: standing({
        estimatedTopPercent: 30,
        band: "TOP_40",
        method: "INTERPOLATED",
      }),
    };
    const old = calculateExperiencePhase1({
      previous: basePrevious,
      elite: {
        catalogVersion: "elite-cutoff-catalog-v1",
        confirmedCount: 1,
        confirmed: [
          {
            achievementId: 16_429,
            seasonSlug: "season-df-1",
            title: "Thundering Hero: Dragonflight Season 1",
            completedAt: "2023-05-01T00:00:00.000Z",
          },
        ],
      },
    });
    const recent = calculateExperiencePhase1({
      previous: basePrevious,
      elite: {
        catalogVersion: "elite-cutoff-catalog-v1",
        confirmedCount: 1,
        confirmed: [
          {
            achievementId: 40_954,
            seasonSlug: "season-tww-2",
            title: "Enterprising Hero: The War Within Season Two",
            completedAt: "2025-08-01T00:00:00.000Z",
          },
        ],
      },
    });
    expect(old.score).toBe(recent.score);
    expect(old.eliteFloorApplied).toBe(recent.eliteFloorApplied);
  });

  it("does not stack multiple elite titles beyond the floor", () => {
    const one = calculateExperiencePhase1({
      previous: {
        state: "STANDING",
        standing: standing({
          estimatedTopPercent: null,
          band: "BELOW_TOP_40",
          method: "BELOW_SUPPORTED_RANGE",
        }),
      },
      elite: { confirmedCount: 1 },
    });
    const many = calculateExperiencePhase1({
      previous: {
        state: "STANDING",
        standing: standing({
          estimatedTopPercent: null,
          band: "BELOW_TOP_40",
          method: "BELOW_SUPPORTED_RANGE",
        }),
      },
      elite: { confirmedCount: 5 },
    });
    expect(one.score).toBe(90);
    expect(many.score).toBe(90);
    expect(many.confirmedEliteTitleCount).toBe(5);
  });

  it("maps confirmed no activity to 0", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "CONFIRMED_NO_ACTIVITY" },
      elite: { confirmedCount: 0 },
    });
    expect(result).toMatchObject({
      score: 0,
      available: true,
      previousStandingScore: 0,
      eliteFloorApplied: false,
    });
  });

  it("maps confirmed no activity + elite to 90", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "CONFIRMED_NO_ACTIVITY" },
      elite: { confirmedCount: 1 },
    });
    expect(result.score).toBe(90);
    expect(result.previousStandingScore).toBe(0);
    expect(result.eliteFloorApplied).toBe(true);
  });

  it("maps missing previous evidence + elite to 90", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "UNAVAILABLE", reason: "PROVIDER_FAILURE" },
      elite: { confirmedCount: 2 },
    });
    expect(result.score).toBe(90);
    expect(result.previousStandingScore).toBeNull();
    expect(result.eliteFloorApplied).toBe(true);
    expect(result.available).toBe(true);
  });

  it("marks provider/unknown previous evidence without elite as unavailable", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "UNAVAILABLE", reason: "PROVIDER_FAILURE" },
      elite: { confirmedCount: 0 },
    });
    expect(result).toEqual({
      score: null,
      available: false,
      previousStandingScore: null,
      eliteFloorApplied: false,
      confirmedEliteTitleCount: 0,
      reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
    });
  });
});
