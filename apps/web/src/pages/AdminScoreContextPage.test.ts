import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
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
    seasons: [
      { ...season17, pinnable: true, isBlizzardCurrent: true },
      { ...season18, pinnable: true, isBlizzardCurrent: false },
      {
        id: "placeholder-current",
        slug: "placeholder-current",
        name: "placeholder-current",
        blizzardSeasonId: null,
        pinnable: false,
        isBlizzardCurrent: false,
      },
    ],
  };
}

function state(id: string, status: "DRAFT" | "PUBLISHED", distMissing: boolean) {
  const season = id === "season-18" ? season18 : season17;
  return {
    season,
    published: status === "PUBLISHED" ? revision(status, distMissing) : null,
    draft: status === "DRAFT" ? revision(status, distMissing) : null,
    history: [{ id: "rev-0", version: 1, status: "ARCHIVED", publishedAt: "2026-01-01T00:00:00.000Z" }],
    distributions: distMissing
      ? []
      : [{ id: "dist-1", source: "FIXTURE", sourceVersion: "v1", collectedAt: "2026-01-01T00:00:00.000Z", pointCount: 2 }],
    distributionMissing: distMissing,
    canonicalSpecializations: {
      stepBandHelp: "Players use the factor from the highest median-key threshold they meet.",
      tierSemantics: { 1: "niche / weak" },
      classes: [
        {
          slug: "mage",
          name: "Mage",
          specs: [{ slug: "frost", name: "Frost", role: "DPS" }],
        },
      ],
    },
  };
}

function revision(status: "DRAFT" | "PUBLISHED", distMissing: boolean) {
  return {
    id: "rev-1",
    version: 1,
    status,
    tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1.1 },
    specAssignments: [{ classSlug: "mage", specSlug: "frost", tier: 4 }],
    percentileAnchors: [
      { percentileBps: 9000, factor: 0.9 },
      { percentileBps: 9900, factor: 1.1 },
    ],
    resolvedAnchors: [
      { percentileBps: 9000, percentileLabel: "P90", medianKeyThreshold: 18, factor: 0.9 },
      { percentileBps: 9900, percentileLabel: "P99", medianKeyThreshold: 18, factor: 1.1 },
    ],
    distribution: distMissing
      ? null
      : { id: "dist-1", source: "FIXTURE", sourceVersion: "v1", collectedAt: "2026-01-01T00:00:00.000Z" },
    distributionMissing: distMissing,
  };
}

async function mountPage(authority = scoringSeason("PINNED", season17), contextId = "season-17") {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path.includes("/api/v1/admin/misc/scoring-season")) {
      return jsonResponse(authority);
    }
    if (path.includes(`/seasons/${contextId}/score-context`)) {
      return jsonResponse(state(contextId, contextId === "season-17" ? "DRAFT" : "PUBLISHED", contextId !== "season-17"));
    }
    if (path.endsWith("/api/v1/admin/seasons")) {
      return jsonResponse({
        seasons: [
          season17,
          { ...season17, id: "season-17-us", regionCode: "US" },
          { id: "placeholder-current", slug: "placeholder-current", name: "placeholder-current" },
        ],
      });
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

  it("PINNED Season 17 loads Season 17 context from scoring-season authority", async () => {
    const wrapper = await mountPage(scoringSeason("PINNED", season17), "season-17");
    expect(wrapper.find("[data-testid='admin-score-context']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='season-selector']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='scoring-season-label']").text()).toBe(
      "Blizzard Season 17 / Blizzard 17",
    );
    expect(wrapper.get("[data-testid='scoring-season-mode']").text()).toBe("Pinned");
    expect(wrapper.find("[data-testid='tier-factor-5']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='save-draft']").attributes("disabled")).toBeUndefined();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/api/v1/admin/seasons"))).toBe(
      false,
    );
  });

  it("PINNED Season 18 loads Season 18 context", async () => {
    const wrapper = await mountPage(scoringSeason("PINNED", season18), "season-18");
    expect(wrapper.get("[data-testid='scoring-season-label']").text()).toBe(
      "Blizzard Season 18 / Blizzard 18",
    );
    expect(wrapper.find("[data-testid='missing-distribution']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='published-readonly']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='save-draft']").attributes("disabled")).toBeDefined();
  });

  it("AUTO uses the resolved effective scoring season", async () => {
    const wrapper = await mountPage(scoringSeason("AUTO", season17), "season-17");
    expect(wrapper.get("[data-testid='scoring-season-mode']").text()).toBe("Auto");
    expect(wrapper.get("[data-testid='scoring-season-label']").text()).toBe(
      "Blizzard Season 17 / Blizzard 17",
    );
    expect(wrapper.html()).not.toContain("placeholder-current");
    expect(wrapper.find("[data-testid='season-selector']").exists()).toBe(false);
  });

  it("supports unconfigured specs + draft edits for the authoritative season", async () => {
    const wrapper = await mountPage();
    const spec = wrapper.find("[data-testid='spec-mage-frost']");
    expect(spec.exists()).toBe(true);
    expect((spec.element as HTMLSelectElement).value).toBe("4");
    expect(spec.html()).toContain("Unconfigured");
    expect(wrapper.find("[data-testid='anchor-table']").text()).toContain("P90");
    expect(wrapper.find("[data-testid='anchor-table']").text()).toContain("+18");
    expect(wrapper.find("[data-testid='revision-history']").text()).toContain("ARCHIVED");
    const bpsInput = wrapper.find("[data-testid='add-anchor-row'] input");
    await bpsInput.setValue(8500);
    await wrapper.find("[data-testid='add-anchor']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='remove-anchor-8500']").exists()).toBe(true);
  });
});
