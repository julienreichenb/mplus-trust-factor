import { describe, expect, it } from "vitest";
import type { SurvivalRawFacts } from "@mplus/contracts";
import {
  combineRunSurvivalScore,
  computeAvoidableDamageRate,
  computeSurvivalDimension,
  creditDefensiveUses,
  explainSurvivalRun,
  resolveRunContributors,
  resolveSurvivalMetricWeights,
  scoreAvoidableDamage,
  scoreDeaths,
  scorePersonalDefensives,
  scoreSelfHealAndPotion,
} from "./aggregate.js";
import type { SurvivalRunInput } from "./types.js";
import {
  DEATH_SOFT_CAP,
  SURVIVAL_V3_FORMULA_VERSION,
  SURVIVAL_V3_METRIC_KEYS,
  SURVIVAL_V3_WEIGHTS,
} from "./types.js";

function provenance(dungeonSlug: string) {
  return {
    sourceProvider: "warcraftlogs" as const,
    canonicalRunId: `run-${dungeonSlug}`,
    dungeonSlug,
    formulaVersion: "scoring-v3-raw-facts-v1",
    abilityCatalogVersion: "ability-catalog-v1-survival-agent23",
    mechanicCatalogVersion: "scoring-mechanic-catalog-v1-survival-agent23",
    observedAt: "2026-07-20T12:00:00.000Z",
  };
}

function survivalFacts(overrides: Partial<SurvivalRawFacts> = {}): SurvivalRawFacts {
  return {
    provenance: provenance("skyreach"),
    deaths: 0,
    totalDamageTaken: 400_000,
    avoidableDamageTaken: 50_000,
    avoidableDamageCoverageRatio: 0.9,
    maxHealth: 500_000,
    personalDefensiveCasts: 3,
    selfHealEffective: 80_000,
    selfHealOverheal: 20_000,
    healthPotionCasts: 1,
    fieldStatus: {
      deaths: { availability: "AVAILABLE", reason: null },
      totalDamageTaken: { availability: "AVAILABLE", reason: null },
      avoidableDamageTaken: { availability: "AVAILABLE", reason: null },
      maxHealth: { availability: "AVAILABLE", reason: null },
      personalDefensiveCasts: { availability: "AVAILABLE", reason: null },
      selfHealEffective: { availability: "AVAILABLE", reason: null },
      healthPotionCasts: { availability: "AVAILABLE", reason: null },
    },
    ...overrides,
  };
}

function runInput(overrides: Partial<SurvivalRunInput> = {}): SurvivalRunInput {
  return {
    dungeonSlug: "skyreach",
    dungeonName: "Skyreach",
    canonicalRunId: "run-skyreach",
    keyLevel: 12,
    durationMs: 25 * 60_000,
    detailAvailable: true,
    survival: survivalFacts(),
    availableDefensiveUses: 5,
    hasPersonalDefensiveCapability: true,
    hasSelfHealOrPotionCapability: true,
    ...overrides,
  };
}

/** Wallidrixe-style eight-run Survival fixture (synthetic but dungeon-aligned). */
const WALLIDRIXE_RUNS: SurvivalRunInput[] = [
  "algethar-academy",
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
  "pit-of-saron",
  "seat-of-the-triumvirate",
  "skyreach",
  "windrunner-spire",
].map((slug, index) =>
  runInput({
    dungeonSlug: slug,
    dungeonName: slug,
    canonicalRunId: `wallidrixe-${slug}`,
    keyLevel: 10 + (index % 4),
    survival: survivalFacts({
      provenance: provenance(slug),
      deaths: index % 3,
      avoidableDamageTaken: 40_000 + index * 5_000,
      personalDefensiveCasts: 2 + (index % 2),
      selfHealEffective: 60_000 + index * 4_000,
      selfHealOverheal: 10_000,
      healthPotionCasts: index % 2,
    }),
    availableDefensiveUses: 4,
  }),
);

describe("SURVIVAL v3 scoring", () => {
  it("scores zero deaths high without making deaths alone perfect Survival", () => {
    expect(scoreDeaths(0)).toBe(100);
    expect(scoreDeaths(DEATH_SOFT_CAP)).toBe(0);
    const onlyDeaths = resolveRunContributors(
      runInput({
        survival: survivalFacts({
          avoidableDamageTaken: null,
          maxHealth: null,
          personalDefensiveCasts: null,
          selfHealEffective: null,
          healthPotionCasts: null,
          fieldStatus: {
            deaths: { availability: "AVAILABLE", reason: null },
            avoidableDamageTaken: { availability: "BLOCKED", reason: "missing" },
            maxHealth: { availability: "BLOCKED", reason: "missing" },
            personalDefensiveCasts: { availability: "BLOCKED", reason: "missing" },
            selfHealEffective: { availability: "BLOCKED", reason: "missing" },
            healthPotionCasts: { availability: "BLOCKED", reason: "missing" },
          },
        }),
        availableDefensiveUses: null,
      }),
    );
    const score = combineRunSurvivalScore(onlyDeaths);
    expect(score).toBe(100);
    // Dimension still exposes that other contributors were unavailable.
    expect(onlyDeaths.filter((c) => c.score == null).length).toBeGreaterThan(0);
  });

  it("never treats missing avoidable damage as zero — renormalizes instead", () => {
    const explained = explainSurvivalRun(
      runInput({
        survival: survivalFacts({
          maxHealth: null,
          fieldStatus: {
            deaths: { availability: "AVAILABLE", reason: null },
            avoidableDamageTaken: { availability: "PARTIAL", reason: "coverage" },
            maxHealth: {
              availability: "BLOCKED",
              reason: "max_health_not_in_combatant_snapshot",
            },
            personalDefensiveCasts: { availability: "AVAILABLE", reason: null },
            selfHealEffective: { availability: "AVAILABLE", reason: null },
            healthPotionCasts: { availability: "AVAILABLE", reason: null },
          },
        }),
      }),
    );
    const avoidable = explained.contributors.find((c) => c.key === "avoidableDamage");
    expect(avoidable?.score).toBeNull();
    expect(avoidable?.availability).toBe("BLOCKED");
    expect(explained.runSurvivalScore).not.toBeNull();
    const activeWeight = explained.contributors
      .filter((c) => c.score != null)
      .reduce((s, c) => s + c.effectiveWeight, 0);
    expect(activeWeight).toBeCloseTo(1, 5);
  });

  it("caps defensive spam so excess casts cannot exceed available uses", () => {
    expect(creditDefensiveUses(50, 4)).toBe(4);
    expect(scorePersonalDefensives(50, 4)).toBe(100);
    expect(scorePersonalDefensives(2, 4)).toBe(50);
  });

  it("credits effective self-heal and ignores overheal in the score signal", () => {
    const withOverheal = scoreSelfHealAndPotion({
      selfHealEffective: 100_000,
      selfHealOverheal: 500_000,
      healthPotionCasts: 0,
      maxHealth: 500_000,
      durationMs: 20 * 60_000,
    });
    const withoutOverhealNoise = scoreSelfHealAndPotion({
      selfHealEffective: 100_000,
      selfHealOverheal: 0,
      healthPotionCasts: 0,
      maxHealth: 500_000,
      durationMs: 20 * 60_000,
    });
    expect(withOverheal).toBe(withoutOverhealNoise);
    expect(withOverheal).not.toBeNull();
  });

  it("normalizes avoidable damage by max health and duration", () => {
    const rate = computeAvoidableDamageRate({
      avoidableDamageTaken: 250_000,
      maxHealth: 500_000,
      durationMs: 25 * 60_000,
    });
    // 0.5 HP over 25 min = 0.02 fractions/min
    expect(rate).toBeCloseTo(0.02, 5);
    expect(scoreAvoidableDamage(0)).toBe(100);
    expect(scoreAvoidableDamage(2)!).toBeLessThan(20);
  });

  it("equal-weights available of eight selected runs (Wallidrixe fixture)", () => {
    const result = computeSurvivalDimension({
      runs: WALLIDRIXE_RUNS,
      expectedDungeonCount: 8,
      selectedRunWclCoverage: 1,
      hasResolvedSpecAndRole: true,
      logFreshness: 0.85,
    });
    expect(result.summary.availableRunCount).toBe(8);
    expect(result.survivalScore).not.toBeNull();
    expect(result.summary.formulaVersion).toBe(SURVIVAL_V3_FORMULA_VERSION);
    expect(result.summary.runs).toHaveLength(8);
    for (const run of result.summary.runs) {
      expect(run.runSurvivalScore).not.toBeNull();
      expect(run.selfHealOverheal).not.toBeNull();
    }
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("omits unavailable runs instead of zero-filling", () => {
    const result = computeSurvivalDimension({
      runs: [
        runInput({ dungeonSlug: "skyreach", canonicalRunId: "a" }),
        runInput({
          dungeonSlug: "pit-of-saron",
          canonicalRunId: "b",
          detailAvailable: false,
          survival: survivalFacts({
            provenance: provenance("pit-of-saron"),
            deaths: null,
            avoidableDamageTaken: null,
            maxHealth: null,
            personalDefensiveCasts: null,
            selfHealEffective: null,
            healthPotionCasts: null,
            fieldStatus: {
              deaths: { availability: "BLOCKED", reason: "wcl_detail_unavailable" },
              avoidableDamageTaken: { availability: "BLOCKED", reason: "wcl_detail_unavailable" },
              maxHealth: { availability: "BLOCKED", reason: "wcl_detail_unavailable" },
              personalDefensiveCasts: {
                availability: "BLOCKED",
                reason: "wcl_detail_unavailable",
              },
              selfHealEffective: { availability: "BLOCKED", reason: "wcl_detail_unavailable" },
              healthPotionCasts: { availability: "BLOCKED", reason: "wcl_detail_unavailable" },
            },
          }),
          availableDefensiveUses: null,
        }),
      ],
      expectedDungeonCount: 8,
      selectedRunWclCoverage: 0.125,
      hasResolvedSpecAndRole: true,
    });
    expect(result.summary.availableRunCount).toBe(1);
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("resolves Agent 27 metric weights with renormalization", () => {
    const all = resolveSurvivalMetricWeights([
      "deaths",
      "avoidableDamage",
      "personalDefensives",
      "selfHealAndPotion",
    ]);
    expect(all).toEqual([
      { metricKey: SURVIVAL_V3_METRIC_KEYS.deaths, weight: SURVIVAL_V3_WEIGHTS.deaths },
      {
        metricKey: SURVIVAL_V3_METRIC_KEYS.avoidableDamage,
        weight: SURVIVAL_V3_WEIGHTS.avoidableDamage,
      },
      {
        metricKey: SURVIVAL_V3_METRIC_KEYS.personalDefensives,
        weight: SURVIVAL_V3_WEIGHTS.personalDefensives,
      },
      {
        metricKey: SURVIVAL_V3_METRIC_KEYS.selfHealAndPotion,
        weight: SURVIVAL_V3_WEIGHTS.selfHealAndPotion,
      },
    ]);

    const withoutAvoidable = resolveSurvivalMetricWeights(["deaths", "personalDefensives"]);
    const sum = withoutAvoidable.reduce((s, w) => s + w.weight, 0);
    expect(sum).toBeCloseTo(1, 8);
    expect(
      withoutAvoidable.find((w) => w.metricKey === SURVIVAL_V3_METRIC_KEYS.avoidableDamage),
    ).toBeUndefined();
  });

  it("drops personal defensives when the spec lacks capability", () => {
    const explained = explainSurvivalRun(
      runInput({
        hasPersonalDefensiveCapability: false,
        availableDefensiveUses: null,
      }),
    );
    const def = explained.contributors.find((c) => c.key === "personalDefensives");
    expect(def?.availability).toBe("MISSING");
    expect(def?.score).toBeNull();
    expect(explained.runSurvivalScore).not.toBeNull();
  });
});
