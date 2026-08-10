import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import HeroInsightAccordion from "./HeroInsightAccordion.vue";
import { EXPLAINABILITY_UNAVAILABLE_MESSAGE } from "../../lib/characterViewModel";
import type { CharacterProfileView } from "../../api/types";

function baseProfile(
  dimensions: NonNullable<CharacterProfileView["score"]>["dimensions"],
): CharacterProfileView {
  return {
    characterId: "c1",
    region: "EU",
    realmSlug: "tarren-mill",
    displayName: "Aleria",
    classSlug: "mage",
    specSlug: "arcane",
    refreshStatus: "FRESH",
    media: null,
    entitlements: { detailsUnlocked: true, runsUnlocked: true, compareExpanded: true },
    redFlags: [],
    warnings: [],
    performanceSummary: null,
    wclVisibility: "PUBLIC",
    wclDataState: "OK",
    score: {
      characterId: "c1",
      seasonSlug: "season-tww-3",
      modelKey: "default",
      modelVersion: 3,
      scopeType: "CHARACTER",
      scopeKey: null,
      overallScore: 80,
      grade: "B",
      skillScore: 80,
      authenticityScore: 70,
      confidence: 0.7,
      calculatedAt: "2026-07-20T12:00:00.000Z",
      inputFingerprint: "fp",
      dimensions,
      redFlags: [],
      explanation: {},
    },
  } as unknown as CharacterProfileView;
}

describe("HeroInsightAccordion", () => {
  it("shows explanation-unavailable instead of empty strengths/weaknesses for legacy scores", () => {
    const wrapper = mount(HeroInsightAccordion, {
      props: {
        profile: baseProfile([
          {
            dimension: "PERFORMANCE",
            score: 70,
            confidence: 0.8,
            weight: 0.35,
            state: "AVAILABLE",
            reason: null,
            contributors: {
              positive: [{ label: "Legacy strength" }],
              negative: [{ label: "Legacy weakness" }],
            },
          },
        ]),
      },
    });
    expect(wrapper.find("[data-testid='explainability-fallback']").text()).toBe(
      EXPLAINABILITY_UNAVAILABLE_MESSAGE,
    );
    expect(wrapper.text()).not.toContain("No standout strengths");
    expect(wrapper.text()).not.toContain("Legacy strength");
  });

  it("renders V1 strengths / weaknesses / facts", () => {
    const wrapper = mount(HeroInsightAccordion, {
      props: {
        profile: baseProfile([
          {
            dimension: "PERFORMANCE",
            score: 90,
            confidence: 0.85,
            weight: 0.35,
            state: "AVAILABLE",
            reason: null,
            contributors: null,
            explainability: {
              scoreDrivers: [
                {
                  code: "performance.phase1_performance",
                  labelKey: "x",
                  label: "Strong Phase 1 performance",
                  direction: "POSITIVE",
                  value: 92,
                },
                {
                  code: "performance.offensive_cooldown_discipline",
                  labelKey: "y",
                  label: "Cooldown below neutral",
                  direction: "NEGATIVE",
                  value: 40,
                },
              ],
              confidenceReasons: [],
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
                  labelKey: "z",
                  label: "Previous-season activity: none confirmed",
                  direction: "NEUTRAL",
                  value: 0,
                },
              ],
              confidenceReasons: [],
            },
          },
        ]),
      },
    });
    expect(wrapper.text()).toContain("Strong Phase 1 performance");
    expect(wrapper.text()).toContain("Cooldown below neutral");
    expect(wrapper.text()).toContain("Previous-season activity: none confirmed");
    expect(wrapper.find("[data-testid='explainability-fallback']").exists()).toBe(false);
  });
});
