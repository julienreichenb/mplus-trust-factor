import { describe, expect, it } from "vitest";
import { foldDiacritics, normalizeRealmSearchKey } from "./index.js";

describe("foldDiacritics", () => {
  it("folds accents for search keys while preserving base letters", () => {
    expect(foldDiacritics("Chérith")).toBe("cherith");
    expect(normalizeRealmSearchKey("Chérith")).toBe("cherith");
    expect(foldDiacritics("Kazzak")).toBe("kazzak");
  });
});
