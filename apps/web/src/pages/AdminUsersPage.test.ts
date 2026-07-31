import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminUsersPage from "./AdminUsersPage.vue";
import { routeDefs } from "../routes";

vi.mock("../composables/useAuthSession", () => ({
  useAuthSession: () => ({
    canManageUsers: { value: true },
    hasPermission: (p: string) =>
      p === "admin.jobs.manage" || p === "admin.users.manage" || p === "admin.users.read",
    fetchAuthMe: vi.fn(async () => undefined),
  }),
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function mountPage() {
  vi.stubGlobal("fetch", fetchMock);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeDefs,
  });
  await router.push("/admin/users");
  await router.isReady();
  const wrapper = mount(AdminUsersPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

describe("AdminUsersPage UI consistency", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not render an empty status banner", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/admin/roles")) return jsonResponse({ roles: [] });
      return jsonResponse({});
    });
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='status-banner']").exists()).toBe(false);
    expect(wrapper.find(".banner").exists()).toBe(false);
  });

  it("renders compact job rows with identity, model version, and status chip", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/admin/roles")) return jsonResponse({ roles: [] });
      if (url.includes("/admin/refresh-jobs/count")) return jsonResponse({ count: 1 });
      if (url.includes("/admin/refresh-jobs?")) {
        return jsonResponse({
          jobs: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              characterId: "c1",
              region: "EU",
              realmSlug: "tarren-mill",
              name: "Aleria",
              classSlug: "mage",
              classColor: "#3FC7EB",
              avatarUrl: null,
              classIconUrl: null,
              mythicPlusScore: 3000,
              battleTag: "Tester#1",
              battleNetEmail: "owner@example.com",
              scoringModelKey: "default",
              scoringModelVersion: 6,
              databaseStatus: "FAILED",
              queueState: "failed",
              triggerSource: "SYSTEM",
              fromBulk: false,
              priority: 0,
              retryable: true,
              latestError: { code: "X", message: "boom" },
              cancelRequested: false,
              createdAt: "2026-07-30T12:00:00.000Z",
              startedAt: null,
              finishedAt: "2026-07-30T12:01:00.000Z",
              actions: { rerun: true, prioritize: false, cancel: false },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
        });
      }
      return jsonResponse({});
    });

    const wrapper = await mountPage();
    await wrapper.get("[data-testid='tab-refresh-jobs']").trigger("click");
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.find("[data-testid='job-row']").exists()).toBe(true);
    });

    const row = wrapper.get("[data-testid='job-row']");
    expect(row.find("[data-testid='character-identity']").exists()).toBe(true);
    expect(row.text()).toMatch(/EU/);
    expect(row.text()).toMatch(/Aleria/i);
    expect(row.text()).toMatch(/default@6/);
    expect(row.text()).toMatch(/Failed/i);
    expect(row.text()).toMatch(/Tester#1/);

    const historical = wrapper.get("[data-testid='historical-failures-control']");
    expect(historical.text()).toMatch(/Include past failures/i);
    expect(wrapper.find("[data-testid='show-historical-failures']").exists()).toBe(true);

    const filters = wrapper.get("[data-testid='refresh-jobs-filters']");
    expect(filters.findAll("select.admin-control").length).toBeGreaterThan(0);
    expect(filters.findAll("input.admin-control").length).toBeGreaterThan(0);
  });

  it("shows a banner only when message content is present", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/admin/roles")) return jsonResponse({ roles: [] });
      return jsonResponse({});
    });
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='status-banner']").exists()).toBe(false);

    await wrapper.find('input[name="q"]').setValue("a");
    await wrapper.get("form.search").trigger("submit");
    await flushPromises();
    expect(wrapper.find("[data-testid='status-banner']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='status-banner']").text().length).toBeGreaterThan(0);
  });
});
