import { describe, expect, it } from "vitest";
import {
  loadSeedAbilityCatalog,
  resolveInterruptAbility,
  resolveUtilityCapability,
} from "@mplus/mechanics";
import {
  computeCrowdControlScore,
  computeInterruptScore,
  computeKickActivityScore,
  computeKickSuccessScore,
  computeUtilityConfidence,
  computeUtilityDimension,
  explainUtilityRun,
  resolveUtilityContributorWeights,
  resolveUtilityMetricWeights,
  KICK_ACTIVITY_WEIGHT,
  KICK_SUCCESS_WEIGHT,
  UTILITY_CROWD_CONTROL_WEIGHT,
  UTILITY_DISPELS_WEIGHT,
  UTILITY_GROUP_SUPPORT_WEIGHT,
  UTILITY_INTERRUPT_WEIGHT,
  UTILITY_V3_FORMULA_VERSION,
  UTILITY_V3_METRIC_KEYS,
} from "./aggregate.js";
import { utilityDimensionToMetricObservations } from "./observations.js";
import type { UtilityRunFactsInput } from "./types.js";

const abilityCatalog = loadSeedAbilityCatalog();

const warlockDemoCapability = resolveUtilityCapability({
  abilityCatalog,
  classSlug: "warlock",
  specSlug: "demonology",
});

function wallidrixeRun(
  overrides: Partial<UtilityRunFactsInput> & Pick<UtilityRunFactsInput, "dungeonSlug" | "canonicalRunId">,
): UtilityRunFactsInput {
  return {
    dungeonName: overrides.dungeonSlug,
    keyLevel: 12,
    durationMs: 1_800_000, // 30 min
    detailAvailable: true,
    kickCasts: 18,
    successfulInterrupts: 14,
    effectiveKickCooldownMs: 24_000,
    distinctCcTargets: 6,
    groupSupportCasts: 2,
    groupSupportConfirmedUsages: 0,
    groupSupportEvidenceMode: "cast_only",
    defensiveDispels: 3,
    offensiveDispels: 0,
    wclCoverageRatio: 0.85,
    ...overrides,
  };
}

/** Eight selected highest-key current-season runs (Wallidrixe-shaped). */
const WALLIDRIXE_RUNS: UtilityRunFactsInput[] = [
  wallidrixeRun({ dungeonSlug: "skyreach", canonicalRunId: "run-sky", keyLevel: 14, kickCasts: 22, successfulInterrupts: 18, distinctCcTargets: 7 }),
  wallidrixeRun({ dungeonSlug: "pit-of-saron", canonicalRunId: "run-pos", keyLevel: 13, kickCasts: 16, successfulInterrupts: 12 }),
  wallidrixeRun({ dungeonSlug: "nexus-point-xenas", canonicalRunId: "run-npx", keyLevel: 12, kickCasts: 15, successfulInterrupts: 11, groupSupportCasts: 3 }),
  wallidrixeRun({ dungeonSlug: "magisters-terrace", canonicalRunId: "run-mt", keyLevel: 12, kickCasts: 14, successfulInterrupts: 10, defensiveDispels: 4 }),
  wallidrixeRun({ dungeonSlug: "algethar-academy", canonicalRunId: "run-aa", keyLevel: 11, kickCasts: 12, successfulInterrupts: 9, distinctCcTargets: 4 }),
  wallidrixeRun({ dungeonSlug: "maisara-caverns", canonicalRunId: "run-mc", keyLevel: 11, kickCasts: 13, successfulInterrupts: 10 }),
  wallidrixeRun({ dungeonSlug: "seat-of-the-triumvirate", canonicalRunId: "run-sot", keyLevel: 10, kickCasts: 10, successfulInterrupts: 7, distinctCcTargets: 3 }),
  wallidrixeRun({ dungeonSlug: "windrunner-spire", canonicalRunId: "run-ws", keyLevel: 10, kickCasts: 11, successfulInterrupts: 8, groupSupportCasts: 1 }),
];

describe("Warlock Demonology capability + interrupt resolution", () => {
  it("resolves Spell Lock interrupt with Felhunter pet requirement", () => {
    const resolved = resolveInterruptAbility({
      abilityCatalog,
      classSlug: "warlock",
      specSlug: "demonology",
      activePet: "felhunter",
    });
    expect(resolved.spellIds.length).toBeGreaterThan(0);
    expect(resolved.effectiveCooldownMs).toBe(24_000);
    expect(resolved.petRequirement).toBe("felhunter");
    expect(resolved.resolution).toBe("pet_filtered");
  });

  it("marks Demo capable of kick/CC/gateway/defensive dispel but not offensive dispel", () => {
    expect(warlockDemoCapability.interrupts).toBe(true);
    expect(warlockDemoCapability.crowdControl).toBe(true);
    expect(warlockDemoCapability.groupSupport).toBe(true);
    expect(warlockDemoCapability.defensiveDispels).toBe(true);
    expect(warlockDemoCapability.offensiveDispels).toBe(false);
    expect(warlockDemoCapability.dispels).toBe(true);
    expect(warlockDemoCapability.catalogCoverage.crowdControlSpellIds).toEqual(
      expect.arrayContaining([30283, 6789, 710, 5782]),
    );
    expect(warlockDemoCapability.catalogCoverage.groupSupportSpellIds).toContain(111771);
  });

  it("drops unsupported contributors and renormalizes weights to 1", () => {
    const weights = resolveUtilityContributorWeights(warlockDemoCapability);
    expect(weights.map((w) => w.key)).toEqual([
      "interrupts",
      "crowd_control",
      "group_support",
      "dispels",
    ]);
    const sum = weights.reduce((s, w) => s + w.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(weights.find((w) => w.key === "interrupts")!.weight).toBeCloseTo(
      UTILITY_INTERRUPT_WEIGHT,
      10,
    );
  });

  it("removes interrupt weight entirely when catalog has no kick", () => {
    const emptyCap = resolveUtilityCapability({
      abilityCatalog: { catalogVersion: "empty", seasonSlug: null, rules: [] },
      classSlug: "mage",
      specSlug: "fire",
    });
    expect(resolveUtilityContributorWeights(emptyCap)).toEqual([]);
  });
});

describe("interrupt formula (70% activity / 30% success)", () => {
  it("estimates available kick windows from cooldown and duration", () => {
    // 30 min / 24s = 75 windows; 18 casts → activity = 18/75
    const activity = computeKickActivityScore(18, 75);
    expect(activity).toBeCloseTo((18 / 75) * 100, 5);
    const success = computeKickSuccessScore(14, 18);
    expect(success).toBeCloseTo((14 / 18) * 100, 5);
    const { score, evidence } = computeInterruptScore(18, 14, 24_000, 1_800_000);
    expect(score).toBeCloseTo(
      KICK_ACTIVITY_WEIGHT * activity! + KICK_SUCCESS_WEIGHT * success!,
      5,
    );
    expect(evidence.availableKickWindows).toBeCloseTo(75, 5);
  });

  it("counts unsuccessful kicks as activity but not success quality", () => {
    const perfect = computeInterruptScore(20, 20, 24_000, 1_800_000);
    const misses = computeInterruptScore(20, 10, 24_000, 1_800_000);
    expect(perfect.score!).toBeGreaterThan(misses.score!);
    expect(misses.evidence.kickCasts).toBe(20);
    expect(misses.evidence.successfulInterrupts).toBe(10);
  });
});

describe("CC / group support / dispels", () => {
  it("does not inflate CC when the same actor is reapplied (raw count is distinct)", () => {
    const once = computeCrowdControlScore(3, 1_800_000);
    const more = computeCrowdControlScore(6, 1_800_000);
    expect(more.score!).toBeGreaterThan(once.score!);
    expect(once.evidence.note).toContain("reapplications_do_not_inflate");
  });

  it("labels group support cast-only vs confirmed party usage", () => {
    const result = computeUtilityDimension({
      runs: [
        wallidrixeRun({
          dungeonSlug: "skyreach",
          canonicalRunId: "r1",
          groupSupportCasts: 2,
          groupSupportEvidenceMode: "cast_only",
          groupSupportConfirmedUsages: 0,
        }),
      ],
      expectedDungeonCount: 8,
      capability: warlockDemoCapability,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.8,
    });
    const support = result.summary.runs[0]!.contributors.find((c) => c.key === "group_support")!;
    expect(support.evidence.evidenceMode).toBe("cast_only");
    expect(String(support.evidence.note)).toMatch(/unconfirmed/i);
  });
});

describe("computeUtilityDimension — eight-run Wallidrixe set", () => {
  it("equal-weights available dungeons and exposes per-run evidence + catalog coverage", () => {
    const result = computeUtilityDimension({
      runs: WALLIDRIXE_RUNS,
      expectedDungeonCount: 8,
      capability: warlockDemoCapability,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.85,
      logFreshness: 0.9,
      observedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(result.utilityScore).not.toBeNull();
    expect(result.utilityScore!).toBeGreaterThan(20);
    expect(result.utilityScore!).toBeLessThan(100);
    expect(result.summary.formulaVersion).toBe(UTILITY_V3_FORMULA_VERSION);
    expect(result.summary.dungeonCount).toBe(8);
    expect(result.summary.droppedContributors).toEqual([]);
    expect(result.summary.runs).toHaveLength(8);

    for (const run of result.summary.runs) {
      expect(run.catalogCoverage?.interruptSpellIds.length).toBeGreaterThan(0);
      expect(run.runUtilityScore).not.toBeNull();
      const lines = explainUtilityRun(run);
      expect(lines[0]).toContain(run.dungeonSlug);
      expect(lines.some((l) => l.includes("catalog:"))).toBe(true);
    }
  });

  it("treats missing WCL detail as unavailable, never zero", () => {
    const runs = [
      ...WALLIDRIXE_RUNS.slice(0, 6),
      wallidrixeRun({
        dungeonSlug: "seat-of-the-triumvirate",
        canonicalRunId: "missing-1",
        detailAvailable: false,
        kickCasts: null,
        successfulInterrupts: null,
        distinctCcTargets: null,
        groupSupportCasts: null,
        defensiveDispels: null,
        offensiveDispels: null,
      }),
      wallidrixeRun({
        dungeonSlug: "windrunner-spire",
        canonicalRunId: "missing-2",
        detailAvailable: false,
        kickCasts: null,
        successfulInterrupts: null,
        distinctCcTargets: null,
        groupSupportCasts: null,
        defensiveDispels: null,
        offensiveDispels: null,
      }),
    ];
    const result = computeUtilityDimension({
      runs,
      expectedDungeonCount: 8,
      capability: warlockDemoCapability,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.6,
    });
    expect(result.summary.dungeonCount).toBe(6);
    const missing = result.summary.runs.filter((r) => !r.detailAvailable);
    expect(missing).toHaveLength(2);
    for (const run of missing) {
      expect(run.runUtilityScore).toBeNull();
      expect(run.contributors.every((c) => c.score === null)).toBe(true);
    }
    expect(result.confidence).toBeLessThan(
      computeUtilityConfidence({
        selectedRunCount: 8,
        expectedDungeonCount: 8,
        detailAvailableCount: 8,
        selectedRunWclCoverage: 0.85,
        hasResolvedSpecAndRole: true,
        logFreshness: 0.9,
        contributorCoverage: 1,
      }),
    );
  });

  it("emits Agent-27-ready metric keys with renormalized weights", () => {
    const metricWeights = resolveUtilityMetricWeights(warlockDemoCapability);
    expect(metricWeights.map((m) => m.metricKey)).toEqual([
      UTILITY_V3_METRIC_KEYS.interrupts,
      UTILITY_V3_METRIC_KEYS.crowdControl,
      UTILITY_V3_METRIC_KEYS.groupSupport,
      UTILITY_V3_METRIC_KEYS.dispels,
    ]);
    expect(metricWeights[0]!.weight).toBeCloseTo(UTILITY_INTERRUPT_WEIGHT, 10);
    expect(metricWeights[1]!.weight).toBeCloseTo(UTILITY_CROWD_CONTROL_WEIGHT, 10);
    expect(metricWeights[2]!.weight).toBeCloseTo(UTILITY_GROUP_SUPPORT_WEIGHT, 10);
    expect(metricWeights[3]!.weight).toBeCloseTo(UTILITY_DISPELS_WEIGHT, 10);

    const result = computeUtilityDimension({
      runs: WALLIDRIXE_RUNS,
      expectedDungeonCount: 8,
      capability: warlockDemoCapability,
      hasResolvedSpecAndRole: true,
      selectedRunWclCoverage: 0.85,
    });
    const observations = utilityDimensionToMetricObservations({
      result,
      observedAt: "2026-07-28T00:00:00.000Z",
      abilityCatalogVersion: abilityCatalog.catalogVersion,
    });
    expect(observations).toHaveLength(4);
    for (const obs of observations) {
      expect(obs.dimension).toBe("UTILITY");
      expect(obs.normalizedValue).not.toBeNull();
      expect(obs.confidence).toBeGreaterThan(0);
      const ctx = obs.context as { formulaVersion: string; runs: unknown[] };
      expect(ctx.formulaVersion).toBe(UTILITY_V3_FORMULA_VERSION);
      expect(ctx.runs).toHaveLength(8);
    }
  });
});
