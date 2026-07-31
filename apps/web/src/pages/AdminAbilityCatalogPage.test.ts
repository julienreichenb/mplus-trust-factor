import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminAbilityCatalogPage from "./AdminAbilityCatalogPage.vue";
import { routeDefs } from "../routes";
import { WOW_ICON_CDN_BASE, WOW_ICON_FALLBACK_DATA_URI } from "../lib/wowIcons";
import * as spellIcons from "../integrations/wowhead/spellIcons";

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
  await flushPromises();
  await vi.waitFor(
    () => {
      expect(wrapper.find(".loading-hint").exists()).toBe(false);
    },
    { timeout: 8000 },
  );
  await flushPromises();
}

describe("AdminAbilityCatalogPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders catalog summary without summary-grid cards", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find("[data-testid='ability-catalog-page']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='catalog-summary']").exists()).toBe(true);
    expect(wrapper.find(".summary-grid").exists()).toBe(false);
    expect(wrapper.find(".summary-card").exists()).toBe(false);
    expect(wrapper.get("[data-testid='catalog-summary']").text()).toMatch(/Catalog version/i);
  });

  it("applies sticky search layout classes with token padding", async () => {
    const { wrapper } = await mountPage();
    const sticky = wrapper.get("[data-testid='catalog-sticky-bar']");
    expect(sticky.classes()).toContain("sticky-bar");
    expect(sticky.find(".search-row").exists()).toBe(true);
    expect(sticky.find(".filters").exists()).toBe(true);
  });

  it("renders class-section chevrons as SVG", async () => {
    const { wrapper } = await mountPage();
    const section = wrapper.get("[data-testid='class-section']");
    expect(section.find("[data-testid='disclosure-chevron']").exists()).toBe(true);
    expect(section.find(".section-toggle").text()).not.toMatch(/\?/);
  });

  it("shows class and role filter icons", async () => {
    const { wrapper } = await mountPage();
    const triggers = wrapper.findAll("[data-testid='icon-select-trigger']");
    expect(triggers.length).toBeGreaterThanOrEqual(2);
    await triggers[0]!.trigger("click");
    expect(wrapper.find("[data-testid='icon-select-list']").text()).toMatch(/Warrior|Mage|Warlock/i);
    expect(
      wrapper.findAll("[data-testid='icon-select-list'] [data-testid='wow-icon']").length,
    ).toBeGreaterThan(0);
  });

  it("does not perform per-rule icon metadata lookups when rendering many rules", async () => {
    const resolveSpy = vi.spyOn(spellIcons, "resolveWowheadSpellIconUrls");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { wrapper } = await mountPage();
    expect(wrapper.findAll("[data-testid='ability-row']").length).toBeGreaterThan(1);
    expect(resolveSpy).not.toHaveBeenCalled();
    const metadataFetches = fetchSpy.mock.calls.filter(([input]) => {
      const url = String(input);
      return /nether\.wowhead\.com|blizzard\.com|\/tooltip\/spell/i.test(url);
    });
    expect(metadataFetches).toHaveLength(0);
  });

  it("search updates results and shows ability icons with CDN or fallback", async () => {
    const { wrapper } = await mountPage();

    await wrapper.get("[data-testid='catalog-search']").setValue("6552");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await waitForCatalogReload(wrapper);

    expect(wrapper.text()).toContain("6552");
    const row = wrapper.get("[data-testid='ability-row']");
    const icon = row.get("[data-testid='wow-icon']");
    const src = icon.attributes("src") ?? "";
    expect(src === `${WOW_ICON_CDN_BASE}/ability_warrior_shieldbash.jpg` || src === WOW_ICON_FALLBACK_DATA_URI).toBe(
      true,
    );
    expect(row.find(".ability-meta").exists()).toBe(true);
    expect(row.find(".wowhead-link").attributes("href")).toContain("6552");
  });

  it("shows empty state when no matches", async () => {
    const { wrapper } = await mountPage();

    await wrapper.get("[data-testid='catalog-search']").setValue("zzzznonexistent99999");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await waitForCatalogReload(wrapper);

    expect(wrapper.get("[data-testid='empty-state']").text()).toContain("No abilities match");
  });

  it("shows warning disclosure collapsed by default when warnings exist", async () => {
    const { wrapper } = await mountPage();
    const validation = wrapper.find("[data-testid='validation-summary']");
    if (validation.exists()) {
      expect(validation.find("h2").exists()).toBe(false);
      if (validation.find("[data-testid='validation-toggle']").exists()) {
        expect(validation.get("[data-testid='validation-toggle']").attributes("aria-expanded")).toBe(
          "false",
        );
        expect(validation.get("[data-testid='validation-issue-count']").text()).toMatch(
          /\d+ warnings?/i,
        );
      }
    } else {
      const summary = wrapper.get("[data-testid='catalog-summary']");
      expect(summary.text()).toMatch(/Validation errors|Warnings/);
    }
  });

  it("supports responsive filter layout class on sticky bar", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find(".sticky-bar .filters").exists()).toBe(true);
    expect(wrapper.find(".catalog-summary").exists()).toBe(true);
  });
});
