import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const fetchAuthMe = vi.fn(async () => ({ authenticated: false }));
const authenticated = ref(false);

vi.mock("../../composables/useAuthSession", () => ({
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

vi.mock("../../api/client", () => ({
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
    })),
    refreshCharacter: vi.fn(),
    getRefreshStatus: vi.fn(),
  },
}));

vi.mock("../../composables/useRefreshPolling", () => ({
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

vi.mock("../../composables/useWowheadTooltips", () => ({
  useWowheadTooltips: () => undefined,
}));

vi.mock("../../integrations/wowhead/tooltips", () => ({
  loadWowheadTooltipScript: vi.fn(async () => "ready"),
  refreshWowheadTooltips: vi.fn(),
}));

import CharacterPage from "../../pages/CharacterPage.vue";

describe("CharacterPage Active Rerolls anonymous gate", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    authenticated.value = false;
    fetchAuthMe.mockResolvedValue({ authenticated: false });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does not call Active Rerolls HTTP when the viewer is anonymous", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    mount(CharacterPage, {
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
        },
      },
    });

    await flushPromises();
    await nextTick();

    const rerollCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/active-rerolls"),
    );
    expect(rerollCalls).toHaveLength(0);
    expect(fetchAuthMe).toHaveBeenCalled();
  });
});

describe("ScoreHeader MAIN chip", () => {
  it("shows MAIN only when displayedCharacterIsMain is true", async () => {
    const { default: ScoreHeader } = await import("../profile/ScoreHeader.vue");
    const profile = {
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
      sources: [],
    };

    const withMain = mount(ScoreHeader, {
      props: {
        profile: profile as never,
        activeRerolls: [],
        displayedCharacterIsMain: true,
      },
      global: {
        stubs: {
          TierGradeLetter: true,
          TrustRadarChart: true,
          HeroInsightAccordion: true,
          ActiveRerolls: true,
          MetaChip: true,
        },
      },
    });
    expect(withMain.find("[data-testid='displayed-main-chip']").text()).toBe("MAIN");

    const withoutMain = mount(ScoreHeader, {
      props: {
        profile: profile as never,
        activeRerolls: [],
        displayedCharacterIsMain: false,
      },
      global: {
        stubs: {
          TierGradeLetter: true,
          TrustRadarChart: true,
          HeroInsightAccordion: true,
          ActiveRerolls: true,
          MetaChip: true,
        },
      },
    });
    expect(withoutMain.find("[data-testid='displayed-main-chip']").exists()).toBe(false);
  });
});
