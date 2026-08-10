import { describe, expect, it } from "vitest";
import type { NativeCutoffBand, PreviousSeasonRelativeStanding } from "./season-population-policy.js";
import { NATIVE_BAND_STANDING_SCORES, SEASON_POPULATION_POLICY_VERSION } from "./season-population-policy.js";
import {
  calculateExperiencePhase1,
  EXPERIENCE_PHASE1_BELOW_TOP40_SCORE,
  EXPERIENCE_PHASE1_ELITE_FLOOR,
  scorePreviousSeasonStanding,
  scoreRegionalClassRankFloor,
  usablePreviousRegionalClassRank,
} from "./calculate.js";

function standing(
  partial: Partial<PreviousSeasonRelativeStanding> & {
    nativeBand: NativeCutoffBand;
    standingScore: number;
  },
): PreviousSeasonRelativeStanding {
  return {
    rating: 3000,
    betterAnchor: null,
    worseAnchor: null,
    thresholdsUsed: [],
    estimatedTopPercent: null,
    method: "NATIVE_BAND",
    band:
      partial.nativeBand === "p999"
        ? "TOP_0_1_OR_BETTER"
        : partial.nativeBand === "p990"
          ? "TOP_1"
          : partial.nativeBand === "p900"
            ? "TOP_10"
            : partial.nativeBand === "p750"
              ? "TOP_25"
              : partial.nativeBand === "p600"
                ? "TOP_40"
                : "BELOW_TOP_40",
    policyVersion: SEASON_POPULATION_POLICY_VERSION,
    region: "EU",
    seasonSlug: "season-tww-3",
    ...partial,
  };
}

function bandStanding(nativeBand: NativeCutoffBand): PreviousSeasonRelativeStanding {
  return standing({
    nativeBand,
    standingScore: NATIVE_BAND_STANDING_SCORES[nativeBand],
  });
}

describe("scorePreviousSeasonStanding", () => {
  it("uses discrete native standingScore", () => {
    expect(scorePreviousSeasonStanding(bandStanding("p900"))).toBe(75);
    expect(scorePreviousSeasonStanding(bandStanding("below_p600"))).toBe(
      EXPERIENCE_PHASE1_BELOW_TOP40_SCORE,
    );
  });
});

describe("scoreRegionalClassRankFloor", () => {
  it("maps each rank threshold", () => {
    expect(scoreRegionalClassRankFloor(1)).toBe(100);
    expect(scoreRegionalClassRankFloor(5)).toBe(100);
    expect(scoreRegionalClassRankFloor(6)).toBe(97);
    expect(scoreRegionalClassRankFloor(10)).toBe(97);
    expect(scoreRegionalClassRankFloor(11)).toBe(94);
    expect(scoreRegionalClassRankFloor(20)).toBe(94);
    expect(scoreRegionalClassRankFloor(21)).toBe(90);
    expect(scoreRegionalClassRankFloor(50)).toBe(90);
    expect(scoreRegionalClassRankFloor(51)).toBe(85);
    expect(scoreRegionalClassRankFloor(87)).toBe(85);
    expect(scoreRegionalClassRankFloor(100)).toBe(85);
  });

  it("gives no floor for rank > 100 or missing", () => {
    expect(scoreRegionalClassRankFloor(101)).toBeNull();
    expect(scoreRegionalClassRankFloor(503)).toBeNull();
    expect(scoreRegionalClassRankFloor(null)).toBeNull();
    expect(scoreRegionalClassRankFloor(undefined)).toBeNull();
    expect(scoreRegionalClassRankFloor(0)).toBeNull();
    expect(scoreRegionalClassRankFloor(-1)).toBeNull();
  });
});

describe("usablePreviousRegionalClassRank", () => {
  it("reads classRank.region and ignores overall region", () => {
    expect(
      usablePreviousRegionalClassRank({
        classRank: { region: 18 },
        region: 5607,
      }),
    ).toBe(18);
    expect(
      usablePreviousRegionalClassRank({
        classRank: { region: null },
        region: 12,
      }),
    ).toBeNull();
    expect(usablePreviousRegionalClassRank({ region: 12 })).toBeNull();
    expect(
      usablePreviousRegionalClassRank({
        classRank: { region: 0 },
        region: 0,
      }),
    ).toBeNull();
  });
});

describe("calculateExperiencePhase1 — composition (E)", () => {
  it("scores exact native standing bands", () => {
    const cases: NativeCutoffBand[] = ["p999", "p990", "p900", "p750", "p600", "below_p600"];
    for (const nativeBand of cases) {
      const result = calculateExperiencePhase1({
        previous: { state: "STANDING", standing: bandStanding(nativeBand) },
        elite: { confirmedCount: 0 },
      });
      expect(result.available).toBe(true);
      expect(result.score).toBe(NATIVE_BAND_STANDING_SCORES[nativeBand]);
      expect(result.previousStandingScore).toBe(NATIVE_BAND_STANDING_SCORES[nativeBand]);
      expect(result.confidence).toBe(1);
    }
  });

  it("standing only", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("p900") },
      elite: { confirmedCount: 0 },
    });
    expect(result.score).toBe(75);
    expect(result.classRankFloor).toBeNull();
    expect(result.eliteFloorApplied).toBe(false);
  });

  it("class-rank floor alone when previous unavailable", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "UNAVAILABLE", reason: "PROVIDER_FAILURE" },
      elite: { confirmedCount: 0 },
      previousRegionalClassRank: 18,
    });
    expect(result).toMatchObject({
      score: 94,
      available: true,
      previousStandingScore: null,
      classRankFloor: 94,
      classRankFloorApplied: true,
    });
  });

  it("elite floor", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("below_p600") },
      elite: { confirmedCount: 1 },
    });
    expect(result.score).toBe(EXPERIENCE_PHASE1_ELITE_FLOOR);
    expect(result.eliteFloorApplied).toBe(true);
    expect(result.previousStandingScore).toBe(25);
  });

  it("max of standing / class-rank / elite proofs", () => {
    expect(
      calculateExperiencePhase1({
        previous: { state: "STANDING", standing: bandStanding("p900") },
        elite: { confirmedCount: 0 },
        previousRegionalClassRank: 87,
      }).score,
    ).toBe(85);

    expect(
      calculateExperiencePhase1({
        previous: { state: "STANDING", standing: bandStanding("p750") },
        elite: { confirmedCount: 0 },
        previousRegionalClassRank: 18,
      }).score,
    ).toBe(94);

    expect(
      calculateExperiencePhase1({
        previous: { state: "STANDING", standing: bandStanding("p750") },
        elite: { confirmedCount: 0 },
        previousRegionalClassRank: 7,
      }).score,
    ).toBe(97);

    const top = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("p999") },
      elite: { confirmedCount: 1 },
      previousRegionalClassRank: 3,
    });
    expect(top.score).toBe(100);
    expect(top.classRankFloorApplied).toBe(false);
    expect(top.eliteFloorApplied).toBe(false);
  });

  it("no activity = 0", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "CONFIRMED_NO_ACTIVITY" },
      elite: { confirmedCount: 0 },
    });
    expect(result).toMatchObject({
      score: 0,
      available: true,
      confidence: 1,
      previousStandingScore: 0,
    });
  });

  it("previous unavailable + elite >= applicable floor", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "UNAVAILABLE", reason: "PROVIDER_FAILURE" },
      elite: { confirmedCount: 2 },
    });
    expect(result.score).toBe(90);
    expect(result.previousStandingScore).toBeNull();
    expect(result.eliteFloorApplied).toBe(true);
  });

  it("elite failure with known score >=90 remains available", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("p999") },
      elite: { state: "UNAVAILABLE", reason: "achievements down" },
    });
    expect(result).toMatchObject({
      score: 100,
      available: true,
      reason: null,
    });
  });

  it("does not reduce a score already above the elite floor", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("p999") },
      elite: { confirmedCount: 1 },
    });
    expect(result.score).toBe(100);
    expect(result.eliteFloorApplied).toBe(false);
  });

  it("treats old and recent elite titles identically", () => {
    const basePrevious = {
      state: "STANDING" as const,
      standing: bandStanding("p600"),
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
      previous: { state: "STANDING", standing: bandStanding("below_p600") },
      elite: { confirmedCount: 1 },
    });
    const many = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("below_p600") },
      elite: { confirmedCount: 5 },
    });
    expect(one.score).toBe(90);
    expect(many.score).toBe(90);
    expect(many.confirmedEliteTitleCount).toBe(5);
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

  it("marks provider previous evidence without elite as unavailable", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "UNAVAILABLE", reason: "PROVIDER_FAILURE" },
      elite: { confirmedCount: 0 },
    });
    expect(result).toEqual({
      score: null,
      available: false,
      confidence: null,
      confidenceCauses: ["historical_evidence_unavailable"],
      historicalStandingScore: null,
      previousStandingScore: null,
      classRankFloor: null,
      classRankFloorApplied: false,
      previousRegionalClassRank: null,
      eliteFloorApplied: false,
      confirmedEliteTitleCount: 0,
      reason: "HISTORICAL_EVIDENCE_UNAVAILABLE",
      winningHistoricalProof: null,
      contextualizedHistoricalSeasonCount: 0,
    });
  });

  it("marks MISSING_POPULATION_POLICY previous evidence as unavailable (never E=0)", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "UNAVAILABLE", reason: "MISSING_POPULATION_POLICY" },
      elite: { confirmedCount: 0 },
    });
    expect(result.score).toBeNull();
    expect(result.available).toBe(false);
    expect(result.reason).toBe("HISTORICAL_EVIDENCE_UNAVAILABLE");
    expect(result.confidenceCauses).toContain("historical_evidence_unavailable");
  });

  it("confirmed no activity remains score 0 with available=true (distinct from unavailable)", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "CONFIRMED_NO_ACTIVITY" },
      elite: { confirmedCount: 0 },
    });
    expect(result.score).toBe(0);
    expect(result.available).toBe(true);
    expect(result.reason).not.toBe("PREVIOUS_EVIDENCE_UNAVAILABLE");
  });

  it("stronger previous standing wins over class-rank floor", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("p999") },
      elite: { confirmedCount: 0 },
      previousRegionalClassRank: 50,
    });
    expect(result.score).toBe(100);
    expect(result.classRankFloor).toBe(90);
    expect(result.classRankFloorApplied).toBe(false);
  });

  it("elite floor and class-rank floor interact via max", () => {
    const eliteWins = calculateExperiencePhase1({
      previous: { state: "UNAVAILABLE" },
      elite: { confirmedCount: 1 },
      previousRegionalClassRank: 87,
    });
    expect(eliteWins.score).toBe(90);
    expect(eliteWins.classRankFloor).toBe(85);
    expect(eliteWins.eliteFloorApplied).toBe(true);

    const classWins = calculateExperiencePhase1({
      previous: { state: "UNAVAILABLE" },
      elite: { confirmedCount: 1 },
      previousRegionalClassRank: 7,
    });
    expect(classWins.score).toBe(97);
    expect(classWins.classRankFloorApplied).toBe(true);
    expect(classWins.eliteFloorApplied).toBe(false);
  });

  it("rank >100 gives no class-rank floor", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("p900") },
      elite: { confirmedCount: 0 },
      previousRegionalClassRank: 503,
    });
    expect(result.classRankFloor).toBeNull();
    expect(result.score).toBe(75);
  });
});

describe("Experience availability semantics", () => {
  it("confirmed no previous activity + no rank + no elite → available score 0", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "CONFIRMED_NO_ACTIVITY" },
      elite: { state: "OK", confirmedCount: 0 },
    });
    expect(result).toMatchObject({
      score: 0,
      available: true,
      previousStandingScore: 0,
      classRankFloor: null,
      eliteFloorApplied: false,
      reason: null,
    });
  });

  it("successful previous evidence below p600 → available score 25", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("below_p600") },
      elite: { state: "OK", confirmedCount: 0 },
    });
    expect(result).toMatchObject({
      score: 25,
      available: true,
      previousStandingScore: 25,
    });
  });

  it("missing class rank does not make Experience unavailable", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("p750") },
      elite: { state: "OK", confirmedCount: 0 },
    });
    expect(result.available).toBe(true);
    expect(result.score).toBe(60);
    expect(result.classRankFloor).toBeNull();
  });

  it("provider failure remains unavailable (not zero or 25)", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "UNAVAILABLE", reason: "PROVIDER_FAILURE" },
      elite: { state: "OK", confirmedCount: 0 },
    });
    expect(result).toMatchObject({
      score: null,
      available: false,
      reason: "HISTORICAL_EVIDENCE_UNAVAILABLE",
    });
  });

  it("achievements failure remains unavailable when elite could change the score", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "STANDING", standing: bandStanding("p900") },
      elite: { state: "UNAVAILABLE", reason: "achievements down" },
    });
    expect(result).toMatchObject({
      score: null,
      available: false,
      reason: "ELITE_EVIDENCE_UNAVAILABLE",
      previousStandingScore: 75,
    });
  });

  it("confirmed no activity + achievements failure is unavailable", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "CONFIRMED_NO_ACTIVITY" },
      elite: { state: "UNAVAILABLE", reason: "achievements down" },
    });
    expect(result).toMatchObject({
      score: null,
      available: false,
      reason: "ELITE_EVIDENCE_UNAVAILABLE",
      previousStandingScore: 0,
    });
  });
});
