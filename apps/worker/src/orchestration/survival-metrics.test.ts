import { describe, expect, it } from "vitest";
import type { SurvivalRawFacts } from "@mplus/contracts";
import { loadSeedAbilityCatalog } from "@mplus/mechanics";
import { SURVIVAL_V3_METRIC_KEYS } from "@mplus/scoring";
import { buildSurvivalObservations } from "./survival-metrics.js";

function facts(dungeonSlug: string, deaths: number): SurvivalRawFacts {
  return {
    provenance: {
      sourceProvider: "warcraftlogs",
      canonicalRunId: `run-${dungeonSlug}`,
      dungeonSlug,
      formulaVersion: "scoring-v3-raw-facts-v1",
      abilityCatalogVersion: "ability-catalog-v1-survival-agent23",
      mechanicCatalogVersion: "scoring-mechanic-catalog-v1-survival-agent23",
      observedAt: "2026-07-20T12:00:00.000Z",
    },
    deaths,
    totalDamageTaken: 300_000,
    avoidableDamageTaken: 40_000,
    avoidableDamageCoverageRatio: 0.5,
    maxHealth: 450_000,
    personalDefensiveCasts: 2,
    selfHealEffective: 50_000,
    selfHealOverheal: 5_000,
    healthPotionCasts: 1,
    fieldStatus: {
      deaths: { availability: "AVAILABLE", reason: null },
      totalDamageTaken: { availability: "AVAILABLE", reason: null },
      avoidableDamageTaken: { availability: "PARTIAL", reason: "coverage" },
      maxHealth: { availability: "AVAILABLE", reason: null },
      personalDefensiveCasts: { availability: "AVAILABLE", reason: null },
      selfHealEffective: { availability: "AVAILABLE", reason: null },
      healthPotionCasts: { availability: "AVAILABLE", reason: null },
    },
  };
}

describe("buildSurvivalObservations", () => {
  it("emits survival.v3 metric observations for Agent 27 wiring", () => {
    const result = buildSurvivalObservations({
      runs: [
        {
          dungeonSlug: "skyreach",
          canonicalRunId: "run-skyreach",
          keyLevel: 12,
          durationMs: 24 * 60_000,
          detailAvailable: true,
          survival: facts("skyreach", 0),
        },
        {
          dungeonSlug: "pit-of-saron",
          canonicalRunId: "run-pos",
          keyLevel: 11,
          durationMs: 28 * 60_000,
          detailAvailable: true,
          survival: facts("pit-of-saron", 2),
        },
      ],
      expectedDungeonCount: 8,
      selectedRunWclCoverage: 0.25,
      classSlug: "warlock",
      specSlug: "demonology",
      hasResolvedSpecAndRole: true,
      observedAt: "2026-07-20T12:00:00.000Z",
      abilityCatalog: loadSeedAbilityCatalog(),
    });

    expect(result.survivalScore).not.toBeNull();
    expect(result.observations.length).toBeGreaterThanOrEqual(3);
    const keys = new Set(result.observations.map((o) => o.metricKey));
    expect(keys.has(SURVIVAL_V3_METRIC_KEYS.deaths)).toBe(true);
    expect(keys.has(SURVIVAL_V3_METRIC_KEYS.personalDefensives)).toBe(true);
    expect(result.survivalMetricWeights.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 8);
    expect(result.summary.runs.every((r) => r.formulaVersion.startsWith("survival-v3"))).toBe(
      true,
    );
  });
});
