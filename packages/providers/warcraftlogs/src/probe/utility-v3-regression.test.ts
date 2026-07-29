import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import type { UtilityV2DomainEvidenceSummary } from "./utility-v2-types.js";
import { loadUtilityV2AuditInputs } from "./utility-v2-audit.js";
import { UTILITY_V3_SIMULATION_CONFIG } from "./utility-v3-config.js";
import type { UtilityV3DomainKey } from "./utility-v3-config.js";
import {
  buildUtilityV3SimulationDataset,
  canonicalGlobalBehaviorScore,
  redistributeBehaviorWeights,
  scoreUtilityV3Run,
} from "./utility-v3-scoring-logic.js";

const DOMAIN_KEYS = Object.keys(
  UTILITY_V3_SIMULATION_CONFIG.domainWeights,
) as UtilityV3DomainKey[];

function baseNormalizedRun(overrides: Partial<UtilityNormalizedRun> = {}): UtilityNormalizedRun {
  const datasets = {
    Interrupts: "OK",
    Casts: "OK",
    Buffs: "OK",
    Debuffs: "OK",
    Dispels: "OK",
    DamageDone: "OK",
    Deaths: "OK",
    CombatantInfo: "OK",
  } as UtilityNormalizedRun["datasetStates"];

  return {
    reportCode: "abc123",
    fightId: 1,
    dungeonSlug: "pit-of-saron",
    keyLevel: 12,
    durationMs: 3_600_000,
    playerActorId: 1,
    petActorIds: [2],
    specialization: "demonology",
    classSlug: "warlock",
    roleSlug: null,
    interruptEvents: [],
    ccEvents: [],
    dispelPurgeEvents: [],
    externalGroupUtilityEvents: [],
    classSpecificEvents: [],
    interruptOpportunities: [],
    dispelPurgeOpportunities: [],
    unmatchedAbilityIds: [],
    incompleteDatasets: [],
    datasetStates: datasets,
    truncatedDatasets: [],
    ...overrides,
  };
}

function emptyDomainSummary(domain: UtilityV3DomainKey): UtilityV2DomainEvidenceSummary {
  return {
    domain,
    applicable: true,
    applicabilityReason: null,
    tierCounts: { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
    items: [],
    normalizedRatesPerHour: { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
    observability: "LIMITED",
    confidence: "LOW",
    missedOpportunityCount: 0,
  };
}

describe("utility-v3 regression", () => {
  it("canonicalGlobalBehaviorScore equals equal-weight dungeon medians", () => {
    const perDungeon = [
      { runCount: 3, medianBehaviorScore: 70 },
      { runCount: 2, medianBehaviorScore: 80 },
      { runCount: 0, medianBehaviorScore: null },
    ];
    expect(canonicalGlobalBehaviorScore(perDungeon)).toBe(75);
  });

  it("zero evidence without confirmed opportunity scores exactly 50", () => {
    const normalized = baseNormalizedRun();
    const domains = Object.fromEntries(
      DOMAIN_KEYS.map((d) => [d, emptyDomainSummary(d)]),
    ) as Record<UtilityV3DomainKey, UtilityV2DomainEvidenceSummary>;

    const scored = scoreUtilityV3Run({
      normalized,
      domains,
      durationHours: 1,
      missedInterruptOpportunities: 0,
    });

    expect(scored.behaviorScore).toBe(50);
  });

  it("NOT_APPLICABLE and NOT_OBSERVABLE domains are excluded from behavior weights", () => {
    const weights = redistributeBehaviorWeights(UTILITY_V3_SIMULATION_CONFIG.domainWeights, {
      castStops: "SCORED",
      casterControl: "NOT_APPLICABLE",
      strategicCc: "NOT_OBSERVABLE",
      mechanicAvoidance: "NO_CONFIRMED_CONTRIBUTION",
      groupMobility: "SCORED",
      support: "SCORED",
    });
    expect(weights.casterControl).toBe(0);
    expect(weights.strategicCc).toBe(0);
    expect(weights.castStops).toBeGreaterThan(0.25);
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("scores below 50 require confirmed missed interrupt penalty scenario", () => {
    const normalized = baseNormalizedRun();
    const domains = Object.fromEntries(
      DOMAIN_KEYS.map((d) => [d, emptyDomainSummary(d)]),
    ) as Record<UtilityV3DomainKey, UtilityV2DomainEvidenceSummary>;

    const baseline = scoreUtilityV3Run({
      normalized,
      domains,
      durationHours: 1,
      missedInterruptOpportunities: 0,
    });
    const penalized = scoreUtilityV3Run({
      normalized,
      domains,
      durationHours: 1,
      missedInterruptOpportunities: 10,
      options: { id: "penalty", label: "penalty", applyMissedOpportunityPenalty: true },
    });

    expect(baseline.behaviorScore).toBe(50);
    expect(penalized.behaviorScore).toBeLessThan(50);
  });

  it("wallidrixe fixture: global score equals dungeon medians and sensitivity baseline", async () => {
    const inputDir = join(
      process.cwd(),
      "raw-artifacts/wcl-probe-utility/eu-archimonde-wallidrixe",
    );
    const { runs, rawByRunId, masterByReport, subject } = await loadUtilityV2AuditInputs(inputDir);
    const dataset = buildUtilityV3SimulationDataset({
      runs,
      rawByRunId,
      masterByReport: masterByReport as Parameters<
        typeof buildUtilityV3SimulationDataset
      >[0]["masterByReport"],
      subject,
      scoredAt: new Date().toISOString(),
    });

    const dungeonMean = canonicalGlobalBehaviorScore(
      dataset.perDungeon.filter((d) => d.runCount > 0),
    );

    expect(dataset.global.behaviorScore).toBe(dungeonMean);
    expect(dataset.sensitivityAnalysis[0]?.behaviorScore).toBe(dataset.global.behaviorScore);
    expect(dataset.global.behaviorScore).not.toBeNull();
  });
});
