import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const fetchAuthMe = vi.fn(async () => ({ authenticated: false }));
const canForceRefresh = ref(false);

const { getCharacterProfile, getRefreshStatus, refreshCharacter } = vi.hoisted(() => ({
  getCharacterProfile: vi.fn(),
  getRefreshStatus: vi.fn(),
  refreshCharacter: vi.fn(),
}));

vi.mock("../composables/useAuthSession", () => ({
  useAuthSession: () => ({
    canForceRefresh,
    authenticated: ref(false),
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
    getRefreshStatus,
    refreshCharacter,
  },
}));

vi.mock("../composables/useWowheadTooltips", () => ({
  useWowheadTooltips: () => undefined,
}));

vi.mock("../integrations/wowhead/tooltips", () => ({
  loadWowheadTooltipScript: vi.fn(async () => "ready"),
  refreshWowheadTooltips: vi.fn(),
}));

import CharacterPage from "./CharacterPage.vue";

function queuedNoScoreProfile() {
  return {
    characterId: "c-queued",
    region: "EU",
    realmSlug: "tarren-mill",
    displayName: "Newchar",
    score: null,
    redFlags: [],
    dataConfidence: null,
    lastAnalyzedRunId: null,
    highestAnalyzedRunId: null,
    sources: [],
    refreshStatus: "QUEUED" as const,
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS" as const,
    entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
    warnings: [],
    media: {
      mainRawUrl: "https://render.worldofwarcraft.com/eu/characters/main-fail.jpg",
      insetUrl: "https://render.worldofwarcraft.com/eu/characters/inset-fail.jpg",
      avatarUrl: "https://render.worldofwarcraft.com/eu/characters/avatar-fail.jpg",
    },
  };
}

function scoredProfile() {
  return {
    ...queuedNoScoreProfile(),
    refreshStatus: "FRESH" as const,
    dataConfidence: 70,
    score: {
      characterId: "c-queued",
      seasonSlug: "season-tww-3",
      modelKey: "default",
      modelVersion: 3,
      scopeType: "CHARACTER" as const,
      scopeKey: null,
      overallScore: 62,
      grade: "C",
      skillScore: 65,
      authenticityScore: 70,
      confidence: 0.45,
      calculatedAt: "2026-07-20T12:00:00.000Z",
      inputFingerprint: "fp",
      dimensions: [
        {
          dimension: "PERFORMANCE",
          score: 60,
          confidence: 0.4,
          weight: 0.35,
          state: "AVAILABLE",
          reason: null,
          contributors: null,
        },
      ],
      redFlags: [],
      explanation: {},
    },
  };
}

describe("CharacterPage first-score loading UI", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    canForceRefresh.value = false;
    vi.clearAllMocks();
    getCharacterProfile.mockResolvedValue(queuedNoScoreProfile());
    getRefreshStatus.mockResolvedValue({
      characterId: "c-queued",
      refreshStatus: "IN_PROGRESS",
      job: {
        jobId: "job-1",
        queue: "refresh-character",
        status: "active",
        dedupeKey: null,
        createdAt: "2026-07-20T12:00:00.000Z",
        startedAt: "2026-07-20T12:00:01.000Z",
        finishedAt: null,
        errorMessage: null,
      },
      cooldownSecondsRemaining: 0,
    });
  });

  it("shows loading panel without score cards, grade empty state, or portrait overflow host", async () => {
    const wrapper = mount(CharacterPage, {
      props: { region: "EU", realm: "tarren-mill", name: "Newchar" },
      global: {
        stubs: {
          CharacterRealmSearch: true,
          CharacterProfileToolbar: true,
          CharacterRefreshEta: true,
          BoostSuspicionSection: true,
          BoostSuspicionAlertDialog: true,
          RunDetailsDrawer: true,
          WclVisibilityBanner: true,
          MethodologyPanel: true,
          AppToast: true,
          StatusBanner: true,
        },
      },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find("[data-testid='character-score-loading']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='character-score-loading']").attributes("data-phase")).toBe(
      "calculating",
    );
    expect(wrapper.find("[data-testid='dimension-cards']").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/Grade unavailable/i);
    expect(wrapper.find(".portrait-stage").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/\/\s*100/);
    wrapper.unmount();
  });

  it("replaces loading UI with score content after publication without a reload", async () => {
    vi.useFakeTimers();
    const wrapper = mount(CharacterPage, {
      props: { region: "EU", realm: "tarren-mill", name: "Newchar" },
      global: {
        stubs: {
          CharacterRealmSearch: true,
          CharacterPortraitStage: true,
          CharacterProfileToolbar: true,
          CharacterRefreshEta: true,
          BoostSuspicionSection: true,
          BoostSuspicionAlertDialog: true,
          RunDetailsDrawer: true,
          WclVisibilityBanner: true,
          MethodologyPanel: true,
          AppToast: true,
          StatusBanner: true,
          ScoreHeader: true,
          DimensionCards: true,
        },
      },
    });

    await flushPromises();
    expect(wrapper.find("[data-testid='character-score-loading']").exists()).toBe(true);

    getRefreshStatus.mockResolvedValue({
      characterId: "c-queued",
      refreshStatus: "FRESH",
      job: {
        jobId: "job-1",
        queue: "refresh-character",
        status: "completed",
        dedupeKey: null,
        createdAt: "2026-07-20T12:00:00.000Z",
        startedAt: "2026-07-20T12:00:01.000Z",
        finishedAt: "2026-07-20T12:01:00.000Z",
        errorMessage: null,
      },
      cooldownSecondsRemaining: 0,
    });
    getCharacterProfile.mockResolvedValue(scoredProfile());

    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();
    await nextTick();

    expect(wrapper.find("[data-testid='character-score-loading']").exists()).toBe(false);
    expect(wrapper.find("score-header-stub").exists()).toBe(true);
    vi.useRealTimers();
    wrapper.unmount();
  });
});
