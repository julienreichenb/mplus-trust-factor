import { describe, expect, it } from "vitest";
import {
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
  it("ranks exact before prefix before contains", () => {
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
});
