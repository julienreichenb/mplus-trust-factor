import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ScoreExplainabilityV2PublicDTO } from "@mplus/contracts";
import ExplainabilityV2Panel from "./ExplainabilityV2Panel.vue";

const sample: ScoreExplainabilityV2PublicDTO = {
  schemaVersion: "2.0.0",
  modelKey: "default",
  modelVersion: 6,
  dataAsOf: "2026-08-01T00:00:00.000Z",
  evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
  manifestContentHash: "hash",
  coverage: {
    analyzedRunCount: 10,
    expectedRunCount: 16,
    representedDungeonCount: 6,
    expectedDungeonCount: 8,
    coverageState: "PARTIAL",
    publicationState: "PROVISIONAL",
    provisional: true,
    stale: false,
    unavailable: false,
  },
  selectedRuns: [
    {
      slotId: "s1",
      dungeonSlug: "ara-kara",
      slotIndex: 0,
      keyLevel: 12,
      timed: true,
      state: "SELECTED",
      hasWclSource: true,
    },
  ],
  dimensions: [
    {
      dimension: "UTILITY",
      score: 60,
      confidence: 0.7,
      availabilityState: "PARTIAL",
      gradeU: false,
      algorithmVersion: "utility-v2",
      topContributors: [{ key: "utility.support", dimension: "UTILITY", label: "support", score: 60, direction: "positive" }],
      limitations: [],
      utilitySemantics: {
        mode: "OBSERVED_CONTRIBUTION",
        notes: ["Observed combat contribution only."],
      },
    },
    {
      dimension: "PERFORMANCE",
      score: null,
      confidence: 0,
      availabilityState: "UNAVAILABLE",
      gradeU: true,
      algorithmVersion: "performance-v2",
      topContributors: [],
      limitations: ["insufficient"],
    },
  ],
  notes: ["Grade U means unavailable or unranked, not a low score."],
  gradeUMeans: "unavailable_or_unranked",
};

describe("ExplainabilityV2Panel", () => {
  it("renders English coverage copy without report codes", () => {
    const wrapper = mount(ExplainabilityV2Panel, {
      props: { explainability: sample },
    });
    expect(wrapper.text()).toContain("Evidence & confidence");
    expect(wrapper.text()).toContain("unavailable or unranked");
    expect(wrapper.text()).toContain("observed combat contribution");
    expect(wrapper.text()).toContain("ara-kara");
    expect(wrapper.text()).toContain("+12");
    expect(wrapper.text()).toMatch(/\bU\b/);
    expect(wrapper.html()).not.toMatch(/reportCode/i);
    expect(wrapper.html()).not.toMatch(/AbCdEfGhIjKlMnOp/);
  });

  it("hides when explainability is null", () => {
    const wrapper = mount(ExplainabilityV2Panel, {
      props: { explainability: null },
    });
    expect(wrapper.find("[data-testid='explainability-v2']").exists()).toBe(false);
  });
});
