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

const seasonA = {
  id: "season-a",
  slug: "season-a",
  name: "Season A",
  isCurrent: false,
};
const seasonB = {
  id: "season-b",
  slug: "season-b",
  name: "Season B",
  isCurrent: true,
};

function state(id: string, status: "DRAFT" | "PUBLISHED", distMissing: boolean) {
  return {
    season: { ... (id === "season-a" ? seasonA : seasonB), blizzardSeasonId: 1, regionCode: "EU" },
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

async function mountPage() {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path.endsWith("/api/v1/admin/seasons")) {
      return jsonResponse({ seasons: [seasonA, seasonB] });
    }
    if (path.includes("/seasons/season-b/score-context")) {
      return jsonResponse(state("season-b", "PUBLISHED", true));
    }
    if (path.includes("/seasons/season-a/score-context")) {
      return jsonResponse(state("season-a", "DRAFT", false));
    }
    return jsonResponse({});
  });
  const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
  await router.push("/admin/scoring/context");
  await router.isReady();
  const wrapper = mount(AdminScoreContextPage, { global: { plugins: [router] } });
  await flushPromises();
  await wrapper.find("[data-testid='season-selector']").setValue("season-a");
  await flushPromises();
  return wrapper;
}

describe("AdminScoreContextPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("loads season-specific config and supports unconfigured specs + draft edits", async () => {
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='admin-score-context']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='tier-factor-5']").exists()).toBe(true);
    const spec = wrapper.find("[data-testid='spec-mage-frost']");
    expect(spec.exists()).toBe(true);
    expect((spec.element as HTMLSelectElement).value).toBe("4");
    expect(spec.html()).toContain("Unconfigured");
    expect(wrapper.find("[data-testid='anchor-table']").text()).toContain("P90");
    expect(wrapper.find("[data-testid='anchor-table']").text()).toContain("+18");
    expect(wrapper.find("[data-testid='save-draft']").attributes("disabled")).toBeUndefined();
    expect(wrapper.find("[data-testid='revision-history']").text()).toContain("ARCHIVED");
    expect(wrapper.find("[data-testid='add-anchor']").exists()).toBe(true);
    const bpsInput = wrapper.find("[data-testid='add-anchor-row'] input");
    await bpsInput.setValue(8500);
    await wrapper.find("[data-testid='add-anchor']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='remove-anchor-8500']").exists()).toBe(true);

    await wrapper.find("[data-testid='season-selector']").setValue("season-b");
    await flushPromises();
    expect(wrapper.find("[data-testid='missing-distribution']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='published-readonly']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='save-draft']").attributes("disabled")).toBeDefined();
  });
});
