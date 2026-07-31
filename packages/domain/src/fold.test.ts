import { describe, expect, it } from "vitest";
import {
  CHARACTER_NAME_FUZZY_MIN_QUERY_LENGTH,
  foldDiacritics,
  normalizeCharacterSearchKey,
  normalizeRealmSearchKey,
  rankCharacterNameMatch,
} from "./index.js";

describe("foldDiacritics", () => {
  it("folds accents for search keys while preserving base letters", () => {
    expect(foldDiacritics("Chérith")).toBe("cherith");
    expect(normalizeRealmSearchKey("Chérith")).toBe("cherith");
    expect(foldDiacritics("Kazzak")).toBe("kazzak");
  });
});

describe("normalizeCharacterSearchKey", () => {
  it("mirrors foldDiacritics for character names", () => {
    expect(normalizeCharacterSearchKey("Chérith")).toBe("cherith");
  });
});

describe("rankCharacterNameMatch", () => {
  it("ranks exact before prefix before substring before fuzzy", () => {
    expect(
      rankCharacterNameMatch({
        queryFolded: "wall",
        nameFolded: "wall",
        source: "character",
      }),
    ).toBe(0);
    expect(
      rankCharacterNameMatch({
        queryFolded: "wall",
        nameFolded: "wallidrixe",
        source: "character",
      }),
    ).toBe(2);
    expect(
      rankCharacterNameMatch({
        queryFolded: "all",
        nameFolded: "wallidrixe",
        source: "character",
      }),
    ).toBe(3);
    expect(
      rankCharacterNameMatch({
        queryFolded: "wallidrxie",
        nameFolded: "wallidrixe",
        source: "character",
        fuzzyMatched: true,
      }),
    ).toBe(4);
  });

  it("ranks exact alias above prefix", () => {
    expect(
      rankCharacterNameMatch({
        queryFolded: "nick",
        nameFolded: "wallidrixe",
        aliasFolded: "nick",
        source: "alias",
      }),
    ).toBe(1);
  });

  it("keeps substring ahead of trigram-only fuzzy", () => {
    const substring = rankCharacterNameMatch({
      queryFolded: "lidrix",
      nameFolded: "wallidrixe",
      source: "character",
    });
    const fuzzy = rankCharacterNameMatch({
      queryFolded: "wallidrxie",
      nameFolded: "wallidrixe",
      source: "character",
      fuzzyMatched: true,
    });
    expect(substring).toBe(3);
    expect(fuzzy).toBe(4);
    expect(substring).toBeLessThan(fuzzy);
  });

  it("does not treat short queries as fuzzy-eligible by policy constant", () => {
    expect(CHARACTER_NAME_FUZZY_MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(3);
    expect("wa".length).toBeLessThan(CHARACTER_NAME_FUZZY_MIN_QUERY_LENGTH);
  });

  it("tie-breaks only via caller sort — ranks are deterministic for equal inputs", () => {
    const a = rankCharacterNameMatch({
      queryFolded: "walli",
      nameFolded: "wallidrixe",
      source: "character",
    });
    const b = rankCharacterNameMatch({
      queryFolded: "walli",
      nameFolded: "wallidrixe",
      source: "character",
    });
    expect(a).toBe(b);
    expect(a).toBe(2);
  });
});
