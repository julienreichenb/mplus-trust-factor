import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import KeySignalsPanel from "./KeySignalsPanel.vue";
import type { DimensionScoreDTO } from "@mplus/contracts";
import { EXPLAINABILITY_UNAVAILABLE_MESSAGE } from "../../lib/characterViewModel";

describe("KeySignalsPanel", () => {
  it("shows explanation-unavailable when no V1 explainability is present", () => {
    const dimensions: DimensionScoreDTO[] = [
      {
        dimension: "PERFORMANCE",
        score: 70,
        confidence: 0.8,
        weight: 0.35,
        state: "AVAILABLE",
        reason: null,
        contributors: {
          positive: [{ label: "Must not appear" }],
          negative: [{ label: "Must not appear either" }],
        },
      },
    ];
    const wrapper = mount(KeySignalsPanel, {
      props: { dimensions, flags: [] },
    });
    expect(wrapper.find("[data-testid='explainability-fallback']").text()).toBe(
      EXPLAINABILITY_UNAVAILABLE_MESSAGE,
    );
    expect(wrapper.text()).not.toContain("Must not appear");
    expect(wrapper.text()).not.toContain("No positive contributor");
  });

  it("renders V1 strengths and keeps red flags separate", () => {
    const dimensions: DimensionScoreDTO[] = [
      {
        dimension: "PERFORMANCE",
        score: 90,
        confidence: 0.8,
        weight: 0.35,
        state: "AVAILABLE",
        reason: null,
        contributors: null,
        explainability: {
          scoreDrivers: [
            {
              code: "performance.phase1_performance",
              labelKey: "score.performance.phase1_performance",
              label: "Strong Phase 1 performance",
              direction: "POSITIVE",
              value: 92,
            },
          ],
          confidenceReasons: [
            {
              code: "incomplete_cooldown_run_coverage",
              labelKey: "x",
              label: "Incomplete cooldown evidence coverage",
            },
          ],
        },
      },
    ];
    const wrapper = mount(KeySignalsPanel, {
      props: {
        dimensions,
        flags: [
          {
            key: "boost_suspected",
            label: "Boost suspected",
            severity: "HIGH",
            confidence: 0.7,
            public: true,
            evidence: { note: "probabilistic only" },
          },
        ],
      },
    });
    expect(wrapper.text()).toContain("Strong Phase 1 performance");
    expect(wrapper.text()).not.toContain("Incomplete cooldown evidence coverage");
    expect(wrapper.find("[data-testid='red-flags']").text()).toContain("Boost suspected");
  });
});
