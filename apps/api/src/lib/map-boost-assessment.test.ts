import { describe, expect, it } from "vitest";
import { mapPersistedBoostAssessment } from "./map-boost-assessment.js";

describe("mapPersistedBoostAssessment", () => {
  it("maps Own-like persisted row to typed public DTO", () => {
    const dto = mapPersistedBoostAssessment({
      status: "AVAILABLE",
      suspicionScore: 82,
      suspicionBand: "HIGH",
      confidence: 0.95,
      detectorVersion: "boost-assessment-v1.0.0",
      calculatedAt: new Date("2026-08-15T00:00:00.000Z"),
      sample: {
        exceptionalOperatingLevel: true,
        seasonContextAvailable: true,
        assessmentCompleteness: "FULL",
        dungeonContexts: [
          {
            dungeonSlug: "skyreach",
            blizzardBestKeyLevel: 23,
            publicAnalysableBestKeyLevel: 21,
            keyLevelVerificationGap: 2,
            topPublicEvidenceAvailable: false,
          },
          {
            dungeonSlug: "windrunner-spire",
            blizzardBestKeyLevel: 23,
            publicAnalysableBestKeyLevel: 21,
            keyLevelVerificationGap: 2,
            topPublicEvidenceAvailable: false,
          },
          ...Array.from({ length: 6 }, (_, i) => ({
            dungeonSlug: `dungeon-${i}`,
            blizzardBestKeyLevel: 23,
            publicAnalysableBestKeyLevel: 23,
            keyLevelVerificationGap: 0,
            topPublicEvidenceAvailable: true,
          })),
        ],
        analyzedRuns: [
          {
            dungeonSlug: "algethar-academy",
            dungeonSlotRole: "PRIMARY",
            keyLevel: 23,
            subjectKeyParse: 0,
            peerMedianKeyParse: 95.5,
            performanceDelta: -95.5,
            gapClass: "RED_EXTREME",
            wclUrl: "https://www.warcraftlogs.com/reports/LJc9kp2HP4gfBv6x?fight=5&type=damage-done",
            peerKeyParses: [{ identityKey: "x", keyParse: 99 }],
          },
        ],
      },
      signals: [
        {
          code: "STRONG_PEER_PERFORMANCE_GAP",
          contribution: 40,
          confidence: 0.9,
          status: "COMPUTED",
          summary: "internal",
          evidence: { comparablePrimaryRunCount: 6, extremePrimaryCount: 5 },
        },
      ],
    });
    expect(dto.suspicionScore).toBe(82);
    expect(dto.suspicionBand).toBe("HIGH");
    expect(dto.applicability.status).toBe("APPLICABLE");
    expect(dto.coverage.analyzableTopRuns).toBe(6);
    expect(dto.coverage.expectedTopRuns).toBe(8);
    expect(dto.signals[0]?.facts).toMatchObject({
      code: "STRONG_PEER_PERFORMANCE_GAP",
      extremePrimaryCount: 5,
    });
    expect(JSON.stringify(dto)).not.toContain("peerKeyParses");
    expect(JSON.stringify(dto)).not.toContain("authenticityScore");
    expect(JSON.stringify(dto)).not.toContain("BOOST_ASSESSMENT_POLICY");
  });

  it("maps Khaelt-like not-exceptional without collapsing PARTIAL to a LOW verdict", () => {
    const dto = mapPersistedBoostAssessment({
      status: "PARTIAL",
      suspicionScore: 17,
      suspicionBand: "LOW",
      confidence: 0.3,
      detectorVersion: "boost-assessment-v1.0.0",
      calculatedAt: new Date("2026-08-15T00:00:00.000Z"),
      sample: { exceptionalOperatingLevel: false, seasonContextAvailable: true },
      signals: [
        {
          code: "STRONG_PEER_PERFORMANCE_GAP",
          contribution: 0,
          status: "UNAVAILABLE",
          missingReason: "SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL",
          evidence: {},
        },
      ],
    });
    expect(dto.applicability.status).toBe("SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL");
    expect(dto.status).toBe("PARTIAL");
  });

  it("survives historical assessments missing new fields", () => {
    const dto = mapPersistedBoostAssessment({
      status: "AVAILABLE",
      suspicionScore: 71,
      suspicionBand: "HIGH",
      confidence: { toNumber: () => 0.82 },
      detectorVersion: "boost-assessment-v1.0.0",
      calculatedAt: new Date("2026-08-15T00:00:00.000Z"),
      sample: { highKeyRunCount: 7, parseCoverage: 0.9, completeRosterRunCount: 7, seasonContextAvailable: true },
      signals: [
        {
          code: "HIGH_KEY_PERFORMANCE_MISMATCH",
          contribution: 34,
          confidence: 0.91,
          status: "COMPUTED",
          summary: "legacy",
          evidence: { meanParsePercentile: 22 },
        },
      ],
    });
    expect(dto.coverage.dungeons).toEqual([]);
    expect(dto.runEvidence).toEqual([]);
    expect(dto.signals[0]?.displayOrder).toBe(0);
  });
});
