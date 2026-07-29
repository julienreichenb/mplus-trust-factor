import { describe, expect, it } from "vitest";
import {
  effectiveEventsPerHour,
  interpolateDomainCurve,
  redistributeBehaviorWeights,
  semanticBandForScore,
} from "./utility-v3-scoring-logic.js";
import { UTILITY_V3_SIMULATION_CONFIG } from "./utility-v3-config.js";

describe("utility-v3-scoring", () => {
  it("maps high cast-stop rate to 90+ domain score", () => {
    const rate = effectiveEventsPerHour(
      { CONFIRMED_IMPACT: 248, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
      8.62,
    );
    expect(rate).toBeGreaterThan(20);
    const score = interpolateDomainCurve(rate, "castStops");
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it("excludes NOT_OBSERVABLE domains from weight redistribution pool", () => {
    const weights = redistributeBehaviorWeights(UTILITY_V3_SIMULATION_CONFIG.domainWeights, {
      castStops: "SCORED",
      casterControl: "NOT_OBSERVABLE",
      strategicCc: "NO_CONFIRMED_CONTRIBUTION",
      mechanicAvoidance: "SCORED",
      groupMobility: "SCORED",
      support: "SCORED",
    });
    expect(weights.casterControl).toBe(0);
    expect(weights.castStops).toBeGreaterThan(0.25);
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("uses neutral 50 for NO_CONFIRMED_CONTRIBUTION", () => {
    expect(UTILITY_V3_SIMULATION_CONFIG.noConfirmedContributionScore).toBe(50);
  });

  it("assigns semantic bands per documented ranges", () => {
    expect(semanticBandForScore(35)).toBe("confirmed_poor_or_confirmed_misses");
    expect(semanticBandForScore(55)).toBe("limited_confirmed_contribution");
    expect(semanticBandForScore(68)).toBe("regular_useful_contribution");
    expect(semanticBandForScore(80)).toBe("strong_consistent_strategic_contribution");
    expect(semanticBandForScore(95)).toBe("exceptional_broad_confirmed_impact");
  });

  it("domain curves reach 100 not ~68", () => {
    const score = interpolateDomainCurve(24, "castStops");
    expect(score).toBe(100);
  });
});
