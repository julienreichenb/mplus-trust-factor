import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h } from "vue";
import AdminAbilityCatalogConsolePage from "./AdminAbilityCatalogConsolePage.vue";
import { routeDefs } from "../routes";

const StubCatalog = defineComponent({
  name: "AdminAbilityCatalogPage",
  props: { embedded: { type: Boolean, default: false } },
  setup: () => () => h("div", { "data-testid": "ability-catalog-page" }),
});
const StubReleases = defineComponent({
  name: "AdminAbilityCatalogReleasesPage",
  props: { embedded: { type: Boolean, default: false } },
  setup: () => () => h("div", { "data-testid": "ability-catalog-releases-page" }),
});

async function mountConsole(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeDefs,
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(AdminAbilityCatalogConsolePage, {
    global: {
      plugins: [router],
      stubs: {
        AdminAbilityCatalogPage: StubCatalog,
        AdminAbilityCatalogReleasesPage: StubReleases,
      },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

describe("AdminAbilityCatalogConsolePage", () => {
  it("renders Catalog/History tabs and defaults to catalog", async () => {
    const { wrapper, router } = await mountConsole("/admin/ability-catalog");
    expect(wrapper.find("[data-testid='admin-ability-catalog-console']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='tab-catalog']").classes()).toContain("tab--active");
    expect(wrapper.find("[data-testid='tab-history']").exists()).toBe(true);
    expect(router.currentRoute.value.params.tab).toBe("catalog");
    expect(wrapper.find("[data-testid='ability-catalog-page']").exists()).toBe(true);
  });

  it("redirects legacy review route to catalog classify section", async () => {
    const { router } = await mountConsole("/admin/ability-catalog/review");
    expect(router.currentRoute.value.params.tab).toBe("catalog");
    expect(router.currentRoute.value.query.section).toBe("classify");
  });

  it("switches to history via tab click", async () => {
    const { wrapper, router } = await mountConsole("/admin/ability-catalog/catalog");
    await wrapper.find("[data-testid='tab-history']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params.tab).toBe("history");
    expect(wrapper.find("[data-testid='ability-catalog-releases-page']").exists()).toBe(true);
  });
});
