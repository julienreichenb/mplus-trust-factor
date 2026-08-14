import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ScoreHeader from "../components/profile/ScoreHeader.vue";
import RedFlagsList from "../components/profile/RedFlagsList.vue";
import StatusBanner from "../components/common/StatusBanner.vue";
import TrustRadarChart from "../components/charts/TrustRadarChart.vue";
import TrustTierBadge from "../components/landing/TrustTierBadge.vue";
import EquipmentGrid from "../components/equipment/EquipmentGrid.vue";
import { FIXTURE_CHARACTERS } from "../api/mock/fixtures";
import { routeDefs } from "../routes";
import { presentGrade } from "../lib/characterViewModel";

describe("web router", () => {
  it("registers required foundation routes", () => {
    const names = routeDefs.map((route) => route.name);
    expect(names).toContain("home");
    expect(names).toContain("character");
    expect(names).toContain("compare");
    expect(names).toContain("admin-scoring");
  });
});

describe("ScoreHeader", () => {
  it("renders overall score and grade prominently", async () => {
    setActivePinia(createPinia());
    const router = createRouter({
      history: createMemoryHistory(),
      routes: routeDefs,
    });
    await router.push("/");
    await router.isReady();
    const profile = FIXTURE_CHARACTERS[0]!.profile;
    const wrapper = mount(ScoreHeader, {
      props: { profile },
      global: { plugins: [router] },
    });
    expect(wrapper.get("[data-testid='overall-score']").text()).toBe("88.0");
    expect(wrapper.get(".tier-grade-letter").classes()).toContain("tier-grade-letter--xl");
    expect(wrapper.get(".tier-grade-letter").classes()).toContain("tier-grade-letter--A");
    expect(wrapper.get(".tier-grade-letter").text()).toBe("A");
    expect(wrapper.get("[data-testid='confidence']").text()).toContain("78");
    expect(wrapper.find("[data-testid='freshness']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='trust-dimension-radar']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='grade']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='character-media']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='insight-accordion']").exists()).toBe(true);
  });
});

describe("TrustTierBadge", () => {
  it("renders U as unrated rather than a weak D-like tier", () => {
    const wrapper = mount(TrustTierBadge, { props: { tier: "U" } });
    expect(wrapper.attributes("data-unrated")).toBe("true");
    expect(wrapper.attributes("data-tier")).toBe("U");
    expect(wrapper.text()).toContain("Unrated");
    expect(presentGrade("U").isUnrated).toBe(true);
    expect(wrapper.get(".tier-grade-letter").classes()).toContain("tier-grade-letter--U");
    expect(wrapper.get(".tier-grade-letter").classes()).toContain("tier-grade-letter--md");
    expect(wrapper.get(".tier-grade-letter").classes()).not.toContain("tier-grade-letter--unrated");
  });
});

describe("EquipmentGrid", () => {
  it("shows unavailable slots without inventing item names", () => {
    const equipment = FIXTURE_CHARACTERS[1]!.profile.equipment!;
    const wrapper = mount(EquipmentGrid, { props: { equipment } });
    expect(wrapper.text()).toContain("Unavailable");
    expect(wrapper.text()).toContain("0 keyed items");
    expect(wrapper.findAll("a")).toHaveLength(0);
  });
});

describe("confidence warning banner", () => {
  it("exposes low-confidence messaging", () => {
    const wrapper = mount(StatusBanner, {
      props: { tone: "warn", title: "Low confidence" },
      attrs: { "data-testid": "confidence-warning" },
      slots: { default: "Data confidence is low." },
    });
    expect(wrapper.attributes("data-testid")).toBe("confidence-warning");
    expect(wrapper.text()).toContain("Data confidence is low");
  });
});

describe("RedFlagsList", () => {
  it("renders probabilistic red flags", () => {
    const flags = FIXTURE_CHARACTERS[2]!.profile.redFlags;
    const wrapper = mount(RedFlagsList, { props: { flags } });
    expect(wrapper.get("[data-testid='red-flags']").text()).toContain("Boost suspected");
    expect(wrapper.text()).toContain("not proven accusations");
  });
});

describe("TrustRadarChart", () => {
  it("renders accessible textual equivalent", () => {
    const dims = FIXTURE_CHARACTERS[0]!.profile.score!.dimensions;
    const wrapper = mount(TrustRadarChart, {
      props: {
        series: [{ id: "1", name: "Aleria", dimensions: dims }],
        modelVersion: 3,
      },
    });
    const table = wrapper.get("[data-testid='radar-fallback']");
    expect(table.text()).toContain("Performance");
    expect(table.text()).toContain("91");
    expect(table.text()).not.toContain("Mythic Raid");
    expect(wrapper.get("[data-testid='dimension-table']").text()).toContain(
      "Exact dimension values",
    );
    wrapper.unmount();
  });

  it("shows N/A for UNAVAILABLE dimensions and keeps genuine zero distinct", () => {
    const wrapper = mount(TrustRadarChart, {
      props: {
        series: [
          {
            id: "1",
            name: "Wallidrixe",
            dimensions: [
              {
                dimension: "PERFORMANCE",
                score: 80,
                confidence: 0.9,
                weight: 0.35,
                state: "AVAILABLE",
                reason: null,
                contributors: null,
              },
              {
                dimension: "SURVIVAL",
                score: 0,
                confidence: 0.8,
                weight: 0.25,
                state: "AVAILABLE",
                reason: null,
                contributors: null,
              },
              {
                dimension: "UTILITY",
                score: null,
                confidence: 0,
                weight: 0.25,
                state: "UNAVAILABLE",
                reason: "NO_OBSERVATIONS",
                contributors: null,
              },
              {
                dimension: "EXPERIENCE",
                score: 70,
                confidence: 0.7,
                weight: 0.15,
                state: "AVAILABLE",
                reason: null,
                contributors: null,
              },
            ],
          },
        ],
        modelVersion: 5,
      },
    });
    const table = wrapper.get("[data-testid='radar-fallback']");
    const cells = table.findAll("td").map((c) => c.text().trim());
    // Radar axis order is model-defined (Perf/Exp/Utility/Survival), not input order.
    expect(cells).toContain("N/A");
    expect(cells.some((t) => t.startsWith("0"))).toBe(true);
    expect(cells.filter((t) => t === "N/A")).toHaveLength(1);
    expect(table.text()).toContain("Utility");
    wrapper.unmount();
  });
});

describe("stale/queued banners", () => {
  it("supports queued and stale tones", () => {
    const queued = mount(StatusBanner, {
      props: { tone: "info", title: "Refresh queued" },
      attrs: { "data-testid": "queued-banner" },
    });
    const stale = mount(StatusBanner, {
      props: { tone: "warn", title: "Stale data" },
      attrs: { "data-testid": "stale-banner" },
    });
    expect(queued.text()).toContain("Refresh queued");
    expect(stale.text()).toContain("Stale data");
  });
});
