import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import AdminScoringV2Page from "./AdminScoringV2Page.vue";

describe("AdminScoringV2Page", () => {
  it("renders control center tabs and defaults to Overview", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/admin/scoring-v2", component: AdminScoringV2Page }],
    });
    await router.push("/admin/scoring-v2");
    await router.isReady();

    const wrapper = mount(AdminScoringV2Page, {
      global: {
        plugins: [router],
        stubs: {
          ScoringV2OverviewPanel: { template: "<div data-testid='overview-panel' />" },
          ScoringV2EvidencePanel: true,
          ScoringV2ConcurrencyPanel: true,
          ScoringV2DiagnosticsPanel: true,
          ScoringV2HistoryPanel: true,
        },
      },
    });

    expect(wrapper.get("#scoring-v2-cc-title").text()).toContain("Scoring V2 Control Center");
    const tabs = wrapper.findAll(".tabs__btn");
    expect(tabs).toHaveLength(5);
    expect(tabs[0]!.classes()).toContain("tabs__btn--active");
    expect(wrapper.find("[data-testid='overview-panel']").exists()).toBe(true);

    await tabs[3]!.trigger("click");
    expect(wrapper.findAll(".tabs__btn")[3]!.classes()).toContain("tabs__btn--active");
  });
});
