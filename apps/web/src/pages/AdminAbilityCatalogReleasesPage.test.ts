import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminAbilityCatalogReleasesPage from "./AdminAbilityCatalogReleasesPage.vue";
import { routeDefs } from "../routes";

const listReleases = vi.fn();
const getActive = vi.fn();
const activate = vi.fn();
const rollback = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listAbilityCatalogReleases: (...args: unknown[]) => listReleases(...args),
    getAbilityCatalogActiveRelease: (...args: unknown[]) => getActive(...args),
    activateAbilityCatalogRelease: (...args: unknown[]) => activate(...args),
    rollbackAbilityCatalogRelease: (...args: unknown[]) => rollback(...args),
  },
}));

const activeRelease = {
  id: "active-1",
  releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
  contentDigest: "a".repeat(64),
  status: "ACTIVE",
};

const validatedRelease = {
  id: "validated-1",
  releaseKey: "wow-69299/catalog-v1/abcd1234",
  contentDigest: "b".repeat(64),
  status: "VALIDATED",
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeDefs,
  });
  await router.push("/admin/ability-catalog/releases");
  await router.isReady();
  const wrapper = mount(AdminAbilityCatalogReleasesPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

describe("AdminAbilityCatalogReleasesPage activation", () => {
  beforeEach(() => {
    getActive.mockResolvedValue({
      active: activeRelease,
      limitations: {},
      notice: null,
    });
    listReleases.mockResolvedValue({ releases: [activeRelease, validatedRelease] });
    activate.mockResolvedValue({
      release: { ...validatedRelease, status: "ACTIVE" },
      activation: { id: "act-1" },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens confirmation modal and sends exact contentDigest as confirmationDigest", async () => {
    const wrapper = await mountPage();
    const activateButtons = wrapper.findAll("[data-testid='activate-release']");
    // Second row is VALIDATED
    await activateButtons[1]!.trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='activate-confirm-modal']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='activate-confirm-key']").text()).toContain(
      "wow-69299/catalog-v1/abcd1234",
    );
    expect(wrapper.get("[data-testid='activate-confirm-digest']").text()).toContain(
      validatedRelease.contentDigest,
    );

    await wrapper.get("[data-testid='activate-confirm-submit']").trigger("click");
    await flushPromises();

    expect(activate).toHaveBeenCalledWith(
      "validated-1",
      expect.objectContaining({
        confirmationDigest: validatedRelease.contentDigest,
        confirm: true,
        expectedPreviousActiveId: "active-1",
      }),
    );
    expect(getActive).toHaveBeenCalledTimes(2); // initial + refresh
    expect(wrapper.text()).toContain("Activated");
  });
});
