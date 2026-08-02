import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { computed, nextTick, ref } from "vue";
import NavDropdown from "../common/NavDropdown.vue";
import AppHeader from "./AppHeader.vue";

const permissions = ref<string[]>([]);
const authenticated = ref(false);

vi.mock("../../composables/useAuthSession", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useAuthSession: () => ({
      authenticated: computed(() => authenticated.value),
      permissions: computed(() => permissions.value),
      fetchAuthMe: vi.fn().mockResolvedValue({ authenticated: authenticated.value }),
    }),
  };
});

vi.mock("../search/CharacterRealmSearch.vue", () => ({
  default: { name: "CharacterRealmSearch", template: "<div data-testid='navbar-search' />" },
}));

vi.mock("../brand/BrandMark.vue", () => ({
  default: { name: "BrandMark", template: "<span />" },
}));

vi.mock("../../stores/accountCharacters", () => ({
  useAccountCharactersStore: () => ({
    characters: [],
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  }),
}));

const adminItems = [
  { to: "/admin/models", label: "Score models" },
  { to: "/admin/ability-catalog", label: "Ability catalog" },
  { to: "/admin/users", label: "Admin users" },
  { to: "/admin/bulk-processing", label: "Bulk processing" },
  { to: "/admin/scoring-v2", label: "Scoring V2" },
  { to: "/admin/misc", label: "Misc tools" },
];

const FULL_ADMIN_PERMS = [
  "admin.score_models.manage",
  "admin.ability_catalog.read",
  "admin.users.read",
  "admin.jobs.manage",
  "score.candidate.read",
  "admin.settings.manage",
];

function headerRoutes() {
  return [
    { path: "/", name: "home", component: { template: "<div />" } },
    { path: "/compare", name: "compare", component: { template: "<div />" } },
    { path: "/account", name: "account", component: { template: "<div />" } },
    { path: "/administrator", name: "administrator", component: { template: "<div />" } },
    { path: "/admin", name: "admin-root", component: { template: "<div />" } },
    { path: "/admin/models", name: "admin-models", component: { template: "<div />" } },
    {
      path: "/admin/ability-catalog",
      name: "admin-ability-catalog",
      component: { template: "<div />" },
    },
    { path: "/admin/users", name: "admin-users", component: { template: "<div />" } },
    {
      path: "/admin/bulk-processing",
      name: "admin-bulk-processing",
      component: { template: "<div />" },
    },
    {
      path: "/admin/scoring-v2",
      name: "admin-scoring-v2",
      component: { template: "<div />" },
    },
    { path: "/admin/misc", name: "admin-misc", component: { template: "<div />" } },
  ];
}

async function mountHeader(path = "/") {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: headerRoutes(),
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(AppHeader, {
    global: { plugins: [router, pinia] },
  });
  return { wrapper, router };
}

describe("NavDropdown disclosure", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mountDropdown(router?: Router) {
    const r =
      router ??
      createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", component: { template: "<div />" } },
          ...adminItems.map((item) => ({
            path: item.to,
            component: { template: "<div />" },
          })),
        ],
      });
    if (!router) {
      await r.push("/");
      await r.isReady();
    }
    return mount(NavDropdown, {
      attachTo: document.body,
      props: { label: "Admin", items: adminItems, panelId: "admin-nav-menu" },
      attrs: { "data-testid": "admin-nav-dropdown" },
      global: { plugins: [r] },
    });
  }

  it("uses disclosure ARIA (button + expanded/controls, no menu roles)", async () => {
    const wrapper = await mountDropdown();
    const trigger = wrapper.get("[data-testid='nav-dropdown-trigger']");
    expect(trigger.element.tagName).toBe("BUTTON");
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(trigger.attributes("aria-controls")).toBe("admin-nav-menu");
    expect(trigger.attributes("aria-haspopup")).toBeUndefined();
    await trigger.trigger("click");
    await nextTick();
    const panel = wrapper.get("[data-testid='nav-dropdown-menu']");
    expect(panel.attributes("role")).toBeUndefined();
    expect(panel.findAll('[role="menuitem"]')).toHaveLength(0);
    expect(panel.findAll("a")).toHaveLength(6);
    wrapper.unmount();
  });

  it("opens with Enter/Space click activation and closes with Escape restoring focus", async () => {
    const wrapper = await mountDropdown();
    const trigger = wrapper.get("[data-testid='nav-dropdown-trigger']");
    (trigger.element as HTMLButtonElement).focus();

    await trigger.trigger("keydown", { key: "Enter" });
    await trigger.trigger("click");
    await nextTick();
    expect(trigger.attributes("aria-expanded")).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger.element);

    await trigger.trigger("keydown", { key: " " });
    await trigger.trigger("click");
    await nextTick();
    expect(trigger.attributes("aria-expanded")).toBe("true");
    wrapper.unmount();
  });

  it("opens with ArrowDown/ArrowUp focusing first/last destination", async () => {
    const wrapper = await mountDropdown();
    const trigger = wrapper.get("[data-testid='nav-dropdown-trigger']");

    await trigger.trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(document.activeElement?.textContent).toContain("Score models");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();

    await trigger.trigger("keydown", { key: "ArrowUp" });
    await nextTick();
    expect(document.activeElement?.textContent).toContain("Misc tools");
    wrapper.unmount();
  });

  it("closes on outside pointerdown without moving focus to the trigger", async () => {
    const wrapper = await mountDropdown();
    const trigger = wrapper.get("[data-testid='nav-dropdown-trigger']");
    await trigger.trigger("click");
    await nextTick();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(wrapper.find("[data-testid='nav-dropdown-menu']").isVisible()).toBe(false);
    expect(document.activeElement).toBe(outside);
    outside.remove();
    wrapper.unmount();
  });

  it("closes when a destination is selected", async () => {
    const wrapper = await mountDropdown();
    await wrapper.get("[data-testid='nav-dropdown-trigger']").trigger("click");
    await nextTick();
    await wrapper.get('a[href="/admin/models"]').trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid='nav-dropdown-menu']").isVisible()).toBe(false);
    wrapper.unmount();
  });

  it("closes on route change", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/account", component: { template: "<div />" } },
        ...adminItems.map((item) => ({
          path: item.to,
          component: { template: "<div />" },
        })),
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = await mountDropdown(router);
    await wrapper.get("[data-testid='nav-dropdown-trigger']").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid='nav-dropdown-menu']").isVisible()).toBe(true);
    await router.push("/account");
    await flushPromises();
    expect(wrapper.find("[data-testid='nav-dropdown-menu']").isVisible()).toBe(false);
    wrapper.unmount();
  });

  it("removes document listeners on unmount", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const wrapper = await mountDropdown();
    await wrapper.get("[data-testid='nav-dropdown-trigger']").trigger("click");
    await nextTick();
    expect(addSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    wrapper.unmount();
    expect(removeSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("marks the active destination with aria-current=page", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        ...adminItems.map((item) => ({
          path: item.to,
          component: { template: "<div />" },
        })),
      ],
    });
    await router.push("/admin/users");
    await router.isReady();
    const wrapper = await mountDropdown(router);
    await wrapper.get("[data-testid='nav-dropdown-trigger']").trigger("click");
    await nextTick();
    const current = wrapper.get('a[href="/admin/users"]');
    expect(current.attributes("aria-current")).toBe("page");
    expect(wrapper.get('a[href="/admin/models"]').attributes("aria-current")).toBeUndefined();
    wrapper.unmount();
  });
});

describe("AppHeader admin navigation", () => {
  beforeEach(() => {
    permissions.value = [];
    authenticated.value = false;
  });

  afterEach(() => {
    permissions.value = [];
    authenticated.value = false;
  });

  it("hides the Admin dropdown when no destinations are authorized", async () => {
    permissions.value = ["profile.refresh.request", "score.recalculate"];
    const { wrapper } = await mountHeader();
    expect(wrapper.find("[data-testid='admin-nav-dropdown']").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Score models");
    const searchTrigger = wrapper.get("[data-testid='navbar-search-trigger']");
    expect(searchTrigger.attributes("aria-expanded")).toBe("false");
    await searchTrigger.trigger("click");
    await nextTick();
    expect(searchTrigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find("[data-testid='navbar-search']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='navbar-battlenet-sync']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='navbar-account']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows Misc tools when settings permission is granted", async () => {
    permissions.value = ["profile.refresh.request", "admin.settings.manage"];
    const { wrapper } = await mountHeader();
    expect(wrapper.find("[data-testid='admin-nav-dropdown']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Misc tools");
    wrapper.unmount();
  });

  it("shows Account with portrait slot when authenticated", async () => {
    authenticated.value = true;
    const { wrapper } = await mountHeader();
    expect(wrapper.find("[data-testid='navbar-battlenet-sync']").exists()).toBe(false);
    const account = wrapper.get("[data-testid='navbar-account']");
    expect(account.text()).toContain("Account");
    expect(account.attributes("href")).toBe("/account");
    wrapper.unmount();
  });

  it("shows Battle.net sync CTA when logged out", async () => {
    const { wrapper } = await mountHeader();
    const sync = wrapper.get("[data-testid='navbar-battlenet-sync']");
    expect(sync.text()).toContain("Sync with Battle.net");
    expect(wrapper.find("[data-testid='navbar-account']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows only destinations matching the user's permissions", async () => {
    permissions.value = ["admin.ability_catalog.read", "admin.jobs.manage"];
    const { wrapper } = await mountHeader();
    const dropdown = wrapper.get("[data-testid='admin-nav-dropdown']");
    await dropdown.get("[data-testid='nav-dropdown-trigger']").trigger("click");
    await flushPromises();
    const text = dropdown.text();
    expect(text).toContain("Ability catalog");
    expect(text).toContain("Bulk processing");
    expect(text).not.toContain("Score models");
    expect(text).not.toContain("Admin users");
    wrapper.unmount();
  });

  it("shows all admin destinations when fully authorized", async () => {
    permissions.value = FULL_ADMIN_PERMS;
    const { wrapper } = await mountHeader();
    const dropdown = wrapper.get("[data-testid='admin-nav-dropdown']");
    await dropdown.get("[data-testid='nav-dropdown-trigger']").trigger("click");
    await flushPromises();
    const text = dropdown.text();
    expect(text).toContain("Score models");
    expect(text).toContain("Ability catalog");
    expect(text).toContain("Admin users");
    expect(text).toContain("Bulk processing");
    expect(text).toContain("Scoring V2");
    expect(text).toContain("Misc tools");
    wrapper.unmount();
  });

  it("does not render an empty Admin trigger", async () => {
    permissions.value = ["score.recalculate"];
    const { wrapper } = await mountHeader();
    expect(wrapper.find("[data-testid='admin-nav-dropdown']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='nav-dropdown-trigger']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("marks Admin active for /admin and known admin destinations including query/hash", async () => {
    permissions.value = FULL_ADMIN_PERMS;
    for (const path of [
      "/admin",
      "/admin/models",
      "/admin/ability-catalog",
      "/admin/users",
      "/admin/bulk-processing",
      "/admin/scoring-v2",
      "/admin/misc",
      "/admin/users?tab=roles",
      "/admin/models#draft",
    ]) {
      const { wrapper } = await mountHeader(path);
      const trigger = wrapper.get("[data-testid='nav-dropdown-trigger']");
      expect(trigger.classes()).toContain("is-active");
      // Active affordance includes underline, not color alone.
      expect(trigger.classes().join(" ")).toMatch(/is-active/);
      wrapper.unmount();
    }
  });

  it("does not mark Admin active for similarly named non-admin routes", async () => {
    permissions.value = FULL_ADMIN_PERMS;
    const { wrapper } = await mountHeader("/administrator");
    expect(wrapper.get("[data-testid='nav-dropdown-trigger']").classes()).not.toContain("is-active");
    wrapper.unmount();
  });

  it("closes when authorized destinations become empty (session loss)", async () => {
    permissions.value = FULL_ADMIN_PERMS;
    const { wrapper } = await mountHeader();
    await wrapper.get("[data-testid='nav-dropdown-trigger']").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid='nav-dropdown-menu']").isVisible()).toBe(true);
    permissions.value = [];
    await nextTick();
    expect(wrapper.find("[data-testid='admin-nav-dropdown']").exists()).toBe(false);
    wrapper.unmount();
  });
});
