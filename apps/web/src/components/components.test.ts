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
    expect(names).toContain("admin-models");
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
    expect(wrapper.get("[data-testid='overall-score']").text()).toBe("88");
    expect(wrapper.get("[data-testid='grade']").text()).toContain("Grade A");
    expect(wrapper.get("[data-testid='confidence']").text()).toContain("78");
    expect(wrapper.get("[data-testid='freshness']").text()).toBe("FRESH");
    expect(wrapper.get("[data-testid='character-media']").attributes("data-media-type")).toBe(
      "placeholder",
    );
  });
});

describe("TrustTierBadge", () => {
  it("renders U as unrated rather than a weak D-like tier", () => {
    const wrapper = mount(TrustTierBadge, { props: { tier: "U" } });
    expect(wrapper.attributes("data-unrated")).toBe("true");
    expect(wrapper.attributes("data-tier")).toBe("U");
    expect(wrapper.text()).toContain("Unrated");
    expect(presentGrade("U").isUnrated).toBe(true);
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
    expect(wrapper.get("[data-testid='dimension-table']").text()).toContain("Exact dimension values");
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
