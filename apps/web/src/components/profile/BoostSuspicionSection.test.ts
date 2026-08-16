import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { BoostAssessmentPublicDTO } from "@mplus/contracts";
import { BOOST_ASSESSMENT_PUBLIC_DISCLAIMER } from "@mplus/contracts";
import BoostSuspicionSection from "./BoostSuspicionSection.vue";

const own: BoostAssessmentPublicDTO = {
  status: "AVAILABLE",
  suspicionScore: 82,
  suspicionBand: "HIGH",
  confidence: 0.95,
  detectorVersion: "boost-assessment-v1.0.0",
  calculatedAt: "2026-08-15T00:00:00.000Z",
  primaryEvidenceAvailable: true,
  assessmentCompleteness: "FULL",
  applicability: { status: "APPLICABLE" },
  coverage: {
    expectedTopRuns: 8,
    analyzableTopRuns: 6,
    unavailableTopRuns: 2,
    dungeons: [
      {
        dungeonSlug: "algethar-academy",
        blizzardBestKeyLevel: 23,
        publicAnalysableBestKeyLevel: 23,
        keyLevelVerificationGap: 0,
        analysable: true,
      },
      {
        dungeonSlug: "skyreach",
        blizzardBestKeyLevel: 23,
        publicAnalysableBestKeyLevel: 21,
        keyLevelVerificationGap: 2,
        analysable: false,
      },
      {
        dungeonSlug: "windrunner-spire",
        blizzardBestKeyLevel: 23,
        publicAnalysableBestKeyLevel: 21,
        keyLevelVerificationGap: 2,
        analysable: false,
      },
    ],
  },
  runEvidence: [
    {
      dungeonSlug: "algethar-academy",
      slot: "PRIMARY",
      keyLevel: 23,
      subjectKeyPercent: 0,
      peerMedianKeyPercent: 95.5,
      performanceDelta: -95.5,
      classification: "EXTREME_RED",
      reportUrl: "https://www.warcraftlogs.com/reports/LJc9kp2HP4gfBv6x?fight=5&type=damage-done",
    },
  ],
  sample: {
    highKeyRunCount: 8,
    parseCoverage: 0.9,
    completeRosterRunCount: 6,
    seasonContextAvailable: true,
    p99KeyThreshold: 16,
    p999KeyThreshold: 18,
    appliedAnchorPercentileLabel: "P99",
    exceptionalOperatingLevel: true,
  },
  signals: [
    {
      code: "STRONG_PEER_PERFORMANCE_GAP",
      contribution: 40,
      confidence: 0.9,
      status: "COMPUTED",
      summary: "backend summary must not be primary copy",
      missingReason: null,
      displayOrder: 0,
      facts: {
        code: "STRONG_PEER_PERFORMANCE_GAP",
        peerComparableRunCount: 6,
        analyzablePrimaryRunCount: 6,
        redPrimaryCount: 5,
        extremePrimaryCount: 5,
        weightedRedSeverity: 0.9,
        weightedGreenSeverity: 0.05,
      },
    },
  ],
  disclaimer: BOOST_ASSESSMENT_PUBLIC_DISCLAIMER,
};

describe("BoostSuspicionSection", () => {
  it("renders HIGH score, confidence, 6/8 coverage, facts, WCL URL", () => {
    const wrapper = mount(BoostSuspicionSection, { props: { assessment: own } });
    expect(wrapper.text()).toContain("82");
    expect(wrapper.text()).toContain("HIGH");
    expect(wrapper.text()).toContain("95%");
    expect(wrapper.text()).toContain("6 / 8");
    expect(wrapper.text()).toContain("5 extreme gaps across 6 analysed highest runs.");
    expect(wrapper.text()).toContain("Skyreach");
    expect(wrapper.text()).toContain("Public behavioural evidence: unavailable");
    expect(wrapper.text()).toContain("Best public canonical evidence: +21");
    expect(wrapper.get('[data-testid="boost-run-evidence"]').text()).toContain("Peer performance evidence");
    expect(wrapper.get('[data-testid="boost-run-evidence"]').text()).not.toContain("Windrunner");
    expect(wrapper.text()).not.toContain("Analysed runs");
    expect(wrapper.get("a").attributes("href")).toContain("warcraftlogs.com/reports/LJc9kp2HP4gfBv6x");
    expect(wrapper.text()).not.toContain("verified legitimate");
    expect(wrapper.text()).not.toContain("82% chance");
    expect(wrapper.text()).not.toContain("backend summary must not be primary copy");
    expect(wrapper.text()).toContain("does not prove paid boosting");
    expect(wrapper.text()).not.toMatch(/full evidence|fully verified|8\/8 verified/i);
  });

  it("renders not-exceptional separately from LOW", () => {
    const wrapper = mount(BoostSuspicionSection, {
      props: {
        assessment: {
          ...own,
          status: "PARTIAL",
          suspicionScore: 17,
          suspicionBand: "LOW",
          applicability: { status: "SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL" },
        },
      },
    });
    expect(wrapper.text()).toMatch(/not applicable/i);
    expect(wrapper.text()).not.toContain("LOW");
    expect(wrapper.text()).not.toContain("17");
  });

  it("renders insufficient-data separately from LOW", () => {
    const wrapper = mount(BoostSuspicionSection, {
      props: {
        assessment: {
          ...own,
          status: "INSUFFICIENT_DATA",
          suspicionScore: null,
          suspicionBand: null,
          applicability: { status: "INSUFFICIENT_CONTEXT" },
        },
      },
    });
    expect(wrapper.text()).toMatch(/Insufficient public evidence/i);
    expect(wrapper.text()).not.toContain("verified");
    expect(wrapper.text()).not.toContain("LOW");
  });

  it("shows PARTIAL limitations without treating it as LOW", () => {
    const wrapper = mount(BoostSuspicionSection, {
      props: {
        assessment: {
          ...own,
          status: "PARTIAL",
          suspicionScore: 54,
          suspicionBand: "ELEVATED",
          assessmentCompleteness: "PARTIAL_PRIMARY_MISSING",
        },
      },
    });
    expect(wrapper.text()).toContain("54");
    expect(wrapper.text()).toMatch(/incomplete/i);
    expect(wrapper.text()).not.toContain("LOW");
  });

  it("does not present fake Authenticity score: 100", () => {
    const wrapper = mount(BoostSuspicionSection, { props: { assessment: null } });
    expect(wrapper.text()).not.toContain("Authenticity score");
  });
});
