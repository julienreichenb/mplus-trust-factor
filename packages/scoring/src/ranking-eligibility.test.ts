import { describe, expect, it } from "vitest";
import { buildRankingEligibility } from "./ranking-eligibility.js";
import type { DimensionScoreDTO } from "@mplus/contracts";

function dim(
  dimension: DimensionScoreDTO["dimension"],
  score: number | null,
  state: DimensionScoreDTO["state"] = score == null ? "UNAVAILABLE" : "AVAILABLE",
): DimensionScoreDTO {
  return {
    dimension,
    score,
    confidence: score == null ? 0 : 0.8,
    weight: 0.25,
    state,
    reason: null,
    contributors: null,
  };
}

describe("buildRankingEligibility", () => {
  it("requires model v6 and eligible Utility", () => {
    const eligible = buildRankingEligibility({
      scoreModelVersion: 6,
      dimensions: [dim("UTILITY", 61.9)],
      utilityPublicationEligible: true,
    });
    expect(eligible.eligible).toBe(true);
    expect(eligible.utilityEligible).toBe(true);
  });

  it("excludes profiles without Utility from complete ranking", () => {
    const result = buildRankingEligibility({
      scoreModelVersion: 6,
      dimensions: [dim("UTILITY", null, "UNAVAILABLE")],
      utilityPublicationEligible: false,
      utilityPublicationReasons: ["INSUFFICIENT_ANALYZED_RUNS"],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("UTILITY_NOT_ELIGIBLE");
  });

  it("excludes model v5 even with Utility score", () => {
    const result = buildRankingEligibility({
      scoreModelVersion: 5,
      dimensions: [dim("UTILITY", 70)],
      utilityPublicationEligible: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("MODEL_VERSION_BELOW_V6");
  });
});
