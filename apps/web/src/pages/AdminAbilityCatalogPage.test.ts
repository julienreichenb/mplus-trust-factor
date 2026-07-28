import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminAbilityCatalogPage from "./AdminAbilityCatalogPage.vue";
import { routeDefs } from "../routes";

async function mountPage(initialPath = "/admin/ability-catalog") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeDefs,
  });
  await router.push(initialPath);
  await router.isReady();

  const wrapper = mount(AdminAbilityCatalogPage, {
    global: {
      plugins: [router],
    },
  });

  await flushPromises();
  await vi.waitFor(
    () => {
      expect(wrapper.find("[data-testid='catalog-summary']").exists()).toBe(true);
    },
    { timeout: 5000 },
  );

  return { wrapper, router };
}

async function waitForCatalogReload(wrapper: ReturnType<typeof mount>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await flushPromises();
  await vi.waitFor(
    () => !wrapper.find(".loading-hint").exists() || wrapper.find("[data-testid='empty-state']").exists() || wrapper.find("[data-testid='ability-row']").exists(),
    { timeout: 5000 },
  );
}

describe("AdminAbilityCatalogPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders catalog summary after unlock (mock mode is default)", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find("[data-testid='ability-catalog-page']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='catalog-summary']").exists()).toBe(true);
    expect(wrapper.find(".summary-card").text()).toMatch(/Catalog version/i);
    expect(wrapper.find(".summary-card strong").exists()).toBe(true);
  });

  it("search updates results", async () => {
    const { wrapper } = await mountPage();
    const rowsBefore = wrapper.findAll("[data-testid='ability-row']").length;

    await wrapper.get("[data-testid='catalog-search']").setValue("6552");
    await waitForCatalogReload(wrapper);

    expect(wrapper.text()).toContain("6552");
    expect(wrapper.findAll("[data-testid='ability-row']").length).toBeLessThanOrEqual(rowsBefore + 1);
    expect(wrapper.findAll("[data-testid='ability-row']").length).toBeGreaterThan(0);
  });

  it("shows empty state when no matches", async () => {
    const { wrapper } = await mountPage();

    await wrapper.get("[data-testid='catalog-search']").setValue("zzzznonexistent99999");
    await waitForCatalogReload(wrapper);

    expect(wrapper.get("[data-testid='empty-state']").text()).toContain("No abilities match");
  });

  it("renders ability metadata", async () => {
    const { wrapper } = await mountPage();

    await wrapper.get("[data-testid='catalog-search']").setValue("6552");
    await waitForCatalogReload(wrapper);

    const row = wrapper.get("[data-testid='ability-row']");
    expect(row.text()).toMatch(/Pummel|6552/i);
    expect(row.find(".ability-meta").exists()).toBe(true);
    expect(row.find(".wowhead-link").attributes("href")).toContain("6552");
    expect(row.find(".wowhead-link").attributes("data-wowhead")).toBe("spell=6552");
  });

  it("shows validation summary when issues exist", async () => {
    const { wrapper } = await mountPage();
    const validation = wrapper.find("[data-testid='validation-summary']");
    if (validation.exists()) {
      expect(validation.find("h2").text()).toBe("Validation issues");
      expect(validation.find(".issue-link").exists()).toBe(true);
    } else {
      const summary = wrapper.get("[data-testid='catalog-summary']");
      expect(summary.text()).toMatch(/Validation errors|Warnings/);
    }
  });
});
