import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminCalibrationPage from "./AdminCalibrationPage.vue";

describe("AdminCalibrationPage", () => {
  it("renders cohort list shell, model selectors, and expert-label framing", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/admin/calibration/:cohortId?", name: "admin-calibration", component: AdminCalibrationPage },
        {
          path: "/admin/calibration/runs/:runId",
          name: "admin-calibration-report",
          component: { template: "<div />" },
        },
      ],
    });
    await router.push({ name: "admin-calibration" });
    await router.isReady();

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/score-models")
        ? { models: [] }
        : { cohorts: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }) as unknown as Response;
    };

    const wrapper = mount(AdminCalibrationPage, {
      global: { plugins: [router] },
    });
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    expect(wrapper.text()).toContain("Calibration");
    expect(wrapper.text()).toContain("Expert labels are authoritative");
    expect(wrapper.text()).toContain("Create cohort");
    expect(wrapper.text()).toContain("Models & run mode");
    expect(wrapper.text()).toContain("Create draft from edited weights");
    expect(wrapper.text()).toContain("ACTIVE_VERSUS_DRAFT");
  });
});
