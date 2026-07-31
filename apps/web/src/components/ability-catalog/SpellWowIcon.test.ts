import { describe, expect, it, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { WOW_ICON_CDN_BASE, WOW_ICON_FALLBACK_DATA_URI } from "../../lib/wowIcons";
import * as spellIcons from "../../integrations/wowhead/spellIcons";
import SpellWowIcon from "./SpellWowIcon.vue";

describe("SpellWowIcon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the provided icon name without fetching", async () => {
    const resolveSpy = vi.spyOn(spellIcons, "resolveWowheadSpellIconName");
    const wrapper = mount(SpellWowIcon, {
      props: { iconName: "ability_warrior_pummel", spellId: 6552, alt: "" },
    });
    await flushPromises();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(wrapper.get("[data-testid='wow-icon']").attributes("src")).toBe(
      `${WOW_ICON_CDN_BASE}/ability_warrior_pummel.jpg`,
    );
  });

  it("resolves a missing icon name from the spell id", async () => {
    vi.spyOn(spellIcons, "resolveWowheadSpellIconName").mockResolvedValue(
      "ability_warrior_offensivestance",
    );
    const wrapper = mount(SpellWowIcon, {
      props: { iconName: null, spellId: 386164, alt: "" },
    });
    await flushPromises();
    expect(wrapper.get("[data-testid='wow-icon']").attributes("src")).toBe(
      `${WOW_ICON_CDN_BASE}/ability_warrior_offensivestance.jpg`,
    );
  });

  it("keeps the fallback when resolution fails", async () => {
    vi.spyOn(spellIcons, "resolveWowheadSpellIconName").mockResolvedValue(null);
    const wrapper = mount(SpellWowIcon, {
      props: { spellId: 1, alt: "" },
    });
    await flushPromises();
    expect(wrapper.get("[data-testid='wow-icon']").attributes("src")).toBe(WOW_ICON_FALLBACK_DATA_URI);
  });
});
