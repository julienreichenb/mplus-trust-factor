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
      dungeonSlug: "ara-kara",
      slotIndex: 0,
      keyLevel: 12,
      timed: true,
      state: "SELECTED",
      hasWclSource: true,
    },
  ],
  cooldownUsages: [],
  dimensions: [
    {
      dimension: "UTILITY",
      score: 60,
      confidence: 0.7,
      availabilityState: "PARTIAL",
      gradeU: false,
      algorithmVersion: "utility-v2",
      topContributors: [
        {
          key: "utility.support",
          dimension: "UTILITY",
          label: "support",
          score: 60,
          direction: "positive",
        },
      ],
      limitations: ["partial_coverage", "provisional_sample"],
      utilitySemantics: {
        mode: "OBSERVED_CONTRIBUTION",
        notes: [
          "Observed combat contribution only. Missing actions are not scored as zero.",
        ],
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
      limitations: ["dimension_unavailable"],
    },
  ],
  notes: ["Grade U means unavailable or unranked, not a low score."],
  gradeUMeans: "unavailable_or_unranked",
};

describe("ExplainabilityV2Panel", () => {
  it("renders English coverage copy without report codes or admin fields", () => {
    const wrapper = mount(ExplainabilityV2Panel, {
      props: { explainability: sample },
    });
    expect(wrapper.text()).toContain("Evidence & confidence");
    expect(wrapper.text()).toContain("unavailable or unranked");
    expect(wrapper.text()).toContain("observed combat contribution");
    expect(wrapper.text()).toContain("Missing actions are not scored as zero");
    expect(wrapper.text()).toContain("ara-kara");
    expect(wrapper.text()).toContain("+12");
    expect(wrapper.text()).toMatch(/\bU\b/);
    expect(wrapper.text()).toContain("partial coverage");
    expect(wrapper.text()).toContain("unavailable (not scored)");
    expect(wrapper.text()).not.toMatch(/\b0\s*\/\s*100\b/);
    expect(wrapper.html()).not.toMatch(/reportCode|manifestContentHash|inputFingerprint|slotId|fightId/i);
    expect(wrapper.html()).not.toMatch(/AbCdEfGhIjKlMnOp/);
    expect(wrapper.html()).not.toMatch(/<pre>/i);
  });

  it("renders nothing when explainability is null", () => {
    const wrapper = mount(ExplainabilityV2Panel, {
      props: { explainability: null },
    });
    expect(wrapper.find("[data-testid='explainability-v2']").exists()).toBe(false);
    expect(wrapper.text()).toBe("");
  });

  it("keeps PARTIAL and UNAVAILABLE wording distinct and never shows grade U as 0", () => {
    const wrapper = mount(ExplainabilityV2Panel, {
      props: { explainability: sample },
    });
    const unavailable = wrapper.find('[data-availability="UNAVAILABLE"]');
    const partial = wrapper.find('[data-availability="PARTIAL"]');
    expect(unavailable.exists()).toBe(true);
    expect(partial.exists()).toBe(true);
    expect(unavailable.text()).toContain("U");
    expect(unavailable.text()).toContain("unavailable (not scored)");
    expect(partial.text()).toContain("partial coverage");
    expect(unavailable.text()).not.toContain("0 / 100");
  });
});
