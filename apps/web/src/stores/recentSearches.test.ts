import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useRecentSearchesStore } from "./recentSearches";

describe("useRecentSearchesStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("retains at most 8 entries, most recent first, deduped", () => {
    const store = useRecentSearchesStore();
    for (let i = 0; i < 10; i++) {
      store.add({ region: "EU", realmSlug: "archimonde", name: `Char${i}` });
    }
    expect(store.items).toHaveLength(8);
    expect(store.items[0]?.name).toBe("Char9");
    expect(store.items[7]?.name).toBe("Char2");

    store.add({ region: "EU", realmSlug: "archimonde", name: "Char9", classSlug: "mage" });
    expect(store.items).toHaveLength(8);
    expect(store.items[0]?.name).toBe("Char9");
    expect(store.items[0]?.classSlug).toBe("mage");
  });

  it("persists only public presentation fields", () => {
    const store = useRecentSearchesStore();
    store.add({
      region: "EU",
      realmSlug: "archimonde",
      name: "Wallidrixe",
      classSlug: "mage",
      avatarUrl: "https://example.com/a.png",
    });
    const raw = JSON.parse(localStorage.getItem("mplus.recentSearches")!);
    expect(raw[0]).toEqual({
      region: "EU",
      realmSlug: "archimonde",
      name: "Wallidrixe",
      classSlug: "mage",
      avatarUrl: "https://example.com/a.png",
    });
    expect(raw[0]).not.toHaveProperty("characterId");
    expect(raw[0]).not.toHaveProperty("battletag");
  });
});
