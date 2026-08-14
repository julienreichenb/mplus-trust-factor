import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { ScoreExplainabilityV2PublicDTO } from "@mplus/contracts";

const fetchAuthMe = vi.fn(async () => ({ authenticated: false }));
const authenticated = ref(false);

const explainabilityV2Sample: ScoreExplainabilityV2PublicDTO = {
  schemaVersion: "2.0.0",
  modelKey: "default",
  modelVersion: 6,
  dataAsOf: "2026-08-01T00:00:00.000Z",
  evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
  coverage: {
    analyzedRunCount: 10,
    expectedRunCount: 16,
    representedDungeonCount: 6,
    expectedDungeonCount: 8,
    coverageState: "PARTIAL",
    publicationState: "PROVISIONAL",
    provisional: true,
    stale: false,
    unavailable: false,
  },
  selectedRuns: [],
  cooldownUsages: [],
  dimensions: [
    {
      dimension: "PERFORMANCE",
      score: 91,
      confidence: 0.85,
      availabilityState: "AVAILABLE",
      gradeU: false,
      algorithmVersion: "performance-v2",
      topContributors: [
        {
          key: "performance.peak",
          dimension: "PERFORMANCE",
          label: "V2 top contributor must not appear",
          score: 91,
          direction: "positive",
        },
      ],
      limitations: ["partial_coverage"],
    },
  ],
  notes: [],
  gradeUMeans: "unavailable_or_unranked",
};

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
    getCharacterProfile: vi.fn(async () => ({
      characterId: "c1",
      region: "EU",
      realmSlug: "tarren-mill",
      displayName: "Aleria",
      classSlug: "mage",
      specSlug: "arcane",
      refreshStatus: "FRESH",
      media: null,
      score: {
        characterId: "c1",
        seasonSlug: "season-tww-3",
        modelKey: "default",
        modelVersion: 3,
        scopeType: "CHARACTER",
        scopeKey: null,
        overallScore: 88,
        grade: "A",
        skillScore: 90,
        authenticityScore: 82,
        confidence: 0.78,
        calculatedAt: "2026-07-20T12:00:00.000Z",
        inputFingerprint: "fp",
        dimensions: [
          {
            dimension: "PERFORMANCE",
            score: 91,
            confidence: 0.85,
            weight: 0.35,
            state: "AVAILABLE",
            reason: null,
            contributors: null,
            explainability: {
              scoreDrivers: [
                {
                  code: "performance.phase1_performance",
                  labelKey: "score.performance.phase1_performance",
                  label: "Strong Phase 1 performance",
                  direction: "POSITIVE",
                  value: 92,
                },
              ],
              confidenceReasons: [],
            },
          },
          {
            dimension: "SURVIVAL",
            score: 84,
            confidence: 0.8,
            weight: 0.3,
            state: "AVAILABLE",
            reason: null,
            contributors: null,
            explainability: {
              scoreDrivers: [],
              confidenceReasons: [],
            },
          },
          {
            dimension: "UTILITY",
            score: 86,
            confidence: 0.75,
            weight: 0.25,
            state: "AVAILABLE",
            reason: null,
            contributors: null,
            explainability: {
              scoreDrivers: [],
              confidenceReasons: [],
            },
          },
          {
            dimension: "EXPERIENCE",
            score: 0,
            confidence: 1,
            weight: 0.1,
            state: "AVAILABLE",
            reason: null,
            contributors: null,
            explainability: {
              scoreDrivers: [
                {
                  code: "experience.confirmed_no_activity",
                  labelKey: "score.experience.confirmed_no_activity",
                  label: "Previous-season activity: none confirmed",
                  direction: "NEUTRAL",
                  value: 0,
                },
              ],
              confidenceReasons: [],
            },
          },
        ],
        redFlags: [],
        explanation: {},
      },
      entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
      redFlags: [],
      warnings: [],
      performanceSummary: null,
      wclVisibility: "PUBLIC",
      wclDataState: "OK",
      explainabilityV2: explainabilityV2Sample,
    })),
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
import { api } from "../api/client";

describe("CharacterPage score explanation authority", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    authenticated.value = false;
    fetchAuthMe.mockResolvedValue({ authenticated: false });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does not render legacy ExplainabilityV2Panel even when explainabilityV2 is present", async () => {
    const wrapper = mount(CharacterPage, {
      props: { region: "eu", realm: "tarren-mill", name: "Aleria" },
      global: {
        stubs: {
          CharacterPortraitStage: true,
          ScoreHeader: true,
          AuthenticitySection: true,
          WclVisibilityBanner: true,
          DataProvenancePanel: true,
          MethodologyPanel: true,
          CharacterRealmSearch: true,
          StatusBanner: true,
          AppToast: true,
          CharacterProfileToolbar: true,
          CharacterRefreshEta: true,
        },
      },
    });
    await flushPromises();
    await nextTick();

    expect(api.getCharacterProfile).toHaveBeenCalled();
    expect(wrapper.find("[data-testid='explainability-v2']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='score-context-breakdown']").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Selected-run evidence (Scoring V2)");
    expect(wrapper.text()).not.toContain("V2 top contributor must not appear");
    expect(wrapper.html()).not.toMatch(/manifestContentHash|inputFingerprint|reportCode|scoreModelId/i);
    // V1 product authority still renders on dimension cards.
    expect(wrapper.find("[data-testid='dimension-cards']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Strong Phase 1 performance");
    expect(wrapper.text()).toContain("Previous-season activity: none confirmed");
  });
});
