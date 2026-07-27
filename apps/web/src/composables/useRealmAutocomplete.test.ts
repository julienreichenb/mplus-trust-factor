import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { useRealmAutocomplete } from "./useRealmAutocomplete";
import HomePage from "../pages/HomePage.vue";
import { routeDefs } from "../routes";

vi.mock("../api/client", () => ({
  api: {
    searchRealms: vi.fn(async (_region: string, query: string) => {
      const q = query.trim().toLowerCase();
      const all = [
        { slug: "tarren-mill", name: "Tarren Mill" },
        { slug: "twisting-nether", name: "Twisting Nether" },
        { slug: "kazzak", name: "Kazzak" },
      ];
      if (!q) return all;
      return all.filter((r) => r.slug.includes(q) || r.name.toLowerCase().includes(q));
    }),
  },
}));

describe("useRealmAutocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects a realm into the input and stores the canonical slug", async () => {
    const region = ref("EU");
    const query = ref("tarren");
    const ac = useRealmAutocomplete(region, query, 0);

    await ac.search("tarren");
    expect(ac.suggestions.value.some((r) => r.slug === "tarren-mill")).toBe(true);

    await ac.select({ slug: "tarren-mill", name: "Tarren Mill" });
    expect(query.value).toBe("Tarren Mill");
    expect(ac.selectedSlug.value).toBe("tarren-mill");
    expect(ac.selectedLabel.value).toBe("Tarren Mill");
    expect(ac.open.value).toBe(false);
    expect(ac.resolveRealmSlug()).toBe("tarren-mill");
  });

  it("clears the selected slug when the user edits the input", async () => {
    const region = ref("EU");
    const query = ref("");
    const ac = useRealmAutocomplete(region, query, 0);

    await ac.select({ slug: "tarren-mill", name: "Tarren Mill" });
    expect(ac.selectedSlug.value).toBe("tarren-mill");

    query.value = "Tarren Mill edited";
    await nextTick();
    expect(ac.selectedSlug.value).toBeNull();
    expect(ac.selectedLabel.value).toBeNull();
  });

  it("supports keyboard navigation and Enter selection", async () => {
    const region = ref("EU");
    const query = ref("t");
    const ac = useRealmAutocomplete(region, query, 0);

    await ac.search("t");
    expect(ac.open.value).toBe(true);
    expect(ac.activeIndex.value).toBe(0);

    ac.onKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(ac.activeIndex.value).toBe(1);

    ac.onKeydown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(ac.activeIndex.value).toBe(0);

    const active = ac.suggestions.value[0]!;
    ac.onKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(query.value).toBe(active.name);
    expect(ac.selectedSlug.value).toBe(active.slug);
    expect(ac.open.value).toBe(false);
  });

  it("closes the dropdown on Escape", async () => {
    const region = ref("EU");
    const query = ref("tar");
    const ac = useRealmAutocomplete(region, query, 0);
    await ac.search("tar");
    expect(ac.open.value).toBe(true);

    ac.onKeydown(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(ac.open.value).toBe(false);
  });

  it("does not close while a selection is in progress (blur race)", async () => {
    const region = ref("EU");
    const query = ref("tarren");
    const ac = useRealmAutocomplete(region, query, 0);
    await ac.search("tarren");

    const selectPromise = ac.select({ slug: "tarren-mill", name: "Tarren Mill" });
    ac.onBlur();
    vi.advanceTimersByTime(150);
    await selectPromise;
    expect(ac.open.value).toBe(false);
    expect(query.value).toBe("Tarren Mill");
    expect(ac.selectedSlug.value).toBe("tarren-mill");
  });

  it("ignores stale debounced searches after a selection", async () => {
    const region = ref("EU");
    const query = ref("");
    const ac = useRealmAutocomplete(region, query, 250);

    query.value = "tarren";
    await nextTick();
    await ac.select({ slug: "tarren-mill", name: "Tarren Mill" });
    expect(ac.open.value).toBe(false);

    vi.advanceTimersByTime(250);
    await flushPromises();
    expect(ac.open.value).toBe(false);
    expect(query.value).toBe("Tarren Mill");
    expect(ac.selectedSlug.value).toBe("tarren-mill");
  });
});

describe("HomePage realm combobox", () => {
  async function mountHome() {
    setActivePinia(createPinia());
    const router = createRouter({
      history: createMemoryHistory(),
      routes: routeDefs,
    });
    await router.push("/");
    await router.isReady();
    return mount(HomePage, {
      global: {
        plugins: [router],
      },
    });
  }

  it("selects a suggestion with mousedown and updates the input", async () => {
    vi.useRealTimers();
    const wrapper = await mountHome();
    const input = wrapper.get('[data-testid="realm-input"]');
    await input.trigger("focus");
    await input.setValue("tarren");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 300));
    await flushPromises();

    const option = wrapper.get('[data-testid="realm-option-tarren-mill"]');
    expect(option.attributes("role")).toBe("option");
    await option.trigger("mousedown");
    await flushPromises();

    expect((input.element as HTMLInputElement).value).toBe("Tarren Mill");
    expect(wrapper.find('[data-testid="realm-suggestions"]').exists()).toBe(false);
    expect(input.attributes("role")).toBe("combobox");
  });

  it("selects the active suggestion with Enter", async () => {
    vi.useRealTimers();
    const wrapper = await mountHome();
    const input = wrapper.get('[data-testid="realm-input"]');
    await input.trigger("focus");
    await input.setValue("tarren");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 300));
    await flushPromises();

    expect(wrapper.find('[data-testid="realm-suggestions"]').exists()).toBe(true);
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect((input.element as HTMLInputElement).value).toBe("Tarren Mill");
    expect(wrapper.find('[data-testid="realm-suggestions"]').exists()).toBe(false);
  });
});
