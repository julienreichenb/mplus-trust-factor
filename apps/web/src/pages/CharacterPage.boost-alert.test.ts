import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import {
  BOOST_ASSESSMENT_PUBLIC_DISCLAIMER,
  type BoostAssessmentPublicDTO,
} from "@mplus/contracts";

const fetchAuthMe = vi.fn(async () => ({ authenticated: false }));
const authenticated = ref(false);

function assessment(
  patch: Partial<BoostAssessmentPublicDTO>,
): BoostAssessmentPublicDTO {
  return {
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
    signals: [],
    disclaimer: BOOST_ASSESSMENT_PUBLIC_DISCLAIMER,
    ...patch,
  };
}

const { getCharacterProfile } = vi.hoisted(() => ({
  getCharacterProfile: vi.fn(),
}));

vi.mock("../composables/useAuthSession", () => ({
  useAuthSession: () => ({
    canForceRefresh: ref(false),
    authenticated,
    fetchAuthMe,
    user: ref(null),
    permissions: ref([]),
    canSeeAdminNav: ref(false),
    me: ref({ authenticated: false }),
    loading: ref(false),
    hasPermission: () => false,
  }),
}));

vi.mock("../api/client", () => ({
  api: {
    getCharacterProfile,
    refreshCharacter: vi.fn(),
    getRefreshStatus: vi.fn(),
  },
}));

vi.mock("../composables/useRefreshPolling", () => ({
  NORMAL_REFRESH_POLL_INTERVAL_MS: 60_000,
  ADMIN_REFRESH_POLL_INTERVAL_MS: 5_000,
  NORMAL_REFRESH_POLL_MAX_MS: 1,
  ADMIN_REFRESH_POLL_MAX_MS: 1,
  useRefreshPolling: () => ({
    polling: ref(false),
    timedOut: ref(false),
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("../composables/useWowheadTooltips", () => ({
  useWowheadTooltips: () => undefined,
}));

vi.mock("../integrations/wowhead/tooltips", () => ({
  loadWowheadTooltipScript: vi.fn(async () => "ready"),
  refreshWowheadTooltips: vi.fn(),
}));

import CharacterPage from "./CharacterPage.vue";

function profilePayload(boost: BoostAssessmentPublicDTO) {
  return {
    characterId: "c1",
    region: "EU",
    realmSlug: "ravencrest",
    displayName: "Own",
    classSlug: "mage",
    specSlug: "arcane",
    refreshStatus: "FRESH",
    media: null,
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
      confidence: 1,
      calculatedAt: "2026-07-20T12:00:00.000Z",
      inputFingerprint: "fp",
      dimensions: [],
      redFlags: [],
      explanation: {},
    },
    entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
    redFlags: [],
    warnings: [],
    performanceSummary: null,
    wclVisibility: "PUBLIC",
    wclDataState: "OK",
    boostAssessment: boost,
  };
}

describe("CharacterPage HIGH boost modal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    authenticated.value = false;
    getCharacterProfile.mockReset();
  });

  it("auto-opens once for HIGH+APPLICABLE and stays closed after dismiss", async () => {
    getCharacterProfile.mockResolvedValue(profilePayload(assessment({})));
    const wrapper = mount(CharacterPage, {
      props: { region: "eu", realm: "ravencrest", name: "Own" },
      attachTo: document.body,
      global: {
        stubs: {
          CharacterPortraitStage: true,
          ScoreHeader: true,
          DimensionCards: true,
          MethodologyPanel: true,
          CharacterRealmSearch: true,
          StatusBanner: true,
          AppToast: true,
          CharacterProfileToolbar: true,
          CharacterRefreshEta: true,
          WclVisibilityBanner: true,
        },
      },
    });
    await flushPromises();
    await nextTick();
    expect(wrapper.find("[data-testid='boost-suspicion-section']").exists()).toBe(true);
    expect(document.querySelector("[data-testid='boost-suspicion-alert-dialog']")).not.toBeNull();
    document
      .querySelector("[data-testid='boost-alert-close']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(document.querySelector("[data-testid='boost-suspicion-alert-dialog']")).toBeNull();
    wrapper.unmount();
  });

  it("does not auto-open for ELEVATED, LOW, INSUFFICIENT_CONTEXT, or SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL", async () => {
    for (const boost of [
      assessment({ suspicionBand: "ELEVATED", suspicionScore: 40 }),
      assessment({ suspicionBand: "LOW", suspicionScore: 10 }),
      assessment({
        applicability: { status: "INSUFFICIENT_CONTEXT" },
        status: "INSUFFICIENT_DATA",
        suspicionBand: null,
        suspicionScore: null,
      }),
      assessment({
        applicability: { status: "SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL" },
        suspicionBand: null,
        suspicionScore: 90,
      }),
    ]) {
      getCharacterProfile.mockResolvedValue(profilePayload(boost));
      const wrapper = mount(CharacterPage, {
        props: { region: "eu", realm: "ravencrest", name: "Own" },
        global: {
          stubs: {
            CharacterPortraitStage: true,
            ScoreHeader: true,
            DimensionCards: true,
            MethodologyPanel: true,
            CharacterRealmSearch: true,
            StatusBanner: true,
            AppToast: true,
            CharacterProfileToolbar: true,
            WclVisibilityBanner: true,
          },
        },
      });
      await flushPromises();
      expect(wrapper.find("[data-testid='boost-suspicion-alert-dialog']").exists()).toBe(false);
      wrapper.unmount();
    }
  });

  it("does not auto-open a persisted v2.0 ELEVATED assessment", async () => {
    getCharacterProfile.mockResolvedValue(
      profilePayload(
        assessment({
          detectorVersion: "boost-assessment-v2.0.0",
          suspicionBand: "ELEVATED",
          suspicionScore: 44,
        }),
      ),
    );
    const wrapper = mount(CharacterPage, {
      props: { region: "eu", realm: "ravencrest", name: "Own" },
      attachTo: document.body,
      global: {
        stubs: {
          CharacterPortraitStage: true,
          ScoreHeader: true,
          DimensionCards: true,
          MethodologyPanel: true,
          CharacterRealmSearch: true,
          StatusBanner: true,
          AppToast: true,
          CharacterProfileToolbar: true,
          CharacterRefreshEta: true,
          WclVisibilityBanner: true,
        },
      },
    });
    await flushPromises();
    await nextTick();
    expect(document.querySelector("[data-testid='boost-suspicion-alert-dialog']")).toBeNull();
    expect(wrapper.get("[data-testid='boost-suspicion-band']").text()).toBe("ELEVATED");
    expect(wrapper.get("[data-testid='boost-suspicion-score']").text()).toContain("44");
    expect(wrapper.get("[data-testid='boost-suspicion-section']").text()).not.toMatch(/\bHIGH\b/);
    wrapper.unmount();
  });

  it("uses the same persisted v2.1 HIGH assessment for banner, modal, and section", async () => {
    const boost = assessment({
      detectorVersion: "boost-assessment-v2.1.0",
      suspicionBand: "HIGH",
      suspicionScore: 74,
      signals: [
        {
          code: "STRONG_PEER_PERFORMANCE_GAP",
          contribution: 40,
          confidence: 0.9,
          status: "COMPUTED",
          summary: "unused",
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
    });
    getCharacterProfile.mockResolvedValue(profilePayload(boost));
    const wrapper = mount(CharacterPage, {
      props: { region: "eu", realm: "ravencrest", name: "Own" },
      attachTo: document.body,
      global: {
        stubs: {
          CharacterPortraitStage: true,
          DimensionCards: true,
          MethodologyPanel: true,
          CharacterRealmSearch: true,
          StatusBanner: true,
          AppToast: true,
          CharacterProfileToolbar: true,
          CharacterRefreshEta: true,
          WclVisibilityBanner: true,
        },
      },
    });
    await flushPromises();
    await nextTick();
    const banner = wrapper.get("[data-testid='boost-suspicion-banner']");
    expect(banner.text()).toMatch(/HIGH\s+BOOST SUSPICION/i);
    expect(banner.text()).not.toContain("/ 100");
    const dialog = document.querySelector("[data-testid='boost-suspicion-alert-dialog']");
    expect(dialog?.textContent).toContain("74");
    expect(dialog?.textContent).toContain("HIGH");
    expect(dialog?.textContent).toContain(
      "Severe performance gaps were observed across 4 of 6 analysed highest runs.",
    );
    const section = wrapper.get("[data-testid='boost-suspicion-section']");
    expect(section.text()).toContain("74");
    expect(section.text()).toContain("HIGH");
    expect(section.text()).toContain(
      "Severe performance gaps were observed across 4 of 6 analysed highest runs.",
    );
    expect(section.text()).toContain("Typical performance gap across analysed highest runs: -58 points.");
    wrapper.unmount();
  });
});
