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
    seasonSummary: { mythicRating: 2145.2 },
    equipment: {
      equippedItemLevel: 668,
      averageItemLevel: 667,
      items: [{ slot: "HEAD", name: "Test Helm", itemLevel: 668 }],
      keyItems: [],
    },
    talents: {
      summary: "Fire loadout",
      loadoutCode: "ABC",
      selectedTalents: [],
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

const pageStubs = {
  CharacterRealmSearch: true,
  CharacterProfileToolbar: true,
  BoostSuspicionSection: true,
  BoostSuspicionAlertDialog: true,
  RunDetailsDrawer: true,
  WclVisibilityBanner: true,
  MethodologyPanel: true,
  AppToast: true,
  StatusBanner: true,
  HeroGearPanel: true,
  HeroTalentPanel: true,
  TrustRadarChart: true,
};

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
        queuePosition: 4,
        estimatedWaitSeconds: 180,
        estimateConfidence: "MEDIUM",
        schedulingState: "RUNNING",
      },
      cooldownSecondsRemaining: 0,
    });
  });

  it("renders ScoreHeader-shaped progressive profile with score skeletons only", async () => {
    const wrapper = mount(CharacterPage, {
      props: { region: "EU", realm: "tarren-mill", name: "Newchar" },
      global: {
        stubs: {
          ...pageStubs,
          CharacterRefreshEta: true,
        },
      },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find("[data-testid='score-header']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='character-score-loading']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='character-score-loading']").attributes("data-phase")).toBe(
      "calculating",
    );
    expect(wrapper.find(".portrait-stage").exists()).toBe(true);
    expect(wrapper.find("[data-testid='score-loading-name']").text()).toContain("Newchar");
    expect(wrapper.find("[data-testid='score-loading-realm']").text()).toMatch(/tarren-mill/i);
    expect(wrapper.find("[data-testid='score-loading-class']").text()).toMatch(/Fire Mage/i);
    expect(wrapper.find("[data-testid='score-loading-role']").text()).toContain("DPS");
    expect(wrapper.find("[data-testid='insight-accordion']").exists()).toBe(true);
    expect(wrapper.text()).toMatch(/Character gear/i);
    expect(wrapper.text()).toMatch(/Specialization/i);
    expect(wrapper.find("[data-testid='score-loading-grade-skeleton']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='score-loading-radar-skeleton']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='dimension-cards']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='overall-score']").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/Grade unavailable/i);
    expect(wrapper.text()).not.toMatch(/\/\s*100/);
    wrapper.unmount();
  });

  it("integrates ETA into ScoreHeader without duplicating standalone ETA", async () => {
    const wrapper = mount(CharacterPage, {
      props: { region: "EU", realm: "tarren-mill", name: "Newchar" },
      global: { stubs: pageStubs },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find("[data-testid='character-score-loading']").text()).toMatch(
      /queue wait about 2–5 min/i,
    );
    expect(wrapper.find("[data-testid='score-loading-jobs-ahead']").text()).toMatch(
      /Approximately 4 jobs ahead/i,
    );
    expect(wrapper.find("[data-testid='refresh-eta']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("omits duration when no reliable queue-wait estimate exists", async () => {
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
        queuePosition: null,
        estimatedWaitSeconds: null,
        estimateConfidence: "LOW",
        schedulingState: "RUNNING",
      },
      cooldownSecondsRemaining: 0,
    });

    const wrapper = mount(CharacterPage, {
      props: { region: "EU", realm: "tarren-mill", name: "Newchar" },
      global: { stubs: { ...pageStubs, CharacterRefreshEta: true } },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find("[data-testid='character-score-loading']").text()).toContain(
      "Trust Score in progress",
    );
    expect(wrapper.find("[data-testid='character-score-loading']").text()).not.toMatch(
      /queue wait/i,
    );
    expect(wrapper.find("[data-testid='score-loading-jobs-ahead']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("replaces loading chrome with published score content without a reload", async () => {
    vi.useFakeTimers();
    const wrapper = mount(CharacterPage, {
      props: { region: "EU", realm: "tarren-mill", name: "Newchar" },
      global: {
        stubs: {
          ...pageStubs,
          CharacterPortraitStage: true,
          CharacterRefreshEta: true,
          DimensionCards: true,
        },
      },
    });

    await flushPromises();
    expect(wrapper.find("[data-testid='character-score-loading']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='score-loading-grade-skeleton']").exists()).toBe(true);

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
    expect(wrapper.find("[data-testid='score-header']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='overall-score']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='score-loading-grade-skeleton']").exists()).toBe(false);
    vi.useRealTimers();
    wrapper.unmount();
  });
});
