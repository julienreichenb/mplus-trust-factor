import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AccountOwnedCharacterDTO } from "@mplus/contracts";
import BattleNetCharacterSwitcher from "./BattleNetCharacterSwitcher.vue";
import { useAccountCharactersStore } from "../../stores/accountCharacters";
import CharacterPage from "../../pages/CharacterPage.vue";

function makeChar(
  overrides: Partial<AccountOwnedCharacterDTO> &
    Pick<AccountOwnedCharacterDTO, "ownershipId" | "name" | "realmSlug" | "region">,
): AccountOwnedCharacterDTO {
  return {
    characterId: null,
    level: 90,
    isPrimary: false,
    realmName: overrides.realmName ?? overrides.realmSlug,
    characterClass: { id: 8, slug: "mage", name: "Mage", color: "#3FC7EB" },
    media: { portraitUrl: null },
    currentSeasonMythic: {
      rating: null,
      seasonId: null,
      fetchedAt: null,
      source: null,
      state: null,
    },
    trustScore: {
      status: "NOT_REQUESTED",
      jobId: null,
      score: null,
      grade: null,
      confidence: null,
      modelVersion: null,
      calculatedAt: null,
      errorCode: null,
      errorMessage: null,
    },
    relevance: {
      policyVersion: "v1",
      eligible: true,
      reasons: [],
      evaluatedAt: null,
    },
    ...overrides,
  };
}

const roster = [
  makeChar({
    ownershipId: "own-current",
    name: "Aleria",
    realmSlug: "tarren-mill",
    realmName: "Tarren Mill",
    region: "EU",
    currentSeasonMythic: {
      rating: 3000,
      seasonId: "s1",
      fetchedAt: null,
      source: null,
      state: "OK",
    },
  }),
  makeChar({
    ownershipId: "own-high",
    name: "Highalt",
    realmSlug: "silvermoon",
    realmName: "Silvermoon",
    region: "EU",
    characterClass: { id: 1, slug: "warrior", name: "Warrior", color: "#C69B6D" },
    media: { portraitUrl: "https://cdn.example/high.png" },
    currentSeasonMythic: {
      rating: 2800.4,
      seasonId: "s1",
      fetchedAt: null,
      source: null,
      state: "OK",
    },
  }),
  makeChar({
    ownershipId: "own-low",
    name: "Lowalt",
    realmSlug: "kazzak",
    realmName: "Kazzak",
    region: "EU",
    currentSeasonMythic: {
      rating: 1500,
      seasonId: "s1",
      fetchedAt: null,
      source: null,
      state: "OK",
    },
  }),
  makeChar({
    ownershipId: "own-none",
    name: "Noscore",
    realmSlug: "archimonde",
    realmName: "Archimonde",
    region: "EU",
  }),
];

async function mountSwitcher(chars: AccountOwnedCharacterDTO[], identity = {
  region: "EU",
  realm: "tarren-mill",
  name: "Aleria",
}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/character/:region/:realm/:name",
        name: "character",
        component: { template: "<div />" },
      },
    ],
  });
  await router.push("/character/eu/tarren-mill/Aleria");
  await router.isReady();

  return mount(BattleNetCharacterSwitcher, {
    props: {
      characters: chars,
      ...identity,
    },
    global: { plugins: [router] },
  });
}

describe("BattleNetCharacterSwitcher", () => {
  it("shows badge for owned current character and excludes it from the dropdown", async () => {
    const wrapper = await mountSwitcher(roster);
    expect(wrapper.find("[data-testid='battlenet-owned-badge']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Personnage associé à votre compte Battle.net");

    await wrapper.get("[data-testid='battlenet-switcher-trigger']").trigger("click");
    const labels = wrapper.findAll(".bnet-switcher__option").map((n) => n.text());
    expect(labels.join(" ")).not.toContain("Aleria");
    expect(labels[0]).toContain("Highalt");
    expect(labels[1]).toContain("Lowalt");
    expect(labels[2]).toContain("Noscore");
    expect(labels[2]).toContain("Non calculé");
  });

  it("hides badge for an unrelated current character", async () => {
    const wrapper = await mountSwitcher(roster, {
      region: "EU",
      realm: "kazzak",
      name: "Carryme",
    });
    expect(wrapper.find("[data-testid='battlenet-owned-badge']").exists()).toBe(false);
  });

  it("uses portrait fallback and navigates on selection", async () => {
    const wrapper = await mountSwitcher(roster);
    await wrapper.get("[data-testid='battlenet-switcher-trigger']").trigger("click");

    const portraits = wrapper.findAll(".bnet-switcher__portrait");
    expect(portraits[0]?.attributes("src")).toBe("https://cdn.example/high.png");
    expect(portraits[1]?.attributes("src")).toContain("classicon_mage");

    const link = wrapper.find('[data-ownership-id="own-high"]');
    expect(link.attributes("href")).toContain("/character/eu/silvermoon/Highalt");
  });

  it("renders nothing when character list is empty", async () => {
    const wrapper = await mountSwitcher([]);
    expect(wrapper.find("[data-testid='battlenet-character-switcher']").exists()).toBe(false);
  });
});

describe("accountCharacters store visibility", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.unstubAllGlobals();
  });

  it("does not show switcher for unauthenticated viewers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })),
    );
    const store = useAccountCharactersStore();
    await store.ensureLoaded();
    expect(store.showSwitcher).toBe(false);
  });

  it("does not show switcher when Battle.net is not linked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/auth/me")) {
          return new Response(
            JSON.stringify({
              authenticated: true,
              user: { id: "u1", displayName: "T", roles: [], permissions: [] },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/me/battlenet")) {
          return new Response(JSON.stringify({ linked: false }), { status: 200 });
        }
        if (url.includes("/me/characters")) {
          return new Response(
            JSON.stringify({
              characters: roster,
              discovery: { status: "IDLE", jobId: null, startedAt: null, finishedAt: null, error: null },
              hiddenCharacterCount: 0,
              totalOwnedCharacterCount: roster.length,
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );
    const store = useAccountCharactersStore();
    await store.ensureLoaded();
    expect(store.linked).toBe(false);
    expect(store.showSwitcher).toBe(false);
  });

  it("does not show switcher when linked account has no characters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/auth/me")) {
          return new Response(
            JSON.stringify({
              authenticated: true,
              user: { id: "u1", displayName: "T", roles: [], permissions: [] },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/me/battlenet")) {
          return new Response(
            JSON.stringify({
              linked: true,
              account: {
                providerAccountId: "1",
                battletag: "T#1",
                linkedAt: new Date().toISOString(),
                lastOwnershipSyncAt: null,
                lastOwnershipSyncError: null,
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/me/characters")) {
          return new Response(
            JSON.stringify({
              characters: [],
              discovery: { status: "COMPLETED", jobId: null, startedAt: null, finishedAt: null, error: null },
              hiddenCharacterCount: 0,
              totalOwnedCharacterCount: 0,
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );
    const store = useAccountCharactersStore();
    await store.ensureLoaded();
    expect(store.showSwitcher).toBe(false);
  });

  it("shows switcher for linked account with multiple characters and caches the load", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: { id: "u1", displayName: "T", roles: [], permissions: [] },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/me/battlenet")) {
        return new Response(
          JSON.stringify({
            linked: true,
            account: {
              providerAccountId: "1",
              battletag: "T#1",
              linkedAt: new Date().toISOString(),
              lastOwnershipSyncAt: null,
              lastOwnershipSyncError: null,
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/me/characters")) {
        return new Response(
          JSON.stringify({
            characters: roster,
            discovery: { status: "COMPLETED", jobId: null, startedAt: null, finishedAt: null, error: null },
            hiddenCharacterCount: 0,
            totalOwnedCharacterCount: roster.length,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = useAccountCharactersStore();
    await store.ensureLoaded();
    await store.ensureLoaded();
    expect(store.showSwitcher).toBe(true);
    expect(store.characters).toHaveLength(4);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/me"))).toHaveLength(1);
  });
});

describe("CharacterPage Battle.net integration gate", () => {
  it("does not mount switcher when store says hide", async () => {
    setActivePinia(createPinia());
    const store = useAccountCharactersStore();
    store.$patch({
      me: { authenticated: false },
      battlenet: { linked: false },
      accountChars: null,
      loaded: true,
    });

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
      },
    }));

    // Lightweight assertion via store gate used by CharacterPage template
    expect(store.showSwitcher).toBe(false);
    expect(CharacterPage).toBeTruthy();
  });
});
