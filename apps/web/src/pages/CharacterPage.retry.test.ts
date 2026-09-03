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
    refreshStatus: "FAILED" as const,
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS" as const,
    entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
    warnings: [],
    media: null,
  };
}

describe("CharacterPage public score Retry", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    canForceRefresh.value = false;
    vi.clearAllMocks();
    getCharacterProfile.mockResolvedValue(queuedNoScoreProfile());
    getRefreshStatus.mockResolvedValue({
      characterId: "c-queued",
      refreshStatus: "FAILED",
      job: {
        jobId: "job-failed",
        queue: "refresh-character",
        status: "failed",
        dedupeKey: null,
        createdAt: "2026-07-20T12:00:00.000Z",
        startedAt: "2026-07-20T12:00:01.000Z",
        finishedAt: "2026-07-20T12:01:00.000Z",
        errorMessage: "Provider timeout",
      },
      cooldownSecondsRemaining: 0,
    });
  });

  it("shows loading failure Retry and does not call protected refresh endpoint", async () => {
    const wrapper = mount(CharacterPage, {
      props: { region: "EU", realm: "tarren-mill", name: "Newchar" },
      global: {
        stubs: {
          CharacterRealmSearch: true,
          CharacterPortraitStage: true,
          CharacterProfileToolbar: true,
          CharacterRefreshEta: true,
          DimensionCards: true,
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
          HeroInsightAccordion: true,
        },
      },
    });

    await flushPromises();
    await nextTick();

    const panel = wrapper.find("[data-testid='character-score-loading']");
    expect(panel.exists()).toBe(true);
    expect(panel.attributes("data-phase")).toBe("failed");

    refreshCharacter.mockClear();
    getCharacterProfile.mockClear();
    getRefreshStatus.mockClear();

    await wrapper.get("[data-testid='character-score-loading-retry']").trigger("click");
    await flushPromises();

    expect(refreshCharacter).not.toHaveBeenCalled();
    expect(getCharacterProfile).toHaveBeenCalled();
    expect(getRefreshStatus).toHaveBeenCalled();
    wrapper.unmount();
  });
});
