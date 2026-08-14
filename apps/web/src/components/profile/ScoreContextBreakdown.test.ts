import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ScoreSnapshotDTO } from "@mplus/contracts";
import ScoreContextBreakdown from "./ScoreContextBreakdown.vue";

const eight = [
  "ara-kara",
  "city-of-threads",
  "the-dawnbreaker",
  "the-stonevault",
  "mists-of-tirna-scithe",
  "the-necrotic-wake",
  "siege-of-boralus",
  "grim-batol",
];

function score(overrides: Partial<NonNullable<ScoreSnapshotDTO["scoreContext"]>> = {}): ScoreSnapshotDTO {
  const key = {
    status: "AVAILABLE" as const,
    canonicalRuns: eight.map((dungeonSlug, i) => ({
      dungeonSlug,
      canonicalRunId: `run-${i}`,
      keyLevel: 18 + (i % 3),
    })),
    medianKeyLevel: 19.5,
    appliedAnchorPercentileBps: 9900,
    appliedAnchorPercentileLabel: "P99",
    appliedAnchorKeyThreshold: 22,
    nextAnchorPercentileBps: null,
    nextAnchorPercentileLabel: null,
    nextAnchorKeyThreshold: null,
    factor: 1.1,
    distributionSnapshotId: "dist-1",
    distributionSource: "FIXTURE_LOCAL",
    distributionVersion: "v1",
    distributionCollectedAt: "2026-01-01T00:00:00.000Z",
    reason: null,
  };
  const meta = {
    status: "AVAILABLE" as const,
    classSlug: "mage",
    specSlug: "frost",
    specSource: "test",
    tier: 4 as const,
    factor: 1.05,
    reason: null,
  };
  return {
    characterId: "c1",
    seasonSlug: "s",
    modelKey: "default",
    modelVersion: 6,
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore: 86.625,
    grade: "A",
    skillScore: 86.625,
    authenticityScore: 100,
    confidence: 0.8,
    calculatedAt: "2026-01-01T00:00:00.000Z",
    inputFingerprint: "fp",
    dimensions: [],
    redFlags: [],
    explanation: { composite: 75 },
    scoreContext: {
      rawScoreBeforeContext: 75,
      keyContext: key,
      metaContext: meta,
      combinedFactor: 1.155,
      preClampAdjustedScore: 86.625,
      wasClamped: false,
      finalScore: 86.625,
      rawGrade: "B",
      finalGrade: "A",
      contextRevisionId: "rev-1",
      contextRevisionVersion: 2,
      ...overrides,
    },
  };
}

describe("ScoreContextBreakdown", () => {
  it("A: shows matching raw and final when factors are 1", () => {
    const wrapper = mount(ScoreContextBreakdown, {
      props: {
        score: score({
          rawScoreBeforeContext: 73.421,
          combinedFactor: 1,
          preClampAdjustedScore: 73.421,
          finalScore: 73.421,
          rawGrade: "B",
          finalGrade: "B",
          keyContext: {
            ...score().scoreContext!.keyContext,
            factor: 1,
          },
          metaContext: { ...score().scoreContext!.metaContext, factor: 1 },
        }),
      },
    });
    expect(wrapper.find("[data-testid='context-raw']").text()).toContain("73.421");
    expect(wrapper.find("[data-testid='context-final']").text()).toContain("73.421");
  });

  it("B/D/F: positive context, 8 canonical runs, meta tier", () => {
    const wrapper = mount(ScoreContextBreakdown, { props: { score: score() } });
    expect(wrapper.find("[data-testid='context-final']").text()).toContain("86.625");
    expect(wrapper.find("[data-testid='canonical-runs']").findAll("li")).toHaveLength(8);
    expect(wrapper.find("[data-testid='key-context-detail']").text()).toContain("P99");
    expect(wrapper.find("[data-testid='meta-available']").text()).toContain("Tier 4");
    expect(wrapper.text()).not.toContain("EvidenceManifest");
  });

  it("C: clamp is visible", () => {
    const wrapper = mount(ScoreContextBreakdown, {
      props: {
        score: score({
          rawScoreBeforeContext: 90,
          combinedFactor: 1.5,
          preClampAdjustedScore: 135,
          wasClamped: true,
          finalScore: 100,
          finalGrade: "S",
        }),
      },
    });
    expect(wrapper.find("[data-testid='context-clamp']").text()).toContain("capped at 100");
  });

  it("E/G: unknown key and unconfigured meta stay ×1 with reasons", () => {
    const wrapper = mount(ScoreContextBreakdown, {
      props: {
        score: score({
          keyContext: {
            ...score().scoreContext!.keyContext,
            status: "UNKNOWN",
            factor: 1,
            reason: "MEDIAN_KEY_DISTRIBUTION_MISSING",
            appliedAnchorPercentileLabel: null,
            appliedAnchorPercentileBps: null,
          },
          metaContext: {
            ...score().scoreContext!.metaContext,
            status: "NOT_CONFIGURED",
            tier: null,
            factor: 1,
            reason: "SPEC_META_NOT_CONFIGURED",
          },
        }),
      },
    });
    expect(wrapper.find("[data-testid='key-unknown']").text()).toContain("Season distribution unavailable");
    expect(wrapper.find("[data-testid='meta-unconfigured']").text()).toContain("No meta tier configured");
    expect(wrapper.text()).not.toContain("Tier 3");
    expect(wrapper.text()).not.toContain("exactly percentile");
  });

  it("H: renders nothing without scoreContext", () => {
    const wrapper = mount(ScoreContextBreakdown, {
      props: {
        score: { ...score(), scoreContext: undefined },
      },
    });
    expect(wrapper.find("[data-testid='score-context-breakdown']").exists()).toBe(false);
  });
});
