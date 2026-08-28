import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminAbilityCatalogReleasesPage from "./AdminAbilityCatalogReleasesPage.vue";
import { routeDefs } from "../routes";

const listReleases = vi.fn();
const getActive = vi.fn();
const rollback = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listAbilityCatalogReleases: (...args: unknown[]) => listReleases(...args),
    getAbilityCatalogActiveRelease: (...args: unknown[]) => getActive(...args),
    rollbackAbilityCatalogRelease: (...args: unknown[]) => rollback(...args),
  },
}));

const activeRelease = {
  id: "active-1",
  releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
  contentDigest: "a".repeat(64),
  status: "ACTIVE",
};

const supersededRelease = {
  id: "superseded-1",
  releaseKey: "wow-69299/catalog-v1/abcd1234",
  contentDigest: "b".repeat(64),
  status: "SUPERSEDED",
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeDefs,
  });
  await router.push("/admin/ability-catalog/history");
  await router.isReady();
  const wrapper = mount(AdminAbilityCatalogReleasesPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

describe("AdminAbilityCatalogReleasesPage history", () => {
  beforeEach(() => {
    getActive.mockResolvedValue({
      active: activeRelease,
      limitations: {},
      notice: null,
    });
    listReleases.mockResolvedValue({ releases: [activeRelease, supersededRelease] });
    rollback.mockResolvedValue({
      release: { ...supersededRelease, status: "ACTIVE" },
      activation: { id: "act-1" },
    });
    vi.stubGlobal("confirm", () => true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("supports rollback with reason and exact contentDigest", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='rollback-reason']").setValue("Emergency rollback");
    const rollbackButtons = wrapper.findAll("[data-testid='rollback-release']");
    await rollbackButtons[1]!.trigger("click");
    await flushPromises();

    expect(rollback).toHaveBeenCalledWith(
      "superseded-1",
      expect.objectContaining({
        confirmationDigest: supersededRelease.contentDigest,
        confirm: true,
        reason: "Emergency rollback",
        expectedPreviousActiveId: "active-1",
      }),
    );
    expect(wrapper.text()).toContain("Rolled back");
  });
});
