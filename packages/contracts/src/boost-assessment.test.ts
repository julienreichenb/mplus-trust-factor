import { describe, expect, it } from "vitest";
import { isHighBoostSuspicionAlert, type BoostAssessmentPublicDTO } from "./boost-assessment.js";

function assessment(
  patch: Partial<BoostAssessmentPublicDTO> &
    Pick<BoostAssessmentPublicDTO, "applicability" | "suspicionBand" | "suspicionScore">,
): BoostAssessmentPublicDTO {
  return {
    status: "AVAILABLE",
    confidence: 0.8,
    detectorVersion: "boost-assessment-v2.1.0",
    calculatedAt: "2026-08-16T00:00:00.000Z",
    coverage: {
      expectedTopRuns: 8,
      analyzableTopRuns: 6,
      unavailableTopRuns: 2,
      dungeons: [],
    },
    runEvidence: [],
    sample: {
      highKeyRunCount: 8,
      parseCoverage: 0.75,
      completeRosterRunCount: 6,
      seasonContextAvailable: true,
      p99KeyThreshold: 16,
      p999KeyThreshold: 18,
      appliedAnchorPercentileLabel: "P99",
    },
    signals: [],
    disclaimer: "d",
    ...patch,
  };
}

describe("isHighBoostSuspicionAlert", () => {
  it("requires APPLICABLE + HIGH + finite score from persisted assessment", () => {
    expect(
      isHighBoostSuspicionAlert(
        assessment({
          applicability: { status: "APPLICABLE" },
          suspicionBand: "HIGH",
          suspicionScore: 74,
        }),
      ),
    ).toBe(true);
  });

  it("does not treat persisted ELEVATED v2.0 as HIGH", () => {
    expect(
      isHighBoostSuspicionAlert(
        assessment({
          detectorVersion: "boost-assessment-v2.0.0",
          applicability: { status: "APPLICABLE" },
          suspicionBand: "ELEVATED",
          suspicionScore: 44,
        }),
      ),
    ).toBe(false);
  });

  it("ignores score magnitude when band is not HIGH", () => {
    expect(
      isHighBoostSuspicionAlert(
        assessment({
          applicability: { status: "APPLICABLE" },
          suspicionBand: "ELEVATED",
          suspicionScore: 90,
        }),
      ),
    ).toBe(false);
  });
});
