import { describe, expect, it } from "vitest";
import {
  WOW_ICON_CDN_BASE,
  WOW_ICON_CDN_ORIGIN,
  WOW_ICON_FALLBACK_DATA_URI,
  normalizeWowIconName,
  wowIconSrc,
  wowIconUrl,
} from "./wow-icons.js";

describe("normalizeWowIconName", () => {
  it("accepts a plain icon name", () => {
    expect(normalizeWowIconName("ability_warrior_offensivestance")).toBe(
      "ability_warrior_offensivestance",
    );
  });

  it("strips supported trailing extensions", () => {
    expect(normalizeWowIconName("inv_misc_questionmark.jpg")).toBe("inv_misc_questionmark");
    expect(normalizeWowIconName("icon.jpeg")).toBe("icon");
    expect(normalizeWowIconName("Spell_Holy_FlashHeal.PNG")).toBe("spell_holy_flashheal");
    expect(normalizeWowIconName("icon.webp")).toBe("icon");
  });

  it("lowercases uppercase names", () => {
    expect(normalizeWowIconName("Ability_Warrior_Pummel")).toBe("ability_warrior_pummel");
  });

  it("extracts the final basename from path-like legacy values", () => {
    expect(normalizeWowIconName("icons/large/classicon_mage.jpg")).toBe("classicon_mage");
    expect(normalizeWowIconName("foo\\bar\\ability_rogue_sprint")).toBe("ability_rogue_sprint");
  });

  it("removes query strings and fragments", () => {
    expect(normalizeWowIconName("ability_warrior_pummel.jpg?size=56")).toBe("ability_warrior_pummel");
    expect(normalizeWowIconName("ability_warrior_pummel#hash")).toBe("ability_warrior_pummel");
    expect(normalizeWowIconName("path/ability_warrior_pummel.png?x=1#y")).toBe("ability_warrior_pummel");
  });

  it("rejects double extensions that leave an unsafe stem", () => {
    expect(normalizeWowIconName("ability_warrior_pummel.jpg.jpg")).toBeNull();
  });

  it("rejects empty values", () => {
    expect(normalizeWowIconName("")).toBeNull();
    expect(normalizeWowIconName("   ")).toBeNull();
    expect(normalizeWowIconName(null)).toBeNull();
    expect(normalizeWowIconName(undefined)).toBeNull();
  });

  it("rejects traversal inputs", () => {
    expect(normalizeWowIconName("../")).toBeNull();
    expect(normalizeWowIconName("..")).toBeNull();
    expect(normalizeWowIconName("../evil")).toBeNull();
    expect(normalizeWowIconName("foo/../..")).toBeNull();
  });

  it("rejects HTTPS URL inputs", () => {
    expect(normalizeWowIconName(`${WOW_ICON_CDN_BASE}/classicon_mage.jpg`)).toBeNull();
    expect(normalizeWowIconName("https://evil.example/icons/large/x.jpg")).toBeNull();
  });

  it("rejects javascript and data URL inputs", () => {
    expect(normalizeWowIconName("javascript:alert(1)")).toBeNull();
    expect(normalizeWowIconName("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(normalizeWowIconName("//wow.zamimg.com/images/wow/icons/large/x.jpg")).toBeNull();
  });
});

describe("wowIconUrl", () => {
  it("builds a single-extension CDN URL from a safe identifier", () => {
    expect(wowIconUrl("ability_warrior_pummel")).toBe(
      `${WOW_ICON_CDN_BASE}/ability_warrior_pummel.jpg`,
    );
    expect(wowIconUrl("ability_warrior_pummel.jpg")).toBe(
      `${WOW_ICON_CDN_BASE}/ability_warrior_pummel.jpg`,
    );
    expect(WOW_ICON_CDN_BASE.startsWith(WOW_ICON_CDN_ORIGIN)).toBe(true);
  });

  it("never passes through arbitrary URLs", () => {
    expect(wowIconUrl("https://evil.example/x.jpg")).toBeNull();
    expect(wowIconUrl(`${WOW_ICON_CDN_BASE}/classicon_mage.jpg`)).toBeNull();
  });

  it("returns null when no safe identifier exists", () => {
    expect(wowIconUrl(undefined)).toBeNull();
    expect(wowIconUrl("")).toBeNull();
    expect(wowIconUrl("../x")).toBeNull();
  });
});

describe("wowIconSrc", () => {
  it("falls back to the neutral data URI", () => {
    expect(wowIconSrc(null)).toBe(WOW_ICON_FALLBACK_DATA_URI);
    expect(wowIconSrc("ability_rogue_sprint")).toContain("ability_rogue_sprint.jpg");
  });
});
