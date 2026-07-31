import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminModelsPage from "./AdminModelsPage.vue";
import { routeDefs } from "../routes";
import { PERSISTED_V6_SCORE_MODEL_CONFIG } from "../api/model-config/persisted-v6-fixture";
import { deepClone } from "../lib/clone";
import type { AdminScoreModelDTO } from "../api/types";

const listModels = vi.fn();
const cloneModel = vi.fn();
const updateModel = vi.fn();
const validateModel = vi.fn();
const backtestModel = vi.fn();
const activateModel = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listModels: (...args: unknown[]) => listModels(...args),
    cloneModel: (...args: unknown[]) => cloneModel(...args),
    updateModel: (...args: unknown[]) => updateModel(...args),
    validateModel: (...args: unknown[]) => validateModel(...args),
    backtestModel: (...args: unknown[]) => backtestModel(...args),
    activateModel: (...args: unknown[]) => activateModel(...args),
  },
}));

function activeV6(): AdminScoreModelDTO {
  return {
    id: "model-active-6",
    key: "default",
    version: 6,
    name: "Default Trust Factor v6",
    status: "ACTIVE",
    config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
    createdAt: "2026-07-01T00:00:00.000Z",
    activatedAt: "2026-07-01T00:00:00.000Z",
  };
}

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeDefs,
  });
  await router.push("/admin/models");
  await router.isReady();
  const wrapper = mount(AdminModelsPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

describe("AdminModelsPage persisted v6 config", () => {
  beforeEach(() => {
    listModels.mockReset();
    cloneModel.mockReset();
    updateModel.mockReset();
    validateModel.mockReset();
    backtestModel.mockReset();
    activateModel.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a real v6 ACTIVE model without throw and shows version history", async () => {
    listModels.mockResolvedValue([activeV6()]);
    const wrapper = await mountPage();

    expect(wrapper.find("[data-testid='admin-page']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='models-load-error']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='config-malformed']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='model-list']").text()).toMatch(/ACTIVE/);
    expect(wrapper.get("[data-testid='model-list']").text()).toMatch(/v6/);
    expect(wrapper.get("[data-testid='selected-status']").text()).toBe("ACTIVE");
    expect(wrapper.find("[data-testid='metric-weights-PERFORMANCE']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='metric-weights-UTILITY']").exists()).toBe(true);
    expect(wrapper.text()).toMatch(/utility\.observed_contribution/);
    expect(wrapper.find("[data-testid='authenticity-tags-absent']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='weight-performance']").exists()).toBe(true);
  });

  it("clones ACTIVE to DRAFT and keeps config editable", async () => {
    const active = activeV6();
    const draft: AdminScoreModelDTO = {
      ...active,
      id: "model-draft-7",
      version: 7,
      name: "Default Trust Factor v6 (draft)",
      status: "DRAFT",
      activatedAt: null,
      config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
    };
    listModels.mockResolvedValueOnce([active]).mockResolvedValue([active, draft]);
    cloneModel.mockResolvedValue(draft);

    const wrapper = await mountPage();
    await wrapper.get("[data-testid='clone-model']").trigger("click");
    await flushPromises();

    expect(cloneModel).toHaveBeenCalledWith(active.id);
    expect(wrapper.get("[data-testid='selected-status']").text()).toBe("DRAFT");
    expect(wrapper.find("[data-testid='metric-weights-PERFORMANCE']").exists()).toBe(true);
  });

  it("saves draft with canonical metricWeights and preserves unedited fields", async () => {
    const active = activeV6();
    const draft: AdminScoreModelDTO = {
      ...active,
      id: "model-draft-7",
      version: 7,
      name: "Draft",
      status: "DRAFT",
      activatedAt: null,
    };
    listModels.mockResolvedValue([draft]);
    updateModel.mockImplementation(async (_id: string, config: unknown) => ({
      ...draft,
      config,
    }));

    const wrapper = await mountPage();
    const saveBtn = wrapper.findAll("button").find((b) => b.text() === "Save draft");
    expect(saveBtn).toBeTruthy();
    await saveBtn!.trigger("click");
    await flushPromises();

    expect(updateModel).toHaveBeenCalled();
    const saved = updateModel.mock.calls[0]![1] as Record<string, unknown>;
    expect(saved).toHaveProperty("metricWeights");
    expect(saved).not.toHaveProperty("nestedMetricWeights");
    expect(saved).not.toHaveProperty("confidenceParameters");
    expect(saved).not.toHaveProperty("boostThresholds");
    expect(saved.eligibility).toEqual(PERSISTED_V6_SCORE_MODEL_CONFIG.eligibility);
    expect(saved.overallFormula).toBe("WEIGHTED_DIMENSIONS");
    expect(saved.utilityPublicationEligibility).toEqual(
      PERSISTED_V6_SCORE_MODEL_CONFIG.utilityPublicationEligibility,
    );
    expect((saved.metricWeights as { UTILITY: unknown }).UTILITY).toEqual([
      { metricKey: "utility.observed_contribution", weight: 1 },
    ]);
  });

  it("shows empty catalog state", async () => {
    listModels.mockResolvedValue([]);
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='models-empty']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='admin-page']").text()).toMatch(/Admin score models/);
  });

  it("shows API error state without blanking the page", async () => {
    listModels.mockRejectedValue(new Error("network down"));
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='models-load-error']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='models-load-error']").text()).toMatch(/network down/);
    expect(wrapper.get("h1").text()).toBe("Admin score models");
  });

  it("shows malformed config diagnostic without blanking the page", async () => {
    listModels.mockResolvedValue([
      {
        id: "legacy-1",
        key: "default",
        version: 1,
        name: "Legacy mock shape",
        status: "ACTIVE",
        config: {
          nestedMetricWeights: { performance: { a: 1 } },
          confidenceParameters: { minRunsForFullConfidence: 20, shrinkageFloor: 0.3 },
          boostThresholds: { suspicionSoft: 0.4, suspicionHard: 0.7 },
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        activatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='config-malformed']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='model-list']").text()).toMatch(/ACTIVE/);
    expect(wrapper.get("[data-testid='selected-status']").text()).toBe("ACTIVE");
    expect(wrapper.find("[data-testid='clone-model']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='weight-performance']").exists()).toBe(false);
  });
});
