import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminCalibrationPage from "./AdminCalibrationPage.vue";
import { routeDefs } from "../routes";
import { PERSISTED_V6_SCORE_MODEL_CONFIG } from "../api/model-config/persisted-v6-fixture";
import { deepClone } from "../lib/clone";

const listModels = vi.fn();
const listCalibrationCohorts = vi.fn();
const createCalibrationCohort = vi.fn();
const getCalibrationCohort = vi.fn();
const listCalibrationRuns = vi.fn();
const searchRealms = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listModels: (...args: unknown[]) => listModels(...args),
    listCalibrationCohorts: (...args: unknown[]) => listCalibrationCohorts(...args),
    createCalibrationCohort: (...args: unknown[]) => createCalibrationCohort(...args),
    getCalibrationCohort: (...args: unknown[]) => getCalibrationCohort(...args),
    listCalibrationRuns: (...args: unknown[]) => listCalibrationRuns(...args),
    searchRealms: (...args: unknown[]) => searchRealms(...args),
    patchCalibrationCohort: vi.fn(),
    deleteCalibrationCohort: vi.fn(),
    resolveCalibrationMember: vi.fn(),
    patchCalibrationMember: vi.fn(),
    deleteCalibrationMember: vi.fn(),
    createCalibrationRun: vi.fn(),
    getCalibrationRun: vi.fn(),
    getCalibrationReport: vi.fn(),
  },
}));

describe("AdminCalibrationPage", () => {
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
      {
        id: "draft",
        key: "default",
        version: 7,
        name: "Candidate",
        status: "DRAFT",
        config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
        createdAt: "2026-01-03T00:00:00.000Z",
        activatedAt: null,
      },
      {
        id: "archived",
        key: "default",
        version: 5,
        name: "Old",
        status: "ARCHIVED",
        config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
        createdAt: "2025-01-01T00:00:00.000Z",
        activatedAt: null,
      },
    ]);
    listCalibrationCohorts.mockResolvedValue([]);
    listCalibrationRuns.mockResolvedValue([]);
    searchRealms.mockResolvedValue([{ slug: "archimonde", name: "Archimonde" }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders calibration workflow (not the old shell) with cohort create and add-character", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
    await router.push("/admin/calibration");
    await router.isReady();
    const wrapper = mount(AdminCalibrationPage, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain("Calibration");
    expect(wrapper.text()).not.toContain("Coming next");
    expect(wrapper.find("[data-testid='create-cohort']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='add-character']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='calibration-model-select']").exists()).toBe(true);
    const options = wrapper.findAll("[data-testid='admin-select'] option");
    const labels = options.map((o) => o.text());
    expect(labels.some((l) => l.includes("ARCHIVED"))).toBe(false);
    expect(labels.some((l) => l.includes("ACTIVE"))).toBe(true);
    wrapper.unmount();
  });

  it("shows Open in Tuning when a DRAFT model is selected", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
    await router.push("/admin/calibration");
    await router.isReady();
    const wrapper = mount(AdminCalibrationPage, { global: { plugins: [router] } });
    await flushPromises();
    const selects = wrapper.findAll("[data-testid='admin-select']");
    const modelSelect = selects[selects.length - 1]!;
    await modelSelect.setValue("draft");
    await flushPromises();
    expect(wrapper.find("[data-testid='open-in-tuning']").exists()).toBe(true);
    wrapper.unmount();
  });
});
