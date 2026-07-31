import { describe, expect, it } from "vitest";
import {
  foldDiacritics,
  normalizeCharacterSearchKey,
  rankCharacterNameMatch,
} from "@mplus/domain";
import { PUBLIC_CHARACTER_AUTOCOMPLETE_LIMIT } from "./character-repository.js";

describe("character search ranking helpers", () => {
  it("exports public autocomplete bound of 8", () => {
    expect(PUBLIC_CHARACTER_AUTOCOMPLETE_LIMIT).toBe(8);
  });

  it("folds accents for name_search_key parity", () => {
    expect(normalizeCharacterSearchKey("Chérith")).toBe(foldDiacritics("Chérith"));
  });

  it("applies deterministic ladder: exact < alias < prefix < contains", () => {
    const exact = rankCharacterNameMatch({
      queryFolded: "wall",
      nameFolded: "wall",
      source: "character",
    });
    const alias = rankCharacterNameMatch({
      queryFolded: "nick",
      nameFolded: "wallidrixe",
      aliasFolded: "nick",
      source: "alias",
    });
    const prefix = rankCharacterNameMatch({
      queryFolded: "wall",
      nameFolded: "wallidrixe",
      source: "character",
    });
    const contains = rankCharacterNameMatch({
      queryFolded: "all",
      nameFolded: "wallidrixe",
      source: "character",
    });
    expect(exact).toBeLessThan(alias);
    expect(alias).toBeLessThan(prefix);
    expect(prefix).toBeLessThan(contains);
  });

  it("does not treat length-2 queries as fuzzy when fuzzyMatched is unset", () => {
    expect(
      rankCharacterNameMatch({
        queryFolded: "wa",
        nameFolded: "wallidrixe",
        source: "character",
        fuzzyMatched: false,
      }),
    ).toBe(2);
  });
});
