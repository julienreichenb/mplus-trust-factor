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
  it("maps refresh statuses to English display labels", () => {
    const cases: Array<[CharacterProfileView["refreshStatus"], string, string]> = [
      ["QUEUED", "Queued", "refresh-status-queued"],
      ["REFRESHING", "Refreshing", "refresh-status-updating"],
      ["STALE", "Stale", "refresh-status-idle"],
      ["FRESH", "Up to date", "refresh-status-idle"],
    ];
    for (const [status, label, testId] of cases) {
      const wrapper = mount(CharacterProfileToolbar, {
        props: { profile: profile(status) },
        global: {
          stubs: { RouterLink: { template: "<a><slot /></a>" } },
        },
      });
      const chip = wrapper.get(`[data-testid='${testId}']`);
      expect(chip.text()).toContain(label);
      wrapper.unmount();
    }
  });
});
