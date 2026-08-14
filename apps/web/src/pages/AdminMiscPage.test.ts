import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { routeDefs } from "../routes";

const syncRealmCatalog = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    syncRealmCatalog: (...args: unknown[]) => syncRealmCatalog(...args),
  },
}));

import AdminMiscPage from "./AdminMiscPage.vue";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const scoringSeasonStatus = {
  selection: { mode: "AUTO" as const },
  version: 1,
  updatedAt: null,
  updatedByUserId: null,
  regionCode: "EU",
  detectedCurrentSeason: {
    id: "s17",
    slug: "blizzard-season-17",
    name: "Season 17",
    blizzardSeasonId: 17,
  },
  effectiveScoringSeason: {
    id: "s17",
    slug: "blizzard-season-17",
    name: "Season 17",
    blizzardSeasonId: 17,
    wclZoneId: 47,
    catalogReady: true,
  },
  pinnedDiffersFromDetected: false,
  seasons: [],
};

async function mountPage() {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/api/v1/admin/misc/scoring-season")) {
      return jsonResponse(scoringSeasonStatus);
    }
    return jsonResponse({ ok: true, results: [] });
  });
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
    syncRealmCatalog.mockReset();
    fetchMock.mockReset();
  });

  it("posts a realm catalog sync for the selected regions once and renders indexEntries", async () => {
    syncRealmCatalog.mockResolvedValue({
      ok: true,
      results: [
        {
          region: "EU",
          indexEntries: 10,
          rejectedAtIndex: 0,
          detailCandidates: 10,
          detailsFetched: 0,
          eligible: 10,
          rejectedTournament: 0,
          rejectedInternal: 0,
          detailFailures: 0,
          retainedLastKnownGood: 0,
          newlyDeactivated: 0,
          activeCatalogCount: 10,
          rejectedSamples: [],
          upserted: 10,
          minimallyUpserted: 0,
          enriched: 0,
          enrichmentFailures: 0,
          skippedDetails: 10,
          errors: [],
        },
      ],
    });

    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='admin-misc-page']").exists()).toBe(true);
    await wrapper.get("[data-testid='sync-realms-button']").trigger("click");
    await flushPromises();

    expect(syncRealmCatalog).toHaveBeenCalledTimes(1);
    expect(syncRealmCatalog).toHaveBeenCalledWith({
      regions: ["EU"],
      forceDetails: false,
    });
    expect(wrapper.get("[data-testid='realm-sync-results']").text()).toMatch(/EU/);
    expect(wrapper.get("[data-testid='realm-sync-results']").text()).toMatch(/index 10/);
    expect(wrapper.get("[data-testid='realm-sync-results']").text()).toMatch(/eligible 10/);
    expect(wrapper.get("[data-testid='status-banner']").text()).toMatch(/refreshed/i);
    expect(syncRealmCatalog).toHaveBeenCalledTimes(1);
  });

  it("posts a season authority sync for the selected regions", async () => {
    const wrapper = await mountPage();
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (String(url).includes("/api/v1/admin/misc/season/sync-authority") && init?.method === "POST") {
        return jsonResponse({
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
        });
      }
      return jsonResponse(scoringSeasonStatus);
    });

    await wrapper.get("[data-testid='sync-season-button']").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/admin/misc/season/sync-authority"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(wrapper.get("[data-testid='season-sync-results']").text()).toMatch(/blizzard-season-17/);
    expect(wrapper.get("[data-testid='status-banner']").text()).toMatch(/changed/i);
  });

  it("saves scoring-season with PUT, credentials, and JSON content-type", async () => {
    const wrapper = await mountPage();
    fetchMock.mockClear();
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (String(url).includes("/api/v1/admin/misc/scoring-season") && init?.method === "PUT") {
        return jsonResponse({
          ...scoringSeasonStatus,
          version: 2,
        });
      }
      return jsonResponse(scoringSeasonStatus);
    });

    await wrapper.get("[data-testid='save-scoring-season-button']").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/admin/misc/scoring-season"),
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(wrapper.get("[data-testid='status-banner']").text()).toMatch(/Auto/i);
  });

  it("renders Mode and Season as designed AdminSelect controls on one row", async () => {
    const wrapper = await mountPage();
    const controls = wrapper.get(".scoring-season-controls");
    expect(controls.find("[data-testid='scoring-season-mode']").exists()).toBe(true);
    expect(controls.find("[data-testid='scoring-season-pin']").exists()).toBe(true);
    expect(controls.text()).toContain("Mode");
    expect(controls.text()).toContain("Season");
    expect(wrapper.get("[data-testid='detected-blizzard-season']").text()).toBe(
      "Blizzard Season 17 / Blizzard 17",
    );
    expect(wrapper.get("[data-testid='effective-scoring-season']").text()).toBe(
      "Blizzard Season 17 / Blizzard 17",
    );
  });
});
