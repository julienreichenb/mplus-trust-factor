import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { WOW_ICON_CDN_BASE, WOW_ICON_FALLBACK_DATA_URI } from "../../lib/wowIcons";
import WowIcon from "./WowIcon.vue";

describe("WowIcon", () => {
  it("renders an allowlisted CDN URL from an identifier", () => {
    const wrapper = mount(WowIcon, {
      props: { iconName: "ability_warrior_shieldbash.jpg", alt: "" },
    });
    const img = wrapper.get("[data-testid='wow-icon']");
    expect(img.attributes("src")).toBe(`${WOW_ICON_CDN_BASE}/ability_warrior_shieldbash.jpg`);
    expect(img.attributes("alt")).toBe("");
    expect(img.attributes("loading")).toBe("lazy");
    expect(img.attributes("width")).toBe("40");
    expect(img.attributes("height")).toBe("40");
  });

  it("uses the neutral fallback when no icon is provided", () => {
    const wrapper = mount(WowIcon, { props: { alt: "" } });
    expect(wrapper.get("[data-testid='wow-icon']").attributes("src")).toBe(WOW_ICON_FALLBACK_DATA_URI);
    expect(wrapper.get("[data-testid='wow-icon']").attributes("data-fallback")).toBe("true");
  });

  it("rejects URL pass-through and shows fallback", () => {
    const wrapper = mount(WowIcon, {
      props: { iconName: "https://evil.example/x.jpg", alt: "" },
    });
    expect(wrapper.get("[data-testid='wow-icon']").attributes("src")).toBe(WOW_ICON_FALLBACK_DATA_URI);
  });

  it("switches to fallback on image error only once", async () => {
    const wrapper = mount(WowIcon, {
      props: { iconName: "ability_warrior_shieldbash", alt: "" },
    });
    await wrapper.get("img").trigger("error");
    expect(wrapper.get("[data-testid='wow-icon']").attributes("src")).toBe(WOW_ICON_FALLBACK_DATA_URI);
    await wrapper.get("img").trigger("error");
    expect(wrapper.get("[data-testid='wow-icon']").attributes("src")).toBe(WOW_ICON_FALLBACK_DATA_URI);
    expect(wrapper.get("[data-testid='wow-icon']").attributes("data-fallback")).toBe("true");
  });

  it("does not recurse when the fallback tile errors", async () => {
    const wrapper = mount(WowIcon, { props: { alt: "" } });
    const before = wrapper.get("[data-testid='wow-icon']").attributes("src");
    await wrapper.get("img").trigger("error");
    await wrapper.get("img").trigger("error");
    expect(wrapper.get("[data-testid='wow-icon']").attributes("src")).toBe(before);
    expect(before).toBe(WOW_ICON_FALLBACK_DATA_URI);
  });
});
