import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminTuningPage from "./AdminTuningPage.vue";
import { routeDefs } from "../routes";
import { PERSISTED_V6_SCORE_MODEL_CONFIG } from "../api/model-config/persisted-v6-fixture";
import { deepClone } from "../lib/clone";
import { createDefaultTunableWeights } from "../api/tunable-weights";
import type { AdminScoreModelDTO } from "../api/types";

const listModels = vi.fn();
const updateModel = vi.fn();
const cloneModel = vi.fn();
const activateModel = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listModels: (...args: unknown[]) => listModels(...args),
    updateModel: (...args: unknown[]) => updateModel(...args),
    cloneModel: (...args: unknown[]) => cloneModel(...args),
    activateModel: (...args: unknown[]) => activateModel(...args),
  },
}));

function models(): AdminScoreModelDTO[] {
  const tunable = createDefaultTunableWeights();
  const config = {
    ...deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
    tunableWeights: tunable,
  };
  return [
    {
      id: "active",
      key: "default",
      version: 6,
      name: "Production",
      status: "ACTIVE",
      config,
      createdAt: "2026-01-01T00:00:00.000Z",
      activatedAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "draft",
      key: "default",
      version: 7,
      name: "Draft",
      status: "DRAFT",
      config: deepClone(config),
      createdAt: "2026-02-01T00:00:00.000Z",
      activatedAt: null,
    },
  ];
}

async function mountPage(query: Record<string, string> = { model: "draft" }) {
  const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
  await router.push({ path: "/admin/tuning", query });
  await router.isReady();
  const wrapper = mount(AdminTuningPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe("AdminTuningPage", () => {
  beforeEach(() => {
    listModels.mockResolvedValue(models());
    updateModel.mockImplementation(async (_id: string, config: unknown) => ({
      ...models()[1],
      config,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows editing drafts and updates effective percentages", async () => {
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='tuning-readonly']").exists()).toBe(false);
    const input = wrapper.get("[data-testid='dim-weight-performance']");
    await input.setValue(70);
    await flushPromises();
    expect(wrapper.get("[data-testid='dim-effective-performance']").text()).toContain("%");
    expect(wrapper.find("[data-testid='tuning-dirty']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='field-tooltip']").exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps ACTIVE models read-only", async () => {
    const wrapper = await mountPage({ model: "active" });
    expect(wrapper.find("[data-testid='tuning-readonly']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='dim-weight-performance']").attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-testid='tuning-save']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("saves draft weights explicitly", async () => {
    const wrapper = await mountPage();
    const input = wrapper.get("[data-testid='dim-weight-utility']");
    await input.setValue(40);
    await flushPromises();
    expect(wrapper.find("[data-testid='tuning-dirty']").exists()).toBe(true);
    await wrapper.get("[data-testid='tuning-save']").trigger("click");
    await flushPromises();
    expect(updateModel).toHaveBeenCalled();
    const config = updateModel.mock.calls[0]?.[1] as {
      tunableWeights?: { dimensions: { utility: number } };
    };
    expect(config.tunableWeights?.dimensions.utility).toBe(40);
    wrapper.unmount();
  });

  it("requires activation confirmation", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='tuning-activate']").trigger("click");
    expect(wrapper.find("[data-testid='tuning-activate-modal']").exists()).toBe(true);
    expect(activateModel).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
