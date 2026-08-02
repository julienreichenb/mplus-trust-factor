import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const fetchAuthMe = vi.fn(async () => ({ authenticated: false }));
const authenticated = ref(false);

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
      score: null,
      entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
      redFlags: [],
      warnings: [],
      performanceSummary: null,
      wclVisibility: "PUBLIC",
      wclDataState: "OK",
      explainabilityV2: null,
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

describe("CharacterPage explainabilityV2 compatibility", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    authenticated.value = false;
    fetchAuthMe.mockResolvedValue({ authenticated: false });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders normally when explainabilityV2 is null and never shows admin fields", async () => {
    const wrapper = mount(CharacterPage, {
      props: { region: "eu", realm: "tarren-mill", name: "Aleria" },
      global: {
        stubs: {
          CharacterPortraitStage: true,
          ScoreHeader: true,
          DimensionCards: true,
          AuthenticitySection: true,
          WclVisibilityBanner: true,
          KeySignalsPanel: true,
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
    expect(wrapper.html()).not.toMatch(/manifestContentHash|inputFingerprint|reportCode|scoreModelId/i);
  });
});
