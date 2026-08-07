import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminCalibrationPage from "./AdminCalibrationPage.vue";
import { routeDefs } from "../routes";
import { PERSISTED_V6_SCORE_MODEL_CONFIG } from "../api/model-config/persisted-v6-fixture";
import { deepClone } from "../lib/clone";

const listModels = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listModels: (...args: unknown[]) => listModels(...args),
  },
}));

describe("AdminCalibrationPage shell", () => {
  beforeEach(() => {
    listModels.mockResolvedValue([
      {
        id: "active",
        key: "default",
        version: 6,
        name: "Production",
        status: "ACTIVE",
        config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
        createdAt: "2026-01-01T00:00:00.000Z",
        activatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders shell with model selector and upcoming workflow (no fake results)", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
    await router.push("/admin/calibration");
    await router.isReady();
    const wrapper = mount(AdminCalibrationPage, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain("Calibration");
    expect(wrapper.text()).not.toMatch(/Scoring V2/i);
    expect(wrapper.find("[data-testid='calibration-shell']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Coming next");
    expect(wrapper.text()).toContain("Label expected");
    wrapper.unmount();
  });
});
