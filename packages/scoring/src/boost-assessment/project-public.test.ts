import { describe, expect, it } from "vitest";
import {
  assertPublicBoostDtoHasNoInternalPeers,
  projectBoostAssessmentPublic,
} from "./project-public.js";
import { BOOST_ASSESSMENT_PUBLIC_DISCLAIMER } from "@mplus/contracts";

const ownSample = {
  highKeyRunCount: 8,
  boostSampleSize: 8,
  seasonContextAvailable: true,
  exceptionalOperatingLevel: true,
  primaryEvidenceAvailable: true,
  assessmentCompleteness: "FULL",
  dungeonContexts: [
    {
      dungeonSlug: "algethar-academy",
      blizzardBestKeyLevel: 23,
      publicAnalysableBestKeyLevel: 23,
      keyLevelVerificationGap: 0,
      topPublicEvidenceAvailable: true,
      publicAnalysableCode: "LJc9kp2HP4gfBv6x",
      publicAnalysableFightId: 5,
    },
    {
      dungeonSlug: "skyreach",
      blizzardBestKeyLevel: 23,
      publicAnalysableBestKeyLevel: 21,
      keyLevelVerificationGap: 2,
      topPublicEvidenceAvailable: false,
      publicAnalysableCode: "abcSky",
      publicAnalysableFightId: 1,
    },
    {
      dungeonSlug: "windrunner-spire",
      blizzardBestKeyLevel: 23,
      publicAnalysableBestKeyLevel: 21,
      keyLevelVerificationGap: 2,
      topPublicEvidenceAvailable: false,
    },
    {
      dungeonSlug: "eco-dome-aldani",
      blizzardBestKeyLevel: 23,
      publicAnalysableBestKeyLevel: 23,
      keyLevelVerificationGap: 0,
      topPublicEvidenceAvailable: true,
    },
    {
      dungeonSlug: "halls-of-atonement",
      blizzardBestKeyLevel: 23,
      publicAnalysableBestKeyLevel: 23,
      keyLevelVerificationGap: 0,
      topPublicEvidenceAvailable: true,
    },
    {
      dungeonSlug: "tazavesh-so-leahs-gambit",
      blizzardBestKeyLevel: 23,
      publicAnalysableBestKeyLevel: 23,
      keyLevelVerificationGap: 0,
      topPublicEvidenceAvailable: true,
    },
    {
      dungeonSlug: "tazavesh-streets-of-wonder",
      blizzardBestKeyLevel: 23,
      publicAnalysableBestKeyLevel: 23,
      keyLevelVerificationGap: 0,
      topPublicEvidenceAvailable: true,
    },
    {
      dungeonSlug: " ara-kara-city-of-echoes".trim(),
      blizzardBestKeyLevel: 23,
      publicAnalysableBestKeyLevel: 23,
      keyLevelVerificationGap: 0,
      topPublicEvidenceAvailable: true,
    },
  ],
  analyzedRuns: [
    {
      dungeonSlug: "algethar-academy",
      dungeonSlotRole: "PRIMARY",
      slotIndex: 0,
      keyLevel: 23,
      subjectKeyParse: 0,
      peerMedianKeyParse: 95.5,
      performanceDelta: -95.5,
      gapClass: "RED_EXTREME",
      wclCode: "LJc9kp2HP4gfBv6x",
      wclFightId: 5,
      peerKeyParses: [{ identityKey: "secret", displayName: "Peer", keyParse: 99, role: "DPS" }],
    },
    {
      dungeonSlug: "windrunner-spire",
      dungeonSlotRole: "PRIMARY",
      slotIndex: 0,
      keyLevel: 22,
      subjectKeyParse: 58,
      peerMedianKeyParse: 52,
      performanceDelta: 6,
      gapClass: "NEUTRAL",
      wclCode: "MBgj6kqdZJK8yHzN",
      wclFightId: 3,
    },
  ],
};

describe("projectBoostAssessmentPublic", () => {
  it("projects Own-like HIGH assessment with typed facts and 6/8 coverage", () => {
    const dto = projectBoostAssessmentPublic({
      status: "AVAILABLE",
      suspicionScore: 82,
      suspicionBand: "HIGH",
      confidence: 0.95,
      detectorVersion: "boost-assessment-v1.0.0",
      calculatedAt: "2026-08-15T00:00:00.000Z",
      sample: ownSample,
      signals: [
        {
          code: "STRONG_PEER_PERFORMANCE_GAP",
          contribution: 40,
          confidence: 0.9,
          status: "COMPUTED",
          summary: "internal",
          evidence: {
            peerComparableRunCount: 6,
            comparablePrimaryRunCount: 6,
            redPrimaryCount: 5,
            extremePrimaryCount: 5,
            weightedRedSeverity: 0.9,
            weightedGreenSeverity: 0.05,
          },
        },
        {
          code: "RECURRENT_STRONG_PEER_COHORT",
          contribution: 18,
          confidence: 0.8,
          status: "COMPUTED",
          summary: "internal",
          evidence: {
            gapDungeonCount: 6,
            identities: [{ displayName: "Peer", identityKey: "cid:hidden", characterId: "db-id" }],
          },
        },
      ],
    });
    expect(dto.applicability.status).toBe("APPLICABLE");
    expect(dto.coverage.expectedTopRuns).toBe(8);
    expect(dto.coverage.analyzableTopRuns).toBe(6);
    expect(dto.coverage.unavailableTopRuns).toBe(2);
    const sky = dto.coverage.dungeons.find((d) => d.dungeonSlug === "skyreach");
    expect(sky).toMatchObject({
      blizzardBestKeyLevel: 23,
      publicAnalysableBestKeyLevel: 21,
      analysable: false,
    });
    const wind = dto.coverage.dungeons.find((d) => d.dungeonSlug === "windrunner-spire");
    expect(wind?.analysable).toBe(false);
    const peer = dto.signals.find((s) => s.code === "STRONG_PEER_PERFORMANCE_GAP");
    expect(peer?.facts).toMatchObject({
      code: "STRONG_PEER_PERFORMANCE_GAP",
      extremePrimaryCount: 5,
      analyzablePrimaryRunCount: 6,
    });
    expect(peer?.displayOrder).toBe(0);
    expect(dto.runEvidence[0]).toMatchObject({
      dungeonSlug: "algethar-academy",
      slot: "PRIMARY",
      classification: "EXTREME_RED",
      reportUrl: "https://www.warcraftlogs.com/reports/LJc9kp2HP4gfBv6x?fight=5&type=damage-done",
    });
    expect(dto.runEvidence.some((r) => r.dungeonSlug === "windrunner-spire")).toBe(false);
    expect(dto.disclaimer).toBe(BOOST_ASSESSMENT_PUBLIC_DISCLAIMER);
    expect(JSON.stringify(dto)).not.toContain("peerKeyParses");
    expect(JSON.stringify(dto)).not.toContain("cid:hidden");
    expect(JSON.stringify(dto)).not.toContain("\"evidence\"");
    assertPublicBoostDtoHasNoInternalPeers(dto);
  });

  it("maps Khaelt-like not-exceptional without converting PARTIAL to LOW", () => {
    const dto = projectBoostAssessmentPublic({
      status: "PARTIAL",
      suspicionScore: 12,
      suspicionBand: "LOW",
      confidence: 0.4,
      detectorVersion: "boost-assessment-v1.0.0",
      calculatedAt: "2026-08-15T00:00:00.000Z",
      sample: { exceptionalOperatingLevel: false, seasonContextAvailable: true, dungeonContexts: [] },
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
    expect(dto.suspicionBand).toBe("LOW");
  });

  it("does not crash on historical rows missing coverage and facts", () => {
    const dto = projectBoostAssessmentPublic({
      status: "AVAILABLE",
      suspicionScore: 71,
      suspicionBand: "HIGH",
      confidence: 0.82,
      detectorVersion: "boost-assessment-v1.0.0",
      calculatedAt: "2026-08-15T00:00:00.000Z",
      sample: { highKeyRunCount: 7, seasonContextAvailable: true },
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
    expect(dto.coverage.expectedTopRuns).toBe(0);
    expect(dto.runEvidence).toEqual([]);
    expect(dto.signals[0]?.facts).toEqual({ code: "HIGH_KEY_PERFORMANCE_MISMATCH" });
    expect(dto.applicability.status).toBe("APPLICABLE");
  });

  it("derives the same reportUrl from live and replay canonical identities", () => {
    const analyzed = {
      dungeonSlug: "algethar-academy",
      dungeonSlotRole: "PRIMARY" as const,
      keyLevel: 23,
      subjectKeyParse: 0,
      peerMedianKeyParse: 95.5,
      performanceDelta: -95.5,
      gapClass: "RED_EXTREME",
      wclCode: "LJc9kp2HP4gfBv6x",
      wclFightId: 5,
    };
    const base = {
      status: "AVAILABLE",
      suspicionScore: 82,
      suspicionBand: "HIGH",
      confidence: 0.95,
      detectorVersion: "boost-assessment-v2.0.0",
      calculatedAt: "2026-08-15T00:00:00.000Z",
      signals: [],
    };
    const live = projectBoostAssessmentPublic({
      ...base,
      sample: { exceptionalOperatingLevel: true, seasonContextAvailable: true, analyzedRuns: [analyzed] },
    });
    const replay = projectBoostAssessmentPublic({
      ...base,
      sample: { exceptionalOperatingLevel: true, seasonContextAvailable: true, analyzedRuns: [{ ...analyzed }] },
    });
    expect(live.runEvidence[0]?.reportUrl).toBe(
      "https://www.warcraftlogs.com/reports/LJc9kp2HP4gfBv6x?fight=5&type=damage-done",
    );
    expect(replay.runEvidence[0]?.reportUrl).toBe(live.runEvidence[0]?.reportUrl);
    expect(JSON.stringify(live)).not.toContain("wclCode");
  });

  it("still derives reportUrl from historical wclUrl when canonical identity is absent", () => {
    const dto = projectBoostAssessmentPublic({
      status: "AVAILABLE",
      suspicionScore: 82,
      suspicionBand: "HIGH",
      confidence: 0.95,
      detectorVersion: "boost-assessment-v1.0.0",
      calculatedAt: "2026-08-15T00:00:00.000Z",
      sample: {
        exceptionalOperatingLevel: true,
        seasonContextAvailable: true,
        analyzedRuns: [
          {
            dungeonSlug: "algethar-academy",
            dungeonSlotRole: "PRIMARY",
            keyLevel: 23,
            gapClass: "RED_EXTREME",
            wclUrl: "https://www.warcraftlogs.com/reports/LJc9kp2HP4gfBv6x?fight=5&type=damage-done",
          },
        ],
      },
      signals: [],
    });
    expect(dto.runEvidence[0]?.reportUrl).toBe(
      "https://www.warcraftlogs.com/reports/LJc9kp2HP4gfBv6x?fight=5&type=damage-done",
    );
  });
});
