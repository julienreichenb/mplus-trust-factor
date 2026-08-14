import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { RETAIL_CLASS_MATRIX } from "@mplus/abilities";
import { specIconName } from "../lib/wowIcons";
import { routeDefs } from "../routes";
import AdminScoreContextPage from "./AdminScoreContextPage.vue";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const season17 = {
  id: "season-17",
  slug: "blizzard-season-17",
  name: "Season 17",
  blizzardSeasonId: 17,
  regionCode: "EU",
};
const season18 = {
  id: "season-18",
  slug: "blizzard-season-18",
  name: "Season 18",
  blizzardSeasonId: 18,
  regionCode: "EU",
};

const allClasses = RETAIL_CLASS_MATRIX.map((cls) => ({
  slug: cls.slug,
  name: cls.name,
  specs: cls.specs.map((spec) => ({ slug: spec.slug, name: spec.name, role: spec.role })),
}));

const specCount = RETAIL_CLASS_MATRIX.reduce((n, cls) => n + cls.specs.length, 0);

function scoringSeason(mode: "PINNED" | "AUTO", season: typeof season17) {
  return {
    selection: mode === "PINNED" ? { mode, blizzardSeasonId: season.blizzardSeasonId } : { mode },
    version: 1,
    updatedAt: null,
    updatedByUserId: null,
    regionCode: "EU",
    detectedCurrentSeason: season17,
    effectiveScoringSeason: season,
    pinnedDiffersFromDetected: false,
    seasonData: {
      blizzardSeasonId: season.blizzardSeasonId,
      selectionMode: mode,
      identityReady: true,
      catalogReady: true,
      dungeonCount: 8,
      expectedDungeonCount: 8,
      wclZoneId: 47,
      reasons: [],
      lastCatalogSynchronizedAt: null,
      medianKeyDistribution: {
        status: "Ready",
        snapshotId: "dist-1",
        source: "RAIDER_IO_ADDON",
        sourceVersion: "v1",
        collectedAt: "2026-08-14T00:00:00.000Z",
      },
    },
    seasons: [
      { ...season17, pinnable: true, isBlizzardCurrent: true },
      { ...season18, pinnable: true, isBlizzardCurrent: false },
    ],
  };
}

function revision(status: "DRAFT" | "PUBLISHED", distMissing: boolean) {
  return {
    id: "rev-1",
    version: 1,
    status,
    publishedAt: status === "PUBLISHED" ? "2026-08-01T00:00:00.000Z" : null,
    tierFactors: { 1: 0.85, 2: 0.92, 3: 1, 4: 1.08, 5: 1.15 },
    specAssignments: [{ classSlug: "mage", specSlug: "frost", tier: 3 as const }],
    percentileAnchors: [
      { percentileBps: 5000, factor: 0.8 },
      { percentileBps: 7500, factor: 0.9 },
      { percentileBps: 9000, factor: 1 },
      { percentileBps: 9500, factor: 1.05 },
      { percentileBps: 9900, factor: 1.15 },
      { percentileBps: 9990, factor: 1.3 },
    ],
    resolvedAnchors: [
      { percentileBps: 5000, percentileLabel: "P50", medianKeyThreshold: 12, factor: 0.8 },
      { percentileBps: 7500, percentileLabel: "P75", medianKeyThreshold: 15, factor: 0.9 },
      { percentileBps: 9000, percentileLabel: "P90", medianKeyThreshold: 18, factor: 1 },
      { percentileBps: 9500, percentileLabel: "P95", medianKeyThreshold: 20, factor: 1.05 },
      { percentileBps: 9900, percentileLabel: "P99", medianKeyThreshold: 22, factor: 1.15 },
      { percentileBps: 9990, percentileLabel: "P99.9", medianKeyThreshold: 24, factor: 1.3 },
    ],
    distribution: distMissing
      ? null
      : { id: "dist-1", source: "RAIDER_IO", sourceVersion: "v1", collectedAt: "2026-08-14T00:00:00.000Z" },
    distributionMissing: distMissing,
  };
}

function state(id: string, status: "DRAFT" | "PUBLISHED", distMissing: boolean, newerDistribution = false) {
  const season = id === "season-18" ? season18 : season17;
  const rev = revision(status, distMissing);
  return {
    season,
    published: status === "PUBLISHED" ? rev : null,
    draft: status === "DRAFT" ? rev : null,
    history: [{ id: "rev-0", version: 1, status: "ARCHIVED", publishedAt: "2026-01-01T00:00:00.000Z" }],
    distributions: distMissing
      ? []
      : [{ id: "dist-1", source: "RAIDER_IO", sourceVersion: "v1", collectedAt: "2026-08-14T00:00:00.000Z", pointCount: 6 }],
    latestDistribution: distMissing
      ? null
      : {
          id: "dist-1",
          source: "RAIDER_IO",
          sourceVersion: "v1",
          collectedAt: "2026-08-14T00:00:00.000Z",
          points: [
            { percentileBps: 5000, medianKeyThreshold: 12 },
            { percentileBps: 7500, medianKeyThreshold: 15 },
            { percentileBps: 9000, medianKeyThreshold: 18 },
            { percentileBps: 9500, medianKeyThreshold: 20 },
            { percentileBps: 9900, medianKeyThreshold: 22 },
            { percentileBps: 9990, medianKeyThreshold: 24 },
          ],
        },
    distributionMissing: distMissing,
    keyRows: distMissing
      ? []
      : [
          { percentileBps: 6000, percentileLabel: "P60", factor: 0.9, thresholds: { EU: 14, US: 13, KR: 15, TW: 14 } },
          { percentileBps: 7500, percentileLabel: "P75", factor: 0.95, thresholds: { EU: 16, US: 15, KR: 16, TW: 15 } },
          { percentileBps: 9000, percentileLabel: "P90", factor: 1, thresholds: { EU: 18, US: 17, KR: 18, TW: 17 } },
          { percentileBps: 9900, percentileLabel: "P99", factor: 1.15, thresholds: { EU: 22, US: 21, KR: 22, TW: 21 } },
          { percentileBps: 9990, percentileLabel: "P99.9", factor: 1.3, thresholds: { EU: 23, US: 22, KR: 23, TW: 22 } },
        ],
    regions: {
      EU: {
        seasonId: id,
        catalogReady: true,
        latestDistribution: null,
        hasNewerDistribution: newerDistribution,
        boundSnapshotId: distMissing ? null : "dist-1",
        refreshStatus: distMissing
          ? { status: "Idle" as const, refreshId: null, errorMessage: null, snapshotId: null }
          : { status: "Available" as const, refreshId: null, errorMessage: null, snapshotId: "dist-1" },
      },
      US: {
        seasonId: null,
        catalogReady: false,
        latestDistribution: null,
        refreshStatus: { status: "Available" as const, refreshId: null, errorMessage: null, snapshotId: "dist-us" },
      },
      KR: {
        seasonId: null,
        catalogReady: false,
        latestDistribution: null,
        refreshStatus: { status: "Idle" as const, refreshId: null, errorMessage: null, snapshotId: null },
      },
      TW: {
        seasonId: null,
        catalogReady: false,
        latestDistribution: null,
        refreshStatus: { status: "Idle" as const, refreshId: null, errorMessage: null, snapshotId: null },
      },
    },
    keyDistributionRefresh: distMissing
      ? { status: "Idle" as const, refreshId: null, errorMessage: null, snapshotId: null }
      : { status: "Available" as const, refreshId: null, errorMessage: null, snapshotId: "dist-1" },
    canonicalSpecializations: {
      stepBandHelp: "unused",
      tierSemantics: { 1: "niche / weak" },
      classes: allClasses,
    },
  };
}

function headerValue(init: unknown, name: string): string | null {
  const headers = (init as { headers?: HeadersInit } | undefined)?.headers;
  if (!headers) return null;
  return new Headers(headers).get(name);
}

async function mountPage(
  authority = scoringSeason("PINNED", season17),
  contextId = "season-17",
  options?: { hasNewerDistribution?: boolean },
) {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const path = String(url);
    if (path.includes("/api/v1/admin/misc/scoring-season")) {
      return jsonResponse(authority);
    }
    if (path.includes(`/seasons/${contextId}/score-context/draft`) && init?.method === "POST") {
      return jsonResponse(revision("DRAFT", contextId !== "season-17"));
    }
    if (path.includes("/publish") && init?.method === "POST") {
      return jsonResponse({
        recalc: { status: "QUEUED", bulkOperationId: "bulk-1", error: null, retryAvailable: true },
      });
    }
    if (path.includes("/key-distribution/refresh") && init?.method === "POST") {
      return jsonResponse({ ok: true });
    }
    if (path.includes("/use-latest-distribution") && init?.method === "POST") {
      return jsonResponse({ ok: true });
    }
    if (path.includes("/score-context/recalculate") && init?.method === "POST") {
      return jsonResponse({
        recalc: { status: "QUEUED", bulkOperationId: "bulk-2", error: null, retryAvailable: false },
      });
    }
    if (path.includes(`/seasons/${contextId}/score-context`)) {
      return jsonResponse(
        state(
          contextId,
          contextId === "season-17" ? "DRAFT" : "PUBLISHED",
          contextId !== "season-17",
          options?.hasNewerDistribution,
        ),
      );
    }
    if (path.includes("/score-context/revisions/") && init?.method === "PATCH") {
      return jsonResponse({ ok: true });
    }
    if (path.endsWith("/api/v1/admin/seasons")) {
      return jsonResponse({ seasons: [season17] });
    }
    return jsonResponse({});
  });
  const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
  await router.push("/admin/scoring/context");
  await router.isReady();
  const wrapper = mount(AdminScoreContextPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe("AdminScoreContextPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("renders Key/Meta tabs and scoring-season authority without JSON import", async () => {
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='tab-key']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='tab-meta']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='season-selector']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='scoring-season-label']").text()).toBe("Blizzard Season 17 / Blizzard 17");
    expect(wrapper.get("[data-testid='scoring-season-mode']").text()).toBe("Pinned");
    expect(wrapper.find("[data-testid='distribution-json']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='import-distribution']").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Import distribution snapshot");
    expect(wrapper.text()).not.toContain("FIXTURE_LOCAL");
    expect(wrapper.text()).not.toContain("percentileBps");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/api/v1/admin/seasons"))).toBe(false);
  });

  it("Key table shows season percentiles and only factor is editable", async () => {
    const wrapper = await mountPage();
    const table = wrapper.get("[data-testid='anchor-table']");
    expect(table.text()).toContain("P60");
    expect(table.text()).toContain("P75");
    expect(table.text()).toContain("P90");
    expect(table.text()).toContain("P99");
    expect(table.text()).toContain("P99.9");
    expect(table.text()).toContain("EU");
    expect(table.text()).toContain("US");
    expect(table.text()).toContain("KR");
    expect(table.text()).toContain("TW");
    expect(table.text()).toContain("+18");
    expect(table.text()).toContain("+17");
    expect(wrapper.find("[data-testid='add-anchor']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='key-percentile-readonly']").attributes("readonly")).toBeDefined();
    expect(wrapper.find("[data-testid='key-threshold-readonly-EU']").attributes("readonly")).toBeDefined();
    const factor = wrapper.get("[data-testid='key-factor-9000']");
    expect(factor.attributes("disabled")).toBeUndefined();
    await factor.setValue("0.95");
    await factor.trigger("change");
    await flushPromises();
    expect(wrapper.find("[data-testid='unsaved-changes']").exists()).toBe(true);
  });

  it("shows unavailable copy when the season has no key distribution", async () => {
    const wrapper = await mountPage(scoringSeason("PINNED", season18), "season-18");
    expect(wrapper.get("[data-testid='missing-distribution']").text()).toContain(
      "Key difficulty distribution unavailable for this season",
    );
    expect(wrapper.find("[data-testid='anchor-table']").exists()).toBe(false);
  });

  it("Meta tab lists every canonical spec once across tiers plus Unassigned", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='tab-meta']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='meta-tier-5']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='meta-tier-1']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='meta-unassigned']").exists()).toBe(true);
    const tiles = wrapper.findAll("[data-testid^='spec-']");
    expect(tiles.length).toBe(specCount);
    const keys = tiles.map((t) => t.attributes("data-testid"));
    expect(new Set(keys).size).toBe(specCount);
    expect(wrapper.find("[data-testid='spec-mage-frost']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='tier-factor-wrap-5']").html()).toContain("tier-factor-5");
    const frostIcon = wrapper.get("[data-testid='spec-mage-frost']").find("[data-testid='wow-icon']");
    expect(frostIcon.exists()).toBe(true);
    expect(frostIcon.attributes("src") ?? "").toContain(specIconName("mage", "frost") ?? "missing");
    expect(wrapper.find(".spec-tile__move").exists()).toBe(false);
    expect(wrapper.get("[data-testid='spec-mage-frost']").attributes("style") ?? "").toContain(
      "background-color: rgb(63, 199, 235)",
    );
  });

  it("dragging Frost Mage from Tier 3 to Tier 5 updates only that spec", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='tab-meta']").trigger("click");
    await flushPromises();
    const frost = wrapper.get("[data-testid='spec-mage-frost']");
    expect(wrapper.get("[data-testid='meta-tier-pool-3']").find("[data-testid='spec-mage-frost']").exists()).toBe(
      true,
    );
    await frost.trigger("dragstart");
    await wrapper.get("[data-testid='meta-tier-5']").trigger("drop");
    await flushPromises();
    expect(wrapper.get("[data-testid='meta-tier-pool-5']").find("[data-testid='spec-mage-frost']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='meta-tier-pool-3']").find("[data-testid='spec-mage-frost']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='unsaved-changes']").exists()).toBe(true);
    const fire = wrapper.find("[data-testid='spec-mage-fire']");
    expect(fire.exists()).toBe(true);
    expect(wrapper.get("[data-testid='meta-unassigned-pool']").find("[data-testid='spec-mage-fire']").exists()).toBe(true);
  });

  it("dropping a spec on Unassigned marks it unconfigured", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='tab-meta']").trigger("click");
    await flushPromises();
    await wrapper.get("[data-testid='spec-mage-frost']").trigger("dragstart");
    await wrapper.get("[data-testid='meta-unassigned']").trigger("drop");
    await flushPromises();
    expect(wrapper.get("[data-testid='meta-unassigned-pool']").find("[data-testid='spec-mage-frost']").exists()).toBe(true);
  });

  it("tab switch keeps unsaved factor edits", async () => {
    const wrapper = await mountPage();
    const factor = wrapper.get("[data-testid='key-factor-9000']");
    await factor.setValue("0.95");
    await factor.trigger("change");
    await wrapper.get("[data-testid='tab-meta']").trigger("click");
    await wrapper.get("[data-testid='tab-key']").trigger("click");
    await flushPromises();
    expect((wrapper.get("[data-testid='key-factor-9000']").element as HTMLInputElement).value).toBe("0.95");
    expect(wrapper.find("[data-testid='unsaved-changes']").exists()).toBe(true);
  });

  it("Save draft persists local edits", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='key-factor-9000']").setValue("0.95");
    await wrapper.get("[data-testid='key-factor-9000']").trigger("change");
    await wrapper.get("[data-testid='save-draft']").trigger("click");
    await flushPromises();
    const patch = fetchMock.mock.calls.find((call) => String(call[0]).includes("/score-context/revisions/") && call[1]?.method === "PATCH");
    expect(patch).toBeTruthy();
    const body = JSON.parse(String(patch![1]?.body));
    expect(body.percentileAnchors.find((a: { percentileBps: number }) => a.percentileBps === 9000).factor).toBe(0.95);
    expect(headerValue(patch![1], "Content-Type")).toBe("application/json");
    expect(headerValue(patch![1], "Accept")).toBe("application/json");
  });

  it("empty-body POSTs omit JSON Content-Type and still reach the mocked endpoints", async () => {
    const wrapper = await mountPage(scoringSeason("PINNED", season17), "season-17", { hasNewerDistribution: true });

    await wrapper.get("[data-testid='publish-draft']").trigger("click");
    await flushPromises();
    const publish = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes("/publish") && call[1]?.method === "POST",
    );
    expect(publish).toBeTruthy();
    expect(headerValue(publish![1], "Content-Type")).toBeNull();
    expect(headerValue(publish![1], "Accept")).toBe("application/json");
    expect(wrapper.text()).toContain("Recalculation queued");

    await wrapper.get("[data-testid='refresh-rio-distribution']").trigger("click");
    await flushPromises();
    const refresh = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes("/key-distribution/refresh") && call[1]?.method === "POST",
    );
    expect(refresh).toBeTruthy();
    expect(headerValue(refresh![1], "Content-Type")).toBeNull();

    await wrapper.get("[data-testid='use-latest-distribution']").trigger("click");
    await flushPromises();
    const adopt = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes("/use-latest-distribution") && call[1]?.method === "POST",
    );
    expect(adopt).toBeTruthy();
    expect(headerValue(adopt![1], "Content-Type")).toBeNull();

    await wrapper.get("[data-testid='retry-recalc']").trigger("click");
    await flushPromises();
    const retry = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes("/score-context/recalculate") && call[1]?.method === "POST",
    );
    expect(retry).toBeTruthy();
    expect(headerValue(retry![1], "Content-Type")).toBeNull();
  });

  it("AUTO uses the resolved effective scoring season", async () => {
    const wrapper = await mountPage(scoringSeason("AUTO", season17), "season-17");
    expect(wrapper.get("[data-testid='scoring-season-mode']").text()).toBe("Auto");
    expect(wrapper.find("[data-testid='season-selector']").exists()).toBe(false);
  });
});
