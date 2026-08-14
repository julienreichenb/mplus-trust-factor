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

async function expandRawBar(wrapper: Awaited<ReturnType<typeof mountHeader>>) {
  await wrapper.get("[data-testid='raw-score-toggle']").trigger("click");
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
  it("shows Key and Meta chips when context factors are applied", async () => {
    const wrapper = await mountHeader(context({ combinedFactor: 1.12 }));
    expect(wrapper.get("[data-testid='raw-score-toggle']").text()).toBe(
      "Show score before key level and meta adjustments",
    );
    expect(wrapper.get(".trust__help").text()).toBe("?");
    expect(wrapper.find("[data-testid='raw-score-bar']").exists()).toBe(false);
    await expandRawBar(wrapper);
    expect(wrapper.get("[data-testid='raw-score-toggle']").text()).toBe(
      "Hide score before key level and meta adjustments",
    );
    expect(wrapper.get("[data-testid='key-context-chip']").text()).toBe("Key ×1.08");
    expect(wrapper.get("[data-testid='meta-context-chip']").text()).toBe("Meta ×1.04");
    expect(wrapper.get("[data-testid='key-context-chip']").attributes("data-kind")).toBe("bonus");
    expect(wrapper.get("[data-testid='meta-context-chip']").attributes("data-kind")).toBe("bonus");
  });

  it("shows raw score next to the adjusted score when they differ", async () => {
    const wrapper = await mountHeader(context());
    await expandRawBar(wrapper);
    expect(wrapper.get("[data-testid='overall-score']").text()).toBe("80.0");
    expect(wrapper.get("[data-testid='raw-score']").text()).toBe("71.4");
    expect(wrapper.get("[data-testid='raw-score-bar']").text()).toContain("/ 100");
    expect(wrapper.get("[data-testid='raw-grade']").text()).toBe("B");
    expect(wrapper.text()).toContain("Final Trust Score");
  });

  it("shows decimal raw, factor chips, and final without hiding raw behind hover", async () => {
    const wrapper = await mountHeader(
      context({
        rawScoreBeforeContext: 79.3,
        combinedFactor: 1.1,
        preClampAdjustedScore: 87.23,
        finalScore: 87.2,
        keyContext: { ...context().keyContext, factor: 1 },
        metaContext: { ...context().metaContext, factor: 1.1 },
      }),
      87.2,
    );
    await expandRawBar(wrapper);
    expect(wrapper.get("[data-testid='overall-score']").text()).toBe("87.2");
    expect(wrapper.get("[data-testid='raw-score']").text()).toBe("79.3");
    expect(wrapper.get("[data-testid='key-context-chip']").text()).toBe("Key ×1.00");
    expect(wrapper.get("[data-testid='meta-context-chip']").text()).toBe("Meta ×1.10");
    expect(wrapper.get(".trust__score-caption").text()).toBe("Final Trust Score");
  });

  it("hides raw score when it matches the published snapshot", async () => {
    const wrapper = await mountHeader(
      context({
        rawScoreBeforeContext: 80,
        rawGrade: "A",
        combinedFactor: 1,
        finalScore: 80,
        finalGrade: "A",
      }),
      80,
    );
    expect(wrapper.find("[data-testid='raw-score-toggle']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='raw-score']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='raw-score-bar']").exists()).toBe(false);
  });

  it("shows Malus chip when a context factor is below 1", async () => {
    const wrapper = await mountHeader(
      context({
        combinedFactor: 0.94,
        keyContext: { ...context().keyContext, factor: 0.94 },
        metaContext: { ...context().metaContext, factor: 1 },
      }),
    );
    await expandRawBar(wrapper);
    expect(wrapper.get("[data-testid='key-context-chip']").text()).toBe("Key ×0.94");
    expect(wrapper.get("[data-testid='key-context-chip']").attributes("data-kind")).toBe("malus");
    expect(wrapper.get("[data-testid='meta-context-chip']").attributes("data-kind")).toBe("neutral");
  });

  it("still opens the popover when combinedFactor is exactly 1", async () => {
    const wrapper = await mountHeader(
      context({
        combinedFactor: 1,
        keyContext: { ...context().keyContext, factor: 1 },
        metaContext: { ...context().metaContext, factor: 1 },
      }),
    );
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
