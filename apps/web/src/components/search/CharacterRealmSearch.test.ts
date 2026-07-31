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
    await wrapper.get("form").trigger("submit");
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
    expect(wrapper.get('[data-testid="region-select"]').element).toBeTruthy();
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
    );
  });

  it("requests name autocomplete with selected region after 2 characters", async () => {
    searchCharacters.mockResolvedValue([
      {
        name: "Wallidrixe",
        realmSlug: "archimonde",
        realmName: "Archimonde",
        region: "EU",
        classSlug: "mage",
        specSlug: null,
        avatarUrl: null,
        classIconUrl: null,
      },
    ]);
    const wrapper = await mountSearch();
    await wrapper.get('[data-testid="character-name-input"]').setValue("Wa");
    await new Promise((r) => setTimeout(r, 300));
    expect(searchCharacters).toHaveBeenCalledWith("EU", "Wa", expect.any(AbortSignal));
  });

  it("shows local-suggestion helper and still submits when autocomplete is empty", async () => {
    resolveCharacter.mockResolvedValue({
      status: "READY",
      characterId: "c1",
      profilePath: "/character/EU/archimonde/Unknownexact",
    });
    searchCharacters.mockResolvedValue([]);
    const wrapper = await mountSearch();
    expect(wrapper.get('[data-testid="character-search-helper"]').text()).toContain(
      "indexed M+ Trust Factor profiles",
    );
    expect(wrapper.text()).not.toMatch(/character not found/i);

    await wrapper.get('[data-testid="character-name-input"]').setValue("Unknownexact");
    await wrapper.get('[data-testid="realm-combobox-input"]').setValue("Arch");
    await new Promise((r) => setTimeout(r, 250));
    await wrapper.get('[data-testid="realm-option-archimonde"]').trigger("mousedown");
    await wrapper.get("form").trigger("submit");
    await new Promise((r) => setTimeout(r, 50));
    expect(resolveCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Unknownexact",
        realmSlug: "archimonde",
        region: "EU",
      }),
    );
  });

  it("clears a realm from another region when region changes", async () => {
    const wrapper = await mountSearch();
    await wrapper.get('[data-testid="realm-combobox-input"]').setValue("Arch");
    await new Promise((r) => setTimeout(r, 250));
    await wrapper.get('[data-testid="realm-option-archimonde"]').trigger("mousedown");
    expect((wrapper.get('[data-testid="realm-combobox-input"]').element as HTMLInputElement).value).toContain(
      "Archimonde",
    );
    await wrapper.get('[data-testid="region-select"]').setValue("US");
    await wrapper.vm.$nextTick();
    expect((wrapper.get('[data-testid="realm-combobox-input"]').element as HTMLInputElement).value).toBe("");
  });

  it("loads realm options on focus", async () => {
    const wrapper = await mountSearch();
    await wrapper.get('[data-testid="realm-combobox-input"]').trigger("focus");
    await new Promise((r) => setTimeout(r, 50));
    expect(searchRealms).toHaveBeenCalled();
  });

  it("selects a fuzzy persisted character suggestion", async () => {
    searchCharacters.mockResolvedValue([
      {
        name: "Wallidrixe",
        realmSlug: "archimonde",
        realmName: "Archimonde",
        region: "EU",
        classSlug: "mage",
        specSlug: null,
        avatarUrl: null,
        classIconUrl: null,
      },
    ]);
    resolveCharacter.mockResolvedValue({
      status: "READY",
      characterId: "c1",
      profilePath: "/character/EU/archimonde/Wallidrixe",
    });
    const wrapper = await mountSearch();
    await wrapper.get('[data-testid="character-name-input"]').setValue("wallidrxie");
    await new Promise((r) => setTimeout(r, 300));
    await wrapper.get('[data-testid="character-option-archimonde-Wallidrixe"]').trigger("mousedown");
    await wrapper.get("form").trigger("submit");
    await new Promise((r) => setTimeout(r, 50));
    expect(resolveCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Wallidrixe",
        realmSlug: "archimonde",
        region: "EU",
      }),
    );
  });
});
