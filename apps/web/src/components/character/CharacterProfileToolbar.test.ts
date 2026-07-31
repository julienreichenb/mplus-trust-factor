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
      ["STALE", "Stale", "refresh-state"],
      ["FRESH", "Up to date", "refresh-state"],
    ];
    for (const [status, label, testIdOrClass] of cases) {
      const wrapper = mount(CharacterProfileToolbar, {
        props: { profile: profile(status) },
        global: {
          stubs: { RouterLink: { template: "<a><slot /></a>" } },
        },
      });
      const chip =
        testIdOrClass.startsWith("refresh-status")
          ? wrapper.get(`[data-testid='${testIdOrClass}']`)
          : wrapper.get(".refresh-state");
      expect(chip.text()).toContain(label);
      wrapper.unmount();
    }
  });
});
