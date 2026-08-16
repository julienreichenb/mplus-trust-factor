import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import MethodologyPanel from "./MethodologyPanel.vue";
import type { CharacterProfileView } from "../../api/types";

describe("MethodologyPanel", () => {
  it("renders backend weights and healer mix without a hardcoded formula", () => {
    const wrapper = mount(MethodologyPanel, {
      props: {
        profile: {
          characterId: "c1",
          region: "EU",
          realmSlug: "ravencrest",
          displayName: "Own",
          refreshStatus: "FRESH",
          redFlags: [],
          score: { overallScore: 78, dimensions: [] },
          scoreCalculation: {
            overallFormula: "WEIGHTED_DIMENSIONS",
            role: "HEALER",
            components: [
              { key: "performance", label: "Performance", score: 78, effectiveWeight: 0.4, contribution: 31.2 },
            ],
            performanceMix: { damageParse: 0.4, healingParse: 0.6, cooldown: 0 },
          },
          performanceSummary: {
            currentSeason: {
              peakScore: 0,
              consistencyScore: 0,
              score: 0,
              confidence: 1,
              dungeonCount: 0,
              expectedDungeonCount: 8,
              latestObservedAt: null,
              dungeons: [],
            },
            historical: null,
            roleAware: {
              role: "HEALER",
              performanceScore: 78,
              weightsApplied: { damageParse: 0.4, healingParse: 0.6, cooldown: 0 },
              damage: {
                score: 71,
                confidence: 1,
                bestAverage: 70,
                medianAverage: 65,
                availableCells: 8,
                expectedCells: 8,
                dungeons: [],
              },
              healing: {
                score: 82,
                confidence: 1,
                bestAverage: 80,
                medianAverage: 75,
                availableCells: 8,
                expectedCells: 8,
                dungeons: [],
              },
            },
          },
        } as unknown as CharacterProfileView,
      },
    });
    expect(wrapper.text()).toContain("Healing performance");
    expect(wrapper.text()).toContain("82");
    expect(wrapper.text()).toContain("Damage performance");
    expect(wrapper.text()).toContain("71");
    expect(wrapper.text()).not.toContain("WEIGHTED_DIMENSIONS");
  });
});
