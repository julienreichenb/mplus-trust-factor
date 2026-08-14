import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import type { ScoreSnapshotDTO } from "@mplus/contracts";
import ScoreHeader from "./ScoreHeader.vue";
import { FIXTURE_CHARACTERS } from "../../api/mock/fixtures";
import { routeDefs } from "../../routes";
import type { CharacterProfileView } from "../../api/types";

function context(overrides: Partial<NonNullable<ScoreSnapshotDTO["scoreContext"]>> = {}) {
  return {
    rawScoreBeforeContext: 71.4,
    keyContext: {
      status: "AVAILABLE" as const,
      canonicalRuns: [],
      medianKeyLevel: 22,
      appliedAnchorPercentileBps: 9900,
      appliedAnchorPercentileLabel: "P99",
      appliedAnchorKeyThreshold: 22,
      nextAnchorPercentileBps: null,
      nextAnchorPercentileLabel: null,
      nextAnchorKeyThreshold: null,
      factor: 1.08,
      distributionSnapshotId: "d",
      distributionSource: "FIXTURE",
      distributionVersion: "v1",
      distributionCollectedAt: "2026-01-01T00:00:00.000Z",
      reason: null,
    },
    metaContext: {
      status: "AVAILABLE" as const,
      classSlug: "mage",
      specSlug: "frost",
      specSource: "test",
      tier: 4 as const,
      factor: 1.04,
      reason: null,
    },
    combinedFactor: 1.12,
    preClampAdjustedScore: 79.9,
    wasClamped: false,
    finalScore: 79.9,
    rawGrade: "B" as const,
    finalGrade: "A" as const,
    contextRevisionId: "rev",
    contextRevisionVersion: 1,
    ...overrides,
  };
}

async function mountHeader(scoreContext: ScoreSnapshotDTO["scoreContext"] | undefined, overall = 80) {
  setActivePinia(createPinia());
  const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
  await router.push("/");
  await router.isReady();
  const base = FIXTURE_CHARACTERS[0]!.profile;
  const profile = {
    ...base,
    score: {
      ...base.score!,
      overallScore: overall,
      grade: "A",
      scoreContext,
    },
  } as CharacterProfileView;
  return mount(ScoreHeader, { props: { profile }, global: { plugins: [router] } });
}

describe("ScoreHeader score context chip and popover", () => {
  it("shows Bonus chip when combinedFactor > 1", async () => {
    const wrapper = await mountHeader(context({ combinedFactor: 1.12 }));
    expect(wrapper.get("[data-testid='score-context-chip']").text()).toBe("Bonus ×1.12");
  });

  it("shows Malus chip when combinedFactor < 1", async () => {
    const wrapper = await mountHeader(context({ combinedFactor: 0.94 }));
    expect(wrapper.get("[data-testid='score-context-chip']").text()).toBe("Malus ×0.94");
  });

  it("hides the chip when combinedFactor is exactly 1 but still opens the popover", async () => {
    const wrapper = await mountHeader(
      context({
        combinedFactor: 1,
        keyContext: { ...context().keyContext, factor: 1 },
        metaContext: { ...context().metaContext, factor: 1 },
      }),
    );
    expect(wrapper.find("[data-testid='score-context-chip']").exists()).toBe(false);
    expect(wrapper.get(".score-pop__trigger").attributes("aria-expanded")).toBe("false");
    await wrapper.get(".score-pop__trigger").trigger("click");
    expect(wrapper.get(".score-pop__trigger").attributes("aria-expanded")).toBe("true");
    expect(wrapper.find("[data-testid='score-context-breakdown']").exists()).toBe(true);
  });

  it("shows UNKNOWN reasons and clamp inside the popover", async () => {
    const wrapper = await mountHeader(
      context({
        combinedFactor: 1.5,
        wasClamped: true,
        preClampAdjustedScore: 103.2,
        finalScore: 100,
        keyContext: {
          ...context().keyContext,
          status: "UNKNOWN",
          factor: 1,
          reason: "MEDIAN_KEY_DISTRIBUTION_MISSING",
        },
        metaContext: {
          ...context().metaContext,
          status: "NOT_CONFIGURED",
          tier: null,
          factor: 1,
          reason: "SPEC_META_NOT_CONFIGURED",
        },
      }),
    );
    await wrapper.get(".score-pop__trigger").trigger("click");
    const popover = wrapper.get("[data-testid='score-context-popover']");
    expect(popover.text()).toContain("Season distribution unavailable");
    expect(popover.text()).toContain("No meta tier configured");
    expect(popover.text()).toContain("capped at 100");
    expect(popover.text()).not.toContain("Tier 3");
  });
});
