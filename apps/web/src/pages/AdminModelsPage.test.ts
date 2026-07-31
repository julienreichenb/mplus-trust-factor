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
const deleteModel = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listModels: (...args: unknown[]) => listModels(...args),
    cloneModel: (...args: unknown[]) => cloneModel(...args),
    updateModel: (...args: unknown[]) => updateModel(...args),
    validateModel: (...args: unknown[]) => validateModel(...args),
    backtestModel: (...args: unknown[]) => backtestModel(...args),
    activateModel: (...args: unknown[]) => activateModel(...args),
    deleteModel: (...args: unknown[]) => deleteModel(...args),
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
      id: "m-draft-old",
      key: "default",
      version: 7,
      name: "Older draft",
      status: "DRAFT",
      config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
      createdAt: "2026-02-01T00:00:00.000Z",
      activatedAt: null,
    },
    {
      id: "m-draft-new",
      key: "default",
      version: 8,
      name: "Newest draft special-name",
      status: "DRAFT",
      config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
      createdAt: "2026-03-01T00:00:00.000Z",
      activatedAt: null,
    },
    {
      id: "m-archived-old",
      key: "default",
      version: 4,
      name: "Older archived",
      status: "ARCHIVED",
      config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
      createdAt: "2025-01-01T00:00:00.000Z",
      activatedAt: "2025-01-02T00:00:00.000Z",
    },
    {
      id: "m-archived-new",
      key: "default",
      version: 5,
      name: "Newest archived",
      status: "ARCHIVED",
      config: deepClone(PERSISTED_V6_SCORE_MODEL_CONFIG),
      createdAt: "2025-06-01T00:00:00.000Z",
      activatedAt: "2025-06-02T00:00:00.000Z",
    },
  ];
}

describe("AdminModelsPage persisted v6 config", () => {
  beforeEach(() => {
    listModels.mockReset();
    cloneModel.mockReset();
    updateModel.mockReset();
    validateModel.mockReset();
    backtestModel.mockReset();
    activateModel.mockReset();
    deleteModel.mockReset();
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

describe("AdminModelsPage catalog filters and ordering", () => {
  beforeEach(() => {
    listModels.mockReset();
    cloneModel.mockReset();
    updateModel.mockReset();
    validateModel.mockReset();
    backtestModel.mockReset();
    activateModel.mockReset();
    deleteModel.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function catalogRowNames(wrapper: Awaited<ReturnType<typeof mountPage>>): string[] {
    return wrapper
      .findAll("[data-testid='catalog-row']")
      .map((row) => row.text().replace(/\s+/g, " ").trim());
  }

  it("orders the catalog ACTIVE first, then DRAFT newest first, then ARCHIVED newest first", async () => {
    listModels.mockResolvedValue(catalogFixture());
    const wrapper = await mountPage();

    const rows = catalogRowNames(wrapper);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatch(/ACTIVE/);
    expect(rows[0]).toMatch(/Default Trust Factor v6/);
    expect(rows[1]).toMatch(/Newest draft special-name/);
    expect(rows[2]).toMatch(/Older draft/);
    expect(rows[3]).toMatch(/Newest archived/);
    expect(rows[4]).toMatch(/Older archived/);
  });

  it("filters the catalog by case-insensitive, trimmed text search across name/key/version", async () => {
    listModels.mockResolvedValue(catalogFixture());
    const wrapper = await mountPage();

    const search = wrapper.get("[data-testid='catalog-search']");
    await search.setValue("  SPECIAL-NAME  ");
    await flushPromises();

    const rows = catalogRowNames(wrapper);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/Newest draft special-name/);
    expect(wrapper.get("[data-testid='catalog-result-count']").text()).toMatch(/Showing 1 of 5/);

    await search.setValue("v6");
    await flushPromises();
    expect(catalogRowNames(wrapper).some((r) => r.includes("Default Trust Factor v6"))).toBe(true);
  });

  it("filters the catalog by status", async () => {
    listModels.mockResolvedValue(catalogFixture());
    const wrapper = await mountPage();

    await wrapper.get("[data-testid='catalog-status-filter']").setValue("ARCHIVED");
    await flushPromises();

    const rows = catalogRowNames(wrapper);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.includes("ARCHIVED"))).toBe(true);
  });

  it("shows an empty-filter state with a way to clear filters, and a result count", async () => {
    listModels.mockResolvedValue(catalogFixture());
    const wrapper = await mountPage();

    await wrapper.get("[data-testid='catalog-search']").setValue("nonexistent-model-xyz");
    await flushPromises();

    expect(wrapper.find("[data-testid='catalog-empty-filters']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='catalog-result-count']").text()).toMatch(/Showing 0 of 5/);

    await wrapper.get("[data-testid='catalog-reset']").trigger("click");
    await flushPromises();

    expect(wrapper.find("[data-testid='catalog-empty-filters']").exists()).toBe(false);
    expect(catalogRowNames(wrapper)).toHaveLength(5);
  });

  it("keeps the selected model selected but shows a clear state when hidden by filters", async () => {
    listModels.mockResolvedValue(catalogFixture());
    const wrapper = await mountPage();

    // Default selection is the first sorted row (ACTIVE model); filter it out.
    await wrapper.get("[data-testid='catalog-status-filter']").setValue("DRAFT");
    await flushPromises();

    expect(wrapper.get("[data-testid='selected-status']").text()).toBe("ACTIVE");
    expect(wrapper.find("[data-testid='selected-hidden-note']").exists()).toBe(true);
  });
});

describe("AdminModelsPage tooltips", () => {
  beforeEach(() => {
    listModels.mockReset();
    cloneModel.mockReset();
    updateModel.mockReset();
    validateModel.mockReset();
    backtestModel.mockReset();
    activateModel.mockReset();
    deleteModel.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders What it means / Technical details tooltips on model options and lifecycle actions", async () => {
    listModels.mockResolvedValue(catalogFixture());
    const wrapper = await mountPage();

    const tooltips = wrapper.findAll("[data-testid='field-tooltip']");
    // Weights, metric weights (per-row), grade thresholds, blend, confidence,
    // authenticity tags, canonical read-only, filters, and lifecycle actions.
    expect(tooltips.length).toBeGreaterThan(15);

    const first = tooltips[0]!;
    await first.get("button").trigger("click");
    await flushPromises();
    expect(first.get("[role='tooltip']").text()).toMatch(/What it means/);
    expect(first.get("button").attributes("aria-describedby")).toBeTruthy();
  });

  it("dismisses an open tooltip on Escape", async () => {
    listModels.mockResolvedValue(catalogFixture());
    const wrapper = await mountPage();

    const tip = wrapper.findAll("[data-testid='field-tooltip']")[0]!;
    await tip.get("button").trigger("click");
    await flushPromises();
    expect(tip.get("button").attributes("aria-expanded")).toBe("true");

    await tip.get("button").trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(tip.get("button").attributes("aria-expanded")).toBe("false");
  });

  it("shows the exact metricKey from the registry in dynamic metric tooltips", async () => {
    listModels.mockResolvedValue(catalogFixture());
    const wrapper = await mountPage();

    const utilityFieldset = wrapper.get("[data-testid='metric-weights-UTILITY']");
    const tooltips = utilityFieldset.findAll("[data-testid='field-tooltip']");
    // First tooltip is the group-level (fieldset legend); the row-level one follows.
    const tooltip = tooltips[tooltips.length - 1]!;
    await tooltip.get("button").trigger("click");
    await flushPromises();
    expect(tooltip.get("[data-testid='field-tooltip-technical']").text()).toMatch(
      /utility\.observed_contribution/,
    );
  });
});

describe("AdminModelsPage delete draft", () => {
  beforeEach(() => {
    listModels.mockReset();
    cloneModel.mockReset();
    updateModel.mockReset();
    validateModel.mockReset();
    backtestModel.mockReset();
    activateModel.mockReset();
    deleteModel.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not offer Delete draft for ACTIVE or ARCHIVED models", async () => {
    listModels.mockResolvedValue(catalogFixture());
    const wrapper = await mountPage();

    // Default selection is the ACTIVE model.
    expect(wrapper.find("[data-testid='delete-draft']").exists()).toBe(false);
  });

  it("shows a confirmation modal explaining irreversibility, then deletes on confirm", async () => {
    const fixture = catalogFixture();
    listModels.mockResolvedValue(fixture);
    deleteModel.mockResolvedValue({
      id: "m-draft-new",
      key: "default",
      version: 8,
      name: "Newest draft special-name",
      status: "DRAFT",
    });
    const wrapper = await mountPage();

    const rows = wrapper.findAll("[data-testid='catalog-row']");
    const draftRow = rows.find((r) => r.text().includes("Newest draft special-name"))!;
    await draftRow.get("[data-testid='delete-draft-row']").trigger("click");
    await flushPromises();

    const modal = wrapper.get("[data-testid='delete-confirm']");
    expect(modal.text()).toMatch(/irreversible|no undo/i);
    expect(modal.text()).toMatch(/Newest draft special-name/);
    expect(modal.text()).toMatch(/never activated/i);

    await modal.get("[data-testid='confirm-delete-draft']").trigger("click");
    await flushPromises();

    expect(deleteModel).toHaveBeenCalledWith("m-draft-new");
    expect(wrapper.find("[data-testid='delete-confirm']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='page-message']").text()).toMatch(/Deleted draft/);
    expect(wrapper.find("[data-testid='catalog-row']").exists()).toBe(true);
  });

  it("shows safe dependency counts on a 409 SCORE_MODEL_DRAFT_IN_USE conflict", async () => {
    const fixture = catalogFixture();
    listModels.mockResolvedValue(fixture);
    deleteModel.mockRejectedValue(
      Object.assign(new Error("Draft is referenced by durable history"), {
        status: 409,
        code: "SCORE_MODEL_DRAFT_IN_USE",
        details: { counts: { scoreSnapshots: 0, characterRedFlags: 0, addonExports: 0, analysisBatches: 0, bulkOperations: 2 } },
      }),
    );
    const wrapper = await mountPage();

    const rows = wrapper.findAll("[data-testid='catalog-row']");
    const draftRow = rows.find((r) => r.text().includes("Newest draft special-name"))!;
    await draftRow.get("[data-testid='delete-draft-row']").trigger("click");
    await flushPromises();
    await wrapper.get("[data-testid='confirm-delete-draft']").trigger("click");
    await flushPromises();

    const conflict = wrapper.get("[data-testid='delete-conflict-error']");
    expect(conflict.text()).toMatch(/2 bulk operation/);
    // Model must still be present — never cascaded / removed on conflict.
    expect(
      wrapper.findAll("[data-testid='catalog-row']").some((r) => r.text().includes("Newest draft special-name")),
    ).toBe(true);
  });

  it("cancels deletion without calling the API", async () => {
    listModels.mockResolvedValue(catalogFixture());
    const wrapper = await mountPage();

    const rows = wrapper.findAll("[data-testid='catalog-row']");
    const draftRow = rows.find((r) => r.text().includes("Newest draft special-name"))!;
    await draftRow.get("[data-testid='delete-draft-row']").trigger("click");
    await flushPromises();

    await wrapper.find("[data-testid='delete-confirm']").findAll("button").find((b) => b.text() === "Cancel")!.trigger("click");
    await flushPromises();

    expect(deleteModel).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid='delete-confirm']").exists()).toBe(false);
  });
});
