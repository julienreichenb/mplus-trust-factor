import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DimensionCards from "./DimensionCards.vue";
import type { DimensionScoreDTO } from "@mplus/contracts";

const dims: DimensionScoreDTO[] = [
  {
    dimension: "PERFORMANCE",
    score: 91,
    confidence: 0.85,
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
        {
          code: "performance.offensive_cooldown_discipline",
          labelKey: "score.performance.offensive_cooldown_discipline",
          label: "Offensive cooldown below neutral",
          direction: "NEGATIVE",
          value: 42,
        },
      ],
      confidenceReasons: [
        {
          code: "incomplete_cooldown_run_coverage",
          labelKey: "confidence.performance.incomplete_cooldown_run_coverage",
          label: "Incomplete cooldown evidence coverage",
        },
      ],
    },
  },
  {
    dimension: "SURVIVAL",
    score: 84,
    confidence: 0.8,
    weight: 0.3,
    state: "AVAILABLE",
    reason: null,
    contributors: null,
    explainability: {
      scoreDrivers: [
        {
          code: "survival.defensive_response",
          labelKey: "score.survival.defensive_response",
          label: "Defensive response below neutral",
          direction: "NEGATIVE",
          value: 38,
        },
      ],
      confidenceReasons: [
        {
          code: "partial_health_evidence",
          labelKey: "confidence.survival.partial_health_evidence",
          label: "Some health evidence is incomplete",
        },
      ],
    },
  },
  {
    dimension: "UTILITY",
    score: 86,
    confidence: 0.75,
    weight: 0.25,
    state: "AVAILABLE",
    reason: null,
    contributors: null,
    explainability: {
      scoreDrivers: [
        {
          code: "utility.cast_stops",
          labelKey: "score.utility.cast_stops",
          label: "Observed cast stops contributed",
          direction: "POSITIVE",
          value: 22,
        },
        {
          code: "utility.strategic_cc",
          labelKey: "score.utility.strategic_cc",
          label: "No strategic CC observed",
          direction: "NEUTRAL",
          value: 0,
        },
      ],
      confidenceReasons: [
        {
          code: "tiny_run_sample",
          labelKey: "confidence.utility.tiny_run_sample",
          label: "Utility sample size is small",
        },
      ],
    },
  },
  {
    dimension: "EXPERIENCE",
    score: 0,
    confidence: 1,
    weight: 0.1,
    state: "AVAILABLE",
    reason: null,
    contributors: null,
    explainability: {
      scoreDrivers: [
        {
          code: "experience.confirmed_no_activity",
          labelKey: "score.experience.confirmed_no_activity",
          label: "Previous-season activity: none confirmed",
          direction: "NEUTRAL",
          value: 0,
        },
      ],
      confidenceReasons: [],
    },
  },
];

describe("DimensionCards explainability", () => {
  it("splits score drivers from confidence reasons and keeps E0 as a fact", () => {
    const wrapper = mount(DimensionCards, {
      props: { dimensions: dims, modelVersion: 3 },
    });

    expect(wrapper.find('[data-testid="dimension-cards"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("What affects your score");
    expect(wrapper.text()).toContain("Strong Phase 1 performance");
    expect(wrapper.text()).toContain("Offensive cooldown below neutral");
    expect(wrapper.text()).toContain("No strategic CC observed");
    expect(wrapper.text()).toContain("Previous-season activity: none confirmed");
    expect(wrapper.text()).not.toContain("Full confidence");
    expect(wrapper.text()).not.toContain("Why confidence is");
    expect(wrapper.text()).not.toContain("Incomplete cooldown evidence coverage");
    expect(wrapper.text()).not.toContain("Some health evidence is incomplete");

    const cards = wrapper.findAll("article.card");
    const experience = cards.find((c) => c.text().includes("Experience"));
    expect(experience?.text()).not.toMatch(/Facts \/ context/i);
    expect(experience?.text()).toMatch(/none confirmed/i);
    expect(experience?.text()).not.toMatch(/Weaknesses[\s\S]*none confirmed/i);
  });

  it("does not render confidence explanations inside unavailable dimension cards", () => {
    const wrapper = mount(DimensionCards, {
      props: {
        modelVersion: 3,
        dimensions: [
          {
            dimension: "PERFORMANCE",
            score: null,
            confidence: 0.4,
            weight: 0.35,
            state: "UNAVAILABLE",
            reason: null,
            contributors: null,
            explainability: {
              scoreDrivers: [],
              confidenceReasons: [
                {
                  code: "cooldown_evidence_unavailable",
                  labelKey: "confidence.performance.cooldown_evidence_unavailable",
                  label: "Offensive cooldown evidence unavailable",
                },
              ],
            },
          },
        ] as unknown as DimensionScoreDTO[],
      },
    });

    expect(wrapper.text()).toContain("Performance");
    expect(wrapper.text()).not.toContain("Offensive cooldown evidence unavailable");
  });

  it("shows legacy fallback when explainability is missing", () => {
    const wrapper = mount(DimensionCards, {
      props: {
        modelVersion: 3,
        dimensions: [
          {
            dimension: "PERFORMANCE",
            score: 70,
            confidence: 0.8,
            weight: 0.35,
            state: "AVAILABLE",
            reason: null,
            contributors: { positive: [], negative: [] },
          },
          {
            dimension: "SURVIVAL",
            score: 70,
            confidence: 0.8,
            weight: 0.3,
            state: "AVAILABLE",
            reason: null,
            contributors: null,
          },
          {
            dimension: "UTILITY",
            score: 70,
            confidence: 0.8,
            weight: 0.25,
            state: "AVAILABLE",
            reason: null,
            contributors: null,
          },
          {
            dimension: "EXPERIENCE",
            score: 70,
            confidence: 0.8,
            weight: 0.1,
            state: "AVAILABLE",
            reason: null,
            contributors: null,
          },
        ],
      },
    });
    expect(wrapper.findAll('[data-testid="explainability-fallback"]').length).toBeGreaterThan(0);
    expect(wrapper.text()).toMatch(/Detailed score explanation is not available/i);
  });
});
