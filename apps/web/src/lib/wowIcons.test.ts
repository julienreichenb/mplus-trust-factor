import { describe, expect, it } from "vitest";
import {
  WOW_ICON_CDN_BASE,
  WOW_ICON_FALLBACK_DATA_URI,
  filterOptionIconName,
  normalizeWowIconName,
  roleIconName,
  wowIconSrc,
  wowIconUrl,
} from "./wowIcons";

describe("wowIcons", () => {
  it("normalizes names with and without extensions", () => {
    expect(normalizeWowIconName("inv_misc_questionmark.jpg")).toBe("inv_misc_questionmark");
    expect(wowIconUrl("inv_misc_questionmark.jpg")).toBe(
      `${WOW_ICON_CDN_BASE}/inv_misc_questionmark.jpg`,
    );
  });

  it("provides a neutral fallback src", () => {
    expect(wowIconSrc(null)).toBe(WOW_ICON_FALLBACK_DATA_URI);
  });

  it("maps class and role filter icon identifiers locally", () => {
    expect(filterOptionIconName("class", "mage")).toBe("classicon_mage");
    expect(roleIconName("TANK")).toBe("ability_warrior_defensivestance");
    expect(roleIconName("HEALER")).toBe("spell_holy_flashheal");
    expect(roleIconName("DPS")).toBe("ability_dualwield");
    expect(filterOptionIconName("class", "")).toBeNull();
    expect(filterOptionIconName("role", "UNKNOWN")).toBeNull();
  });

  it("rejects URL pass-through", () => {
    expect(normalizeWowIconName(`${WOW_ICON_CDN_BASE}/classicon_mage.jpg`)).toBeNull();
    expect(wowIconUrl("https://evil.example/x.jpg")).toBeNull();
  });
});
