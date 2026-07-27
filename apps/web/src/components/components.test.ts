import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ScoreHeader from "../components/profile/ScoreHeader.vue";
import RedFlagsList from "../components/profile/RedFlagsList.vue";
import StatusBanner from "../components/common/StatusBanner.vue";
import TrustRadarChart from "../components/charts/TrustRadarChart.vue";
import { FIXTURE_CHARACTERS } from "../api/mock/fixtures";
import { routeDefs } from "../routes";

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
  it("renders overall score and grade prominently", () => {
    setActivePinia(createPinia());
    const profile = FIXTURE_CHARACTERS[0]!.profile;
    const wrapper = mount(ScoreHeader, { props: { profile } });
    expect(wrapper.get("[data-testid='overall-score']").text()).toBe("88");
    expect(wrapper.get("[data-testid='grade']").text()).toContain("Grade A");
    expect(wrapper.get("[data-testid='confidence']").text()).toContain("78");
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
      },
      global: {
        stubs: {
          // Keep DOM table; avoid canvas init side effects where possible
        },
      },
    });
    const table = wrapper.get("[data-testid='radar-fallback']");
    expect(table.text()).toContain("Performance");
    expect(table.text()).toContain("91");
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
