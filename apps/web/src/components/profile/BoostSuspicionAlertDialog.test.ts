import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import KeySignalRow from "./KeySignalRow.vue";
import BoostSuspicionAlertDialog from "./BoostSuspicionAlertDialog.vue";
import HeroInsightAccordion from "./HeroInsightAccordion.vue";
import {
  BOOST_ASSESSMENT_PUBLIC_DISCLAIMER,
  type BoostAssessmentPublicDTO,
} from "@mplus/contracts";
import type { CharacterProfileView } from "../../api/types";

const highAssessment: BoostAssessmentPublicDTO = {
  status: "AVAILABLE",
  suspicionScore: 82,
  suspicionBand: "HIGH",
  confidence: 0.8,
  detectorVersion: "boost-assessment-v2.1.0",
  calculatedAt: "2026-08-15T00:00:00.000Z",
  applicability: { status: "APPLICABLE" },
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
  signals: [
    {
      code: "STRONG_PEER_PERFORMANCE_GAP",
      contribution: 40,
      confidence: 0.9,
      status: "COMPUTED",
      summary: "unused backend summary",
      displayOrder: 0,
      facts: {
        code: "STRONG_PEER_PERFORMANCE_GAP",
        peerComparableRunCount: 6,
        analyzablePrimaryRunCount: 6,
        redPrimaryCount: 5,
        extremePrimaryCount: 4,
        weightedRedSeverity: 0.9,
        weightedGreenSeverity: 0.05,
        materiallyNegativePrimaryCount: 5,
        severeNegativePrimaryCount: 4,
        medianPrimaryPerformanceDelta: -58.4,
        severePrimaryRatio: 4 / 6,
      },
    },
  ],
  disclaimer: BOOST_ASSESSMENT_PUBLIC_DISCLAIMER,
};

function profile(): CharacterProfileView {
  return {
    characterId: "c1",
    region: "EU",
    realmSlug: "ravencrest",
    displayName: "Own",
    refreshStatus: "FRESH",
    redFlags: [],
    score: {
      characterId: "c1",
      seasonSlug: "s",
      modelKey: "default",
      modelVersion: 6,
      scopeType: "CHARACTER",
      scopeKey: null,
      overallScore: 80,
      grade: "B",
      skillScore: 80,
      authenticityScore: 18,
      confidence: 0.9,
      calculatedAt: "2026-07-20T12:00:00.000Z",
      inputFingerprint: "fp",
      dimensions: [
        {
          dimension: "PERFORMANCE",
          score: 90,
          confidence: 1,
          weight: 0.35,
          state: "AVAILABLE",
          reason: null,
          contributors: null,
          explainability: {
            scoreDrivers: [
              {
                code: "performance.damage_parse",
                labelKey: "score.performance.damage_parse",
                label: "Damage parse performance scored 92",
                direction: "POSITIVE",
                value: 92,
                qualitativeLabel: "VERY GOOD",
              },
            ],
            confidenceReasons: [],
          },
        },
      ],
      redFlags: [],
      explanation: {},
    },
  } as unknown as CharacterProfileView;
}

describe("qualitative key signals", () => {
  it("shows backend qualitative labels as the primary text", () => {
    const wrapper = mount(KeySignalRow, {
      props: {
        signal: {
          kind: "positive",
          label: "Damage parse performance scored 92",
          qualitativeLabel: "VERY GOOD",
          dimension: "Performance",
          dimensionKey: "PERFORMANCE",
        },
      },
    });
    expect(wrapper.text()).toContain("Very good damage parse performance");
    expect(wrapper.text()).not.toContain("scored 92");
    expect(wrapper.get(".signal-row__text").attributes("data-qualitative-label")).toBe("VERY GOOD");
  });
});

describe("HIGH boost banner and modal", () => {
  it("renders the red banner from suspicionBand HIGH and opens the shared dialog", async () => {
    const wrapper = mount(HeroInsightAccordion, {
      props: { profile: profile(), boostAssessment: highAssessment },
    });
    const banner = wrapper.get("[data-testid='boost-suspicion-banner']");
    expect(wrapper.get(".insight-stack").element.firstElementChild).toBe(banner.element);
    expect(wrapper.get(".insight-accordion").element.contains(banner.element)).toBe(false);
    expect(banner.text()).toMatch(/HIGH\s+BOOST SUSPICION/i);
    expect(banner.text()).not.toContain("/ 100");
    expect(banner.text()).not.toContain("Elevated patterns");
    await banner.trigger("click");
    expect(wrapper.emitted("openBoostAlert")).toHaveLength(1);
  });

  it("modal shows typed facts, coverage, and disclaimer", async () => {
    const wrapper = mount(BoostSuspicionAlertDialog, {
      props: { open: true, assessment: highAssessment },
      attachTo: document.body,
    });
    await nextTick();
    const dialog = document.querySelector("[data-testid='boost-suspicion-alert-dialog']");
    expect(dialog?.textContent).toContain("High boost suspicion");
    expect(dialog?.textContent).toContain("82");
    expect(dialog?.textContent).toContain("HIGH");
    expect(dialog?.textContent).toContain("Performance gap with teammates");
    expect(dialog?.textContent).toContain(
      "Severe performance gaps were observed across 4 of 6 analysed highest runs.",
    );
    expect(dialog?.textContent).toContain(
      "5 of 6 analysed highest runs show material underperformance versus same-run peers.",
    );
    expect(dialog?.textContent).toContain("6 of 8");
    expect(dialog?.textContent).toContain("Evidence confidence");
    expect(dialog?.textContent).not.toContain("Why this result");
    expect(dialog?.textContent).not.toContain("Evidence limitations");
    expect(dialog?.textContent).not.toContain("contribution");
    expect(dialog?.textContent).toContain(BOOST_ASSESSMENT_PUBLIC_DISCLAIMER);
    wrapper.unmount();
  });

  it("does not render the HIGH banner for ELEVATED", () => {
    const wrapper = mount(HeroInsightAccordion, {
      props: {
        profile: profile(),
        boostAssessment: { ...highAssessment, suspicionBand: "ELEVATED", suspicionScore: 40 },
      },
    });
    expect(wrapper.find("[data-testid='boost-suspicion-banner']").exists()).toBe(false);
  });
});
