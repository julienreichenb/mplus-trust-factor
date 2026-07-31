import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import AdminMiscPage from "./AdminMiscPage.vue";
import { routeDefs } from "../routes";

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
  await router.push("/admin/misc");
  await router.isReady();
  const wrapper = mount(AdminMiscPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

describe("AdminMiscPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts a realm catalog sync for the selected regions", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        results: [
          {
            region: "EU",
            indexed: 10,
            upserted: 10,
            detailsFetched: 0,
            skippedDetails: 10,
            errors: [],
          },
        ],
      }),
    );

    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='admin-misc-page']").exists()).toBe(true);
    await wrapper.get("[data-testid='sync-realms-button']").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/admin/misc/realms/sync"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      regions: ["EU"],
      forceDetails: false,
    });
    expect(wrapper.get("[data-testid='realm-sync-results']").text()).toMatch(/EU/);
    expect(wrapper.get("[data-testid='status-banner']").text()).toMatch(/refreshed/i);
  });

  it("posts a season authority sync for the selected regions", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        results: [
          {
            region: "EU",
            previous: { blizzardSeasonId: 13, slug: "blizzard-season-13" },
            current: {
              blizzardSeasonId: 17,
              slug: "blizzard-season-17",
              authoritySource: "season_index.current_season",
              authorityVerifiedAt: "2026-07-31T12:00:00.000Z",
            },
            changed: true,
          },
        ],
      }),
    );

    const wrapper = await mountPage();
    await wrapper.get("[data-testid='sync-season-button']").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/admin/misc/season/sync-authority"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(wrapper.get("[data-testid='season-sync-results']").text()).toMatch(/blizzard-season-17/);
    expect(wrapper.get("[data-testid='status-banner']").text()).toMatch(/changed/i);
  });
});
