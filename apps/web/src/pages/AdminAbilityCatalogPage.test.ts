import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
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
      expect(wrapper.find("[data-testid='catalog-sticky-bar']").exists()).toBe(true);
      expect(wrapper.find(".loading-hint").exists()).toBe(false);
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

async function expandFirstAbilityPath(
  wrapper: Awaited<ReturnType<typeof mountPage>>["wrapper"],
): Promise<void> {
  const firstSection = wrapper.get("[data-testid='class-section']");
  await firstSection.get(".section-toggle").trigger("click");
  await flushPromises();
  const firstSpec = firstSection.find(".spec-toggle");
  if (firstSpec.exists()) {
    await firstSpec.trigger("click");
    await flushPromises();
  }
  await vi.waitFor(() => {
    expect(wrapper.find("[data-testid='ability-row']").exists()).toBe(true);
  });
}

describe("AdminAbilityCatalogPage", () => {
  beforeEach(() => {
    // Avoid real Wowhead network in page tests; SpellWowIcon covers resolution.
    vi.spyOn(spellIcons, "resolveWowheadSpellIconName").mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the ability catalog page shell", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find("[data-testid='ability-catalog-page']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='catalog-summary']").exists()).toBe(false);
    expect(wrapper.find(".catalog-summary").exists()).toBe(false);
  });

  it("keeps class/spec/ability collapses closed by default", async () => {
    const { wrapper } = await mountPage();
    const section = wrapper.get("[data-testid='class-section']");
    expect(section.get(".section-toggle").attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".spec-toggle").exists()).toBe(false);
    expect(wrapper.find("[data-testid='ability-row']").exists()).toBe(false);
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

  it("resolves missing spell icons per row without a bulk metadata pass", async () => {
    const bulkSpy = vi.spyOn(spellIcons, "resolveWowheadSpellIconUrls");
    const { wrapper } = await mountPage();
    await expandFirstAbilityPath(wrapper);
    expect(wrapper.findAll("[data-testid='ability-row']").length).toBeGreaterThan(1);
    expect(bulkSpy).not.toHaveBeenCalled();
    expect(spellIcons.resolveWowheadSpellIconName).toHaveBeenCalled();
  });

  it("search updates results and shows ability icons with CDN or fallback", async () => {
    const { wrapper } = await mountPage();

    await wrapper.get("[data-testid='catalog-search']").setValue("6552");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await waitForCatalogReload(wrapper);

    expect(wrapper.text()).toContain("Warrior");
    await expandFirstAbilityPath(wrapper);
    const row = wrapper.get("[data-testid='ability-row']");
    const icon = row.get("[data-testid='wow-icon']");
    const src = icon.attributes("src") ?? "";
    expect(src === `${WOW_ICON_CDN_BASE}/ability_warrior_shieldbash.jpg` || src === WOW_ICON_FALLBACK_DATA_URI).toBe(
      true,
    );
    expect(row.find(".ability-meta").exists()).toBe(true);
    expect(row.find("[data-testid='ability-spell-id']").attributes("href")).toContain("6552");
    expect(row.text()).toContain("6552");
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
    if (!validation.exists()) return;
    expect(validation.find("h2").exists()).toBe(false);
    if (validation.find("[data-testid='validation-toggle']").exists()) {
      expect(validation.get("[data-testid='validation-toggle']").attributes("aria-expanded")).toBe(
        "false",
      );
      expect(validation.get("[data-testid='validation-issue-count']").text()).toMatch(/^\d+$/);
    }
  });

  it("supports responsive filter layout class on sticky bar", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find(".sticky-bar .filters").exists()).toBe(true);
  });

  it("exposes spell icon tooltip wrappers with the same wowhead authority as Spell ID", async () => {
    const { wrapper } = await mountPage();
    const firstSection = wrapper.get("[data-testid='class-section']");
    await firstSection.get(".section-toggle").trigger("click");
    await flushPromises();
    const firstSpec = firstSection.find(".spec-toggle");
    if (firstSpec.exists()) {
      await firstSpec.trigger("click");
      await flushPromises();
    }
    await vi.waitFor(() => {
      expect(wrapper.find("[data-testid='ability-row']").exists()).toBe(true);
    });
    const iconTip = wrapper.find("[data-testid='spell-icon-tooltip']");
    expect(iconTip.exists()).toBe(true);
    expect(iconTip.attributes("data-wowhead")).toMatch(/^spell=\d+/);
    expect(iconTip.attributes("tabindex")).toBeUndefined();
    await iconTip.trigger("focus");
    expect(iconTip.attributes("data-wowhead")).toMatch(/^spell=\d+/);
    const spellIdLink = wrapper.find("[data-testid='ability-spell-id']");
    expect(spellIdLink.exists()).toBe(true);
    expect(spellIdLink.attributes("data-wowhead")).toBe(iconTip.attributes("data-wowhead"));
  });
});
