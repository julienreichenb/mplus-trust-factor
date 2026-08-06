import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import AdminScoringPage from "./AdminScoringPage.vue";

describe("AdminScoringPage", () => {
  async function mountPage() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/admin/scoring", component: AdminScoringPage }],
    });
    await router.push("/admin/scoring");
    await router.isReady();

    return mount(AdminScoringPage, {
      global: {
        plugins: [router],
        stubs: {
          ScoringOverviewPanel: { template: "<div data-testid='overview-panel' />" },
          scoringEvidencePanel: true,
          scoringConcurrencyPanel: true,
          scoringDiagnosticsPanel: true,
          scoringHistoryPanel: true,
        },
      },
    });
  }

  it("renders control center tabs and defaults to Overview", async () => {
    const wrapper = await mountPage();

    expect(wrapper.get("#scoring-cc-title").text()).toContain("Scoring Control Center");
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs).toHaveLength(5);
    expect(tabs[0]!.attributes("aria-selected")).toBe("true");
    expect(tabs[0]!.attributes("tabindex")).toBe("0");
    expect(tabs[1]!.attributes("tabindex")).toBe("-1");
    expect(wrapper.find("[data-testid='overview-panel']").exists()).toBe(true);

    await tabs[3]!.trigger("click");
    expect(wrapper.findAll('[role="tab"]')[3]!.attributes("aria-selected")).toBe("true");
  });

  it("exposes WAI-ARIA tablist/tab/tabpanel and supports arrow keys", async () => {
    const wrapper = await mountPage();

    const tablist = wrapper.get('[role="tablist"]');
    expect(tablist.attributes("aria-label")).toContain("Scoring V2");

    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs[0]!.attributes("aria-controls")).toBe("scoring-panel-overview");
    expect(wrapper.get('[role="tabpanel"]').attributes("aria-labelledby")).toBe(
      "scoring-tab-overview",
    );

    await tablist.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.findAll('[role="tab"]')[1]!.attributes("aria-selected")).toBe("true");
    expect(wrapper.findAll('[role="tab"]')[1]!.attributes("tabindex")).toBe("0");
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes("tabindex")).toBe("-1");

    await tablist.trigger("keydown", { key: "End" });
    expect(wrapper.findAll('[role="tab"]')[4]!.attributes("aria-selected")).toBe("true");

    await tablist.trigger("keydown", { key: "Home" });
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes("aria-selected")).toBe("true");
  });
});
