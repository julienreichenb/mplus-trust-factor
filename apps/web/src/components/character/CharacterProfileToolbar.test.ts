import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import CharacterProfileToolbar from "./CharacterProfileToolbar.vue";
import type { CharacterProfileView } from "../../api/types";

function profile(refreshStatus: CharacterProfileView["refreshStatus"]): CharacterProfileView {
  return {
    region: "EU",
    realmSlug: "tarren-mill",
    displayName: "Aleria",
    refreshStatus,
  } as CharacterProfileView;
}

describe("CharacterProfileToolbar refresh labels", () => {
  it("puts busy status on the refresh button and hides the status chip", () => {
    const cases: Array<[CharacterProfileView["refreshStatus"], string, string]> = [
      ["QUEUED", "Queued", "refresh-status-queued"],
      ["REFRESHING", "Refreshing", "refresh-status-updating"],
    ];
    for (const [status, label, testId] of cases) {
      const wrapper = mount(CharacterProfileToolbar, {
        props: { profile: profile(status) },
        global: {
          stubs: { RouterLink: { template: "<a><slot /></a>" } },
        },
      });
      expect(wrapper.find(".status-chip").exists()).toBe(false);
      const button = wrapper.get(`[data-testid='${testId}']`);
      expect(button.text()).toContain(label);
      expect(button.classes()).toContain("refresh-btn--busy");
      expect(button.attributes("disabled")).toBeDefined();
      expect(button.find("[data-testid='refresh-button-spinner']").exists()).toBe(true);
      wrapper.unmount();
    }
  });

  it("shows idle refresh label without spinner", () => {
    for (const status of ["STALE", "FRESH"] as const) {
      const wrapper = mount(CharacterProfileToolbar, {
        props: { profile: profile(status) },
        global: {
          stubs: { RouterLink: { template: "<a><slot /></a>" } },
        },
      });
      const button = wrapper.get("[data-testid='refresh-button']");
      expect(button.text()).toBe("Refresh data");
      expect(button.find("[data-testid='refresh-button-spinner']").exists()).toBe(false);
      expect(button.classes()).not.toContain("refresh-btn--busy");
      wrapper.unmount();
    }
  });
});
