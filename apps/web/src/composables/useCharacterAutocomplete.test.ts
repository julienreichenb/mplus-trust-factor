import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { nextTick, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import {
  buildHybridSuggestions,
  resolveUnambiguousRealm,
  useCharacterAutocomplete,
} from "./useCharacterAutocomplete";
import type { CharacterAutocompleteSuggestion, RealmOption } from "../api/types";
import { REALM_REQUIRED_HINT } from "../lib/parseCharacterQuery";

const searchCharacters = vi.fn();
const searchRealms = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    searchCharacters: (...args: unknown[]) => searchCharacters(...args),
    searchRealms: (...args: unknown[]) => searchRealms(...args),
  },
}));

const aleria: CharacterAutocompleteSuggestion = {
  name: "Aleria",
  realmSlug: "tarren-mill",
  region: "EU",
  classSlug: "mage",
  specSlug: "fire",
  avatarUrl: null,
  classIconUrl: "https://example.com/mage.jpg",
  source: "character",
  kind: "indexed",
};

const realms: RealmOption[] = [
  { slug: "tarren-mill", name: "Tarren Mill" },
  { slug: "archimonde", name: "Archimonde" },
  { slug: "silvermoon", name: "Silvermoon" },
  { slug: "stormscale", name: "Stormscale" },
  { slug: "sylvanas", name: "Sylvanas" },
];

describe("resolveUnambiguousRealm", () => {
  it("returns the single fuzzy match", () => {
    expect(resolveUnambiguousRealm([{ slug: "archimonde", name: "Archimonde" }], "arch")).toEqual({
      slug: "archimonde",
      name: "Archimonde",
    });
  });

  it("returns null when multiple realms match", () => {
    expect(
      resolveUnambiguousRealm(
        [
          { slug: "silvermoon", name: "Silvermoon" },
          { slug: "stormscale", name: "Stormscale" },
        ],
        "s",
      ),
    ).toBeNull();
  });

  it("prefers an exact slug among multiple fuzzy hits", () => {
    expect(resolveUnambiguousRealm(realms.filter((r) => r.slug.startsWith("s")), "silvermoon")).toEqual({
      slug: "silvermoon",
      name: "Silvermoon",
    });
  });
});

describe("buildHybridSuggestions", () => {
  it("keeps known indexed characters", () => {
    const results = buildHybridSuggestions({
      region: "EU",
      query: "Ale",
      indexed: [aleria],
      realms: [],
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("indexed");
    expect(results[0]!.name).toBe("Aleria");
  });

  it("adds a synthetic resolve row for unknown Character-Realm", () => {
    const results = buildHybridSuggestions({
      region: "EU",
      query: "Wallidrixe-Archimonde",
      indexed: [],
      realms: [{ slug: "archimonde", name: "Archimonde" }],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "resolve",
      name: "Wallidrixe",
      realmSlug: "archimonde",
      label: "Search Wallidrixe — Archimonde",
      classSlug: null,
      classIconUrl: null,
    });
  });

  it("resolves a partial realm slug unambiguously", () => {
    const results = buildHybridSuggestions({
      region: "EU",
      query: "Wallidrixe-arch",
      indexed: [],
      realms: [{ slug: "archimonde", name: "Archimonde" }],
    });
    expect(results[0]!.realmSlug).toBe("archimonde");
    expect(results[0]!.label).toBe("Search Wallidrixe — Archimonde");
  });

  it("does not add a resolve row for an invalid realm", () => {
    const results = buildHybridSuggestions({
      region: "EU",
      query: "Wallidrixe-NoSuchRealm",
      indexed: [],
      realms: [],
    });
    expect(results).toEqual([]);
  });

  it("does not add a resolve row when realm matches are ambiguous", () => {
    const results = buildHybridSuggestions({
      region: "EU",
      query: "Wallidrixe-s",
      indexed: [],
      realms: [
        { slug: "silvermoon", name: "Silvermoon" },
        { slug: "stormscale", name: "Stormscale" },
      ],
    });
    expect(results).toEqual([]);
  });

  it("shows realm-required hint for unknown name without realm", () => {
    const results = buildHybridSuggestions({
      region: "EU",
      query: "Wallidrixe",
      indexed: [],
      realms: [],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "hint",
      label: REALM_REQUIRED_HINT,
      realmSlug: "",
    });
  });

  it("does not duplicate resolve when the character is already indexed", () => {
    const results = buildHybridSuggestions({
      region: "EU",
      query: "Aleria-tarren-mill",
      indexed: [aleria],
      realms: [{ slug: "tarren-mill", name: "Tarren Mill" }],
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("indexed");
  });
});

describe("useCharacterAutocomplete hybrid", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchCharacters.mockReset();
    searchRealms.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges indexed hits with a synthetic resolve after debounce", async () => {
    searchCharacters.mockResolvedValue([]);
    searchRealms.mockResolvedValue([{ slug: "archimonde", name: "Archimonde" }]);

    const region = ref("EU");
    const query = ref("");
    const ac = useCharacterAutocomplete(region, query, 250);

    query.value = "Wallidrixe-Archimonde";
    await nextTick();
    vi.advanceTimersByTime(250);
    await flushPromises();

    expect(searchCharacters).toHaveBeenCalled();
    expect(searchRealms).toHaveBeenCalledWith("EU", "Archimonde", expect.anything());
    expect(ac.suggestions.value).toHaveLength(1);
    expect(ac.suggestions.value[0]!.kind).toBe("resolve");
    expect(ac.suggestions.value[0]!.label).toBe("Search Wallidrixe — Archimonde");
  });

  it("resolves space-separated Character Realm queries", async () => {
    searchCharacters.mockResolvedValue([]);
    searchRealms.mockResolvedValue([{ slug: "archimonde", name: "Archimonde" }]);

    const region = ref("EU");
    const query = ref("");
    const ac = useCharacterAutocomplete(region, query, 0);

    await ac.search("wallidrixe archimonde");
    expect(searchRealms).toHaveBeenCalledWith("EU", "archimonde", expect.anything());
    expect(ac.suggestions.value[0]!.realmSlug).toBe("archimonde");
  });
});
