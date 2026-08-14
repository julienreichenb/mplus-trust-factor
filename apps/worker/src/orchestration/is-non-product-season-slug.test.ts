import { describe, expect, it } from "vitest";
import { isNonProductSeasonSlug, seasonAuthoritySlug } from "./season-authority.js";

describe("isNonProductSeasonSlug", () => {
  it("rejects technical and test slugs", () => {
    expect(isNonProductSeasonSlug("auto-current")).toBe(true);
    expect(isNonProductSeasonSlug("placeholder-current")).toBe(true);
    expect(isNonProductSeasonSlug("placeholder-foo")).toBe(true);
    expect(isNonProductSeasonSlug("pub-cancel-season")).toBe(true);
  });

  it("keeps regional Blizzard seasons including Season 1", () => {
    expect(isNonProductSeasonSlug(seasonAuthoritySlug(1))).toBe(false);
    expect(isNonProductSeasonSlug(seasonAuthoritySlug(18))).toBe(false);
  });
});
