import { describe, expect, it } from "vitest";
import { peerGapFactSentences } from "./boostSuspicionPresentation";

describe("peerGapFactSentences", () => {
  it("renders v2.1 counts and median from DTO facts only", () => {
    const sentences = peerGapFactSentences(
      {
        code: "STRONG_PEER_PERFORMANCE_GAP",
        peerComparableRunCount: 6,
        analyzablePrimaryRunCount: 6,
        redPrimaryCount: 5,
        extremePrimaryCount: 4,
        weightedRedSeverity: null,
        weightedGreenSeverity: null,
        materiallyNegativePrimaryCount: 5,
        severeNegativePrimaryCount: 4,
        medianPrimaryPerformanceDelta: -58.2,
        severePrimaryRatio: 4 / 6,
      },
      "section",
    );
    expect(sentences).toEqual([
      "Severe performance gaps were observed across 4 of 6 analysed highest runs.",
      "5 of 6 analysed highest runs show material underperformance versus same-run peers.",
      "Typical performance gap across analysed highest runs: -58 points.",
    ]);
  });

  it("does not invent HIGH from severe ratio or median", () => {
    const sentences = peerGapFactSentences(
      {
        code: "STRONG_PEER_PERFORMANCE_GAP",
        peerComparableRunCount: 6,
        analyzablePrimaryRunCount: 6,
        redPrimaryCount: 6,
        extremePrimaryCount: 6,
        weightedRedSeverity: 1,
        weightedGreenSeverity: 0,
        materiallyNegativePrimaryCount: 6,
        severeNegativePrimaryCount: 6,
        medianPrimaryPerformanceDelta: -80,
        severePrimaryRatio: 1,
      },
      "section",
    );
    expect(sentences.join(" ")).not.toMatch(/\bHIGH\b|\bsuspicion\b|\b74\b|threshold/i);
  });
});
