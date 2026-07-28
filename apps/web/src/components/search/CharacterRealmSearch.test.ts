import { mount } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import CharacterRealmSearch from "./CharacterRealmSearch.vue";

const searchRealms = vi.fn();
const resolveCharacter = vi.fn();
const searchCharacters = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    searchRealms: (...args: unknown[]) => searchRealms(...args),
    resolveCharacter: (...args: unknown[]) => resolveCharacter(...args),
    searchCharacters: (...args: unknown[]) => searchCharacters(...args),
  },
}));

vi.mock("../../stores/recentSearches", () => ({
  useRecentSearchesStore: () => ({
    items: [],
    add: vi.fn(),
    clear: vi.fn(),
  }),
}));

async function mountSearch() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      {
        path: "/character/:region/:realm/:name",
        name: "character",
        component: { template: "<div />" },
      },
    ],
  });
  await router.push("/");
  await router.isReady();
  return mount(CharacterRealmSearch, {
    global: { plugins: [router] },
  });
}

describe("CharacterRealmSearch", () => {
  beforeEach(() => {
    searchRealms.mockReset();
    resolveCharacter.mockReset();
    searchCharacters.mockReset();
    searchRealms.mockResolvedValue([
      {
        slug: "archimonde",
        name: "Archimonde",
        region: "EU",
        locale: "fr_FR",
        displayLabel: "Archimonde — EU",
      },
    ]);
    searchCharacters.mockResolvedValue([]);
  });

  it("validates required fields after submit", async () => {
    const wrapper = await mountSearch();
    await wrapper.get('[data-testid="search-submit"]').trigger("submit");
    expect(wrapper.text()).toContain("Enter a character name");
    expect(resolveCharacter).not.toHaveBeenCalled();
  });

  it("resolves an existing character after realm selection", async () => {
    resolveCharacter.mockResolvedValue({
      status: "READY",
      characterId: "c1",
      profilePath: "/character/EU/archimonde/Wallidrixe",
    });
    const wrapper = await mountSearch();
    await wrapper.get('[data-testid="character-name-input"]').setValue("Wallidrixe");
    await wrapper.get('[data-testid="realm-combobox-input"]').setValue("Arch");
    await new Promise((r) => setTimeout(r, 250));
    await wrapper.get('[data-testid="realm-option-archimonde"]').trigger("mousedown");
    await wrapper.get("form").trigger("submit");
    await new Promise((r) => setTimeout(r, 50));
    expect(resolveCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Wallidrixe",
        realmSlug: "archimonde",
        region: "EU",
      }),
      undefined,
    );
  });
});
