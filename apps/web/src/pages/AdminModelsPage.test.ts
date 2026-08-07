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
const activateModel = vi.fn();
const deleteModel = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listModels: (...args: unknown[]) => listModels(...args),
    cloneModel: (...args: unknown[]) => cloneModel(...args),
    activateModel: (...args: unknown[]) => activateModel(...args),
    deleteModel: (...args: unknown[]) => deleteModel(...args),
  },
}));

function catalogFixture(): AdminScoreModelDTO[] {
  return [
    {
      id: "m-active",
      key: "default",
      version: 6,
      name: "Default Trust Factor v6",
      status: "ACTIVE",
      config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
      createdAt: "2026-01-01T00:00:00.000Z",
      activatedAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "m-draft",
      key: "default",
      version: 7,
      name: "Draft candidate",
      status: "DRAFT",
      config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
      createdAt: "2026-03-01T00:00:00.000Z",
      activatedAt: null,
    },
    {
      id: "m-archived",
      key: "default",
      version: 5,
      name: "Archived model",
      status: "ARCHIVED",
      config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
      createdAt: "2025-01-01T00:00:00.000Z",
      activatedAt: "2025-01-02T00:00:00.000Z",
    },
  ];
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
  return { wrapper, router };
}

describe("AdminModelsPage", () => {
  beforeEach(() => {
    listModels.mockResolvedValue(catalogFixture());
    cloneModel.mockResolvedValue({
      ...catalogFixture()[1],
      id: "m-new-draft",
      version: 8,
      name: "Default Trust Factor v6 (draft)",
    });
    activateModel.mockResolvedValue({
      ...catalogFixture()[1],
      status: "ACTIVE",
      previousActiveId: "m-active",
      previousActiveVersion: 6,
      bulkOperationId: null,
    });
    deleteModel.mockResolvedValue({
      id: "m-draft",
      key: "default",
      version: 7,
      name: "Draft candidate",
      status: "DRAFT",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists models with status actions and no Scoring V2 copy", async () => {
    const { wrapper } = await mountPage();
    const text = wrapper.text();
    expect(text).toContain("Models");
    expect(text).not.toMatch(/Scoring V2/i);
    expect(wrapper.find("[data-testid='duplicate-as-draft']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='edit-tune']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='activate-draft']").exists()).toBe(true);
    expect(text).toContain("View");
    wrapper.unmount();
  });

  it("requires confirmation before activating a draft", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='activate-draft']").trigger("click");
    expect(wrapper.find("[data-testid='activate-confirm-modal']").exists()).toBe(true);
    expect(activateModel).not.toHaveBeenCalled();
    await wrapper.get("[data-testid='confirm-activate']").trigger("click");
    await flushPromises();
    expect(activateModel).toHaveBeenCalledWith(
      "m-draft",
      expect.objectContaining({ confirm: true }),
    );
    wrapper.unmount();
  });

  it("duplicates ACTIVE into a draft", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get("[data-testid='duplicate-as-draft']").trigger("click");
    await flushPromises();
    expect(cloneModel).toHaveBeenCalledWith("m-active");
    wrapper.unmount();
  });
});
