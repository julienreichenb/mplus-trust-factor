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
    for (const status of ["STALE", "FRESH", "FAILED"] as const) {
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

  it("exposes bootstrap repair when incomplete and not in-flight", () => {
    const wrapper = mount(CharacterProfileToolbar, {
      props: {
        profile: {
          ...profile("FAILED"),
          bootstrapRepairRequired: true,
          warnings: [
            {
              code: "CHARACTER_BOOTSTRAP_INCOMPLETE",
              message: "Profile data incomplete",
              severity: "WARN",
            },
          ],
        },
      },
      global: {
        stubs: { RouterLink: { template: "<a><slot /></a>" } },
      },
    });
    expect(wrapper.get("[data-testid='bootstrap-repair-button']").text()).toContain(
      "Retry Blizzard profile lookup",
    );
    expect(wrapper.get("[data-testid='refresh-button']").attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-testid='force-refresh-button']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("exposes repair via CHARACTER_BOOTSTRAP_INCOMPLETE without the boolean flag", () => {
    const wrapper = mount(CharacterProfileToolbar, {
      props: {
        profile: {
          ...profile("FAILED"),
          warnings: [
            {
              code: "CHARACTER_BOOTSTRAP_INCOMPLETE",
              message: "Profile data incomplete",
              severity: "WARN",
            },
          ],
        },
      },
      global: {
        stubs: { RouterLink: { template: "<a><slot /></a>" } },
      },
    });
    expect(wrapper.find("[data-testid='bootstrap-repair-button']").exists()).toBe(true);
    wrapper.unmount();
  });

  it("applies the narrow version-skew fallback for incomplete + eligibility-unknown", () => {
    const wrapper = mount(CharacterProfileToolbar, {
      props: {
        profile: {
          ...profile("QUEUED"),
          score: null,
          level: null,
          role: null,
          classSlug: null,
          specSlug: null,
          warnings: [
            {
              code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
              message: "unknown",
              severity: "WARN",
            },
          ],
        },
      },
      global: {
        stubs: { RouterLink: { template: "<a><slot /></a>" } },
      },
    });
    // Still in-flight from status, so repair stays hidden until status is reconciled.
    expect(wrapper.find("[data-testid='bootstrap-repair-button']").exists()).toBe(false);
    wrapper.unmount();

    const failed = mount(CharacterProfileToolbar, {
      props: {
        profile: {
          ...profile("FAILED"),
          score: null,
          level: null,
          role: null,
          classSlug: null,
          specSlug: null,
          warnings: [
            {
              code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
              message: "unknown",
              severity: "WARN",
            },
          ],
        },
      },
      global: {
        stubs: { RouterLink: { template: "<a><slot /></a>" } },
      },
    });
    expect(failed.find("[data-testid='bootstrap-repair-button']").exists()).toBe(true);
    failed.unmount();
  });

  it("hides repair CTA while a real in-flight refresh is shown", () => {
    const wrapper = mount(CharacterProfileToolbar, {
      props: {
        profile: {
          ...profile("QUEUED"),
          bootstrapRepairRequired: true,
          warnings: [
            {
              code: "CHARACTER_BOOTSTRAP_INCOMPLETE",
              message: "incomplete",
              severity: "WARN",
            },
          ],
        },
      },
      global: {
        stubs: { RouterLink: { template: "<a><slot /></a>" } },
      },
    });
    expect(wrapper.find("[data-testid='bootstrap-repair-button']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='refresh-status-queued']").exists()).toBe(true);
    wrapper.unmount();
  });
});
