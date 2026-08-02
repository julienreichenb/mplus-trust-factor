import { describe, expect, it } from "vitest";
import { dimensionComputationContentMatches } from "./evidence-repository.js";

describe("dimensionComputationContentMatches", () => {
  const baseIncoming = {
    characterId: "c1",
    seasonId: "s1",
    manifestId: "m1",
    scoreModelId: "model1",
    dimension: "PERFORMANCE" as const,
    algorithmVersion: "algo-1",
    inputFingerprint: "fp-1",
    score: 70,
    confidence: 0.8,
    state: "SHADOW",
    metrics: { availabilityState: "AVAILABLE", publicationBlocked: true },
    explanation: { note: "a" },
    computedAt: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("matches identical content", () => {
    expect(
      dimensionComputationContentMatches(
        {
          algorithmVersion: "algo-1",
          score: 70 as unknown as never,
          confidence: 0.8 as unknown as never,
          state: "SHADOW",
          metrics: { availabilityState: "AVAILABLE", publicationBlocked: true },
          explanation: { note: "a" },
        },
        baseIncoming,
      ),
    ).toBe(true);
  });

  it("detects score conflict", () => {
    expect(
      dimensionComputationContentMatches(
        {
          algorithmVersion: "algo-1",
          score: 71 as unknown as never,
          confidence: 0.8 as unknown as never,
          state: "SHADOW",
          metrics: { availabilityState: "AVAILABLE", publicationBlocked: true },
          explanation: { note: "a" },
        },
        baseIncoming,
      ),
    ).toBe(false);
  });

  it("detects metrics conflict", () => {
    expect(
      dimensionComputationContentMatches(
        {
          algorithmVersion: "algo-1",
          score: 70 as unknown as never,
          confidence: 0.8 as unknown as never,
          state: "SHADOW",
          metrics: { availabilityState: "PARTIAL", publicationBlocked: true },
          explanation: { note: "a" },
        },
        baseIncoming,
      ),
    ).toBe(false);
  });
});
