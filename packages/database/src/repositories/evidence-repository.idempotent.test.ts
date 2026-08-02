import { describe, expect, it } from "vitest";
import {
  buildDimensionComputationConflictError,
  dimensionComputationContentMatches,
  dimensionComputationLogicalIdentityKey,
} from "./evidence-repository.js";

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
          inputFingerprint: "fp-1",
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
          inputFingerprint: "fp-1",
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

  it("detects fingerprint conflict in content matcher", () => {
    expect(
      dimensionComputationContentMatches(
        {
          algorithmVersion: "algo-1",
          inputFingerprint: "fp-other",
          score: 70 as unknown as never,
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
          inputFingerprint: "fp-1",
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

describe("dimensionComputation conflict helpers", () => {
  it("builds logical identity without fingerprint", () => {
    expect(
      dimensionComputationLogicalIdentityKey({
        characterId: "c",
        seasonId: "s",
        manifestId: "m",
        scoreModelId: "model",
        dimension: "UTILITY",
      }),
    ).toBe("c|s|m|model|UTILITY");
  });

  it("exposes structured conflict fields", () => {
    const err = buildDimensionComputationConflictError({
      reason: "fingerprint_mismatch",
      logicalIdentity: "c|s|m|model|PERFORMANCE",
      existingFingerprint: "fp-a",
      requestedFingerprint: "fp-b",
      dimension: "PERFORMANCE",
    });
    expect(err.message).toContain("reason=fingerprint_mismatch");
    expect(err.message).toContain("logicalIdentity=c|s|m|model|PERFORMANCE");
    expect(err.message).toContain("existingFingerprint=fp-a");
    expect(err.message).toContain("requestedFingerprint=fp-b");
  });
});
