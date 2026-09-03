import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { routeDefs } from "../../routes";
import RelevantCharacterRefreshPanel from "./RelevantCharacterRefreshPanel.vue";
import type { AdminRelevantRefreshSettingsDTO } from "@mplus/contracts";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("RelevantCharacterRefreshPanel", () => {
  const fetchMock = vi.fn();

  const relevantRefreshStatus: AdminRelevantRefreshSettingsDTO = {
    relevantRefreshEnabled: false,
    refreshConcurrencyEnabled: false,
    concurrencyOperation: 2,
    concurrencyHardMax: 8,
    relevantCandidateTarget: 500,
    relevantCandidatePercentileBps: 9000,
    relevantPopulationTopPercent: 10,
    wclPreResetDrainSeconds: 300,
    killSwitchActive: false,
    appEnv: "development",
    automaticSchedulingActive: false,
    settingsVersion: 1,
    updatedAt: null,
  } as AdminRelevantRefreshSettingsDTO;

  function mountPanel() {
    vi.stubGlobal("fetch", fetchMock);

    const router = createRouter({
      history: createMemoryHistory(),
      routes: routeDefs,
    });
    void router.push("/admin/bulk-processing");
    void router.isReady();

    return mount(RelevantCharacterRefreshPanel, {
      global: { plugins: [router] },
    });
  }

  it("loads relevant refresh and saves updated settings", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (String(url).includes("/api/v1/admin/misc/relevant-refresh")) {
        if (init?.method === "PUT") {
          return jsonResponse({ ...relevantRefreshStatus, relevantRefreshEnabled: true, settingsVersion: 2 });
        }
        return jsonResponse(relevantRefreshStatus);
      }
      return jsonResponse({ ok: true });
    });

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.get("[data-testid='relevant-refresh-app-env']").text()).toBe("development");
    expect(wrapper.get("[data-testid='relevant-refresh-scheduling']").text()).toMatch(
      /Disabled in local development/i,
    );

    await wrapper.get("[data-testid='relevant-refresh-enabled']").setValue(true);
    await wrapper.get("[data-testid='save-relevant-refresh-button']").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/admin/misc/relevant-refresh"),
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
      }),
    );
    expect(wrapper.get("[data-testid='status-banner']").text()).toMatch(/saved/i);
  });

  it("queues relevant discovery now via admin Run Now", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, _init?: { method?: string; body?: string }) => {
      if (String(url).includes("/api/v1/admin/misc/relevant-refresh/run")) {
        return jsonResponse({
          jobId: "job-1",
          dedupeKey: "dedupe-1",
          reused: false,
          enqueued: true,
          mode: "daily_discovery",
          regionCode: "EU",
          trigger: "admin",
        });
      }

      if (String(url).includes("/api/v1/admin/misc/relevant-refresh")) return jsonResponse(relevantRefreshStatus);

      return jsonResponse({ ok: true });
    });

    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.get("[data-testid='run-relevant-discovery-button']").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/admin/misc/relevant-refresh/run"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: expect.stringContaining('"regionCode":"EU"'),
      }),
    );
    expect(wrapper.get("[data-testid='status-banner']").text()).toMatch(/job-1/);
  });
});

