/**
 * Utility V3.2 opportunity engine + scoring tests (offline, no WCL).
 */
import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import {
  classifySupportSemantic,
  extractRunOpportunities,
} from "./utility-opportunity-engine.js";
import {
  scoreCastStopsFromOpportunities,
  scoreSupportFromSemantics,
  computeReliability,
  computeV3_2Confidence,
} from "./utility-v3_2-scoring-logic.js";
import { buildInterruptFixture, runSyntheticFixtureSuite } from "./utility-v3_2-fixtures.js";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";

function baseRun(partial: Partial<UtilityNormalizedRun> = {}): UtilityNormalizedRun {
  return {
    reportCode: "TESTCODE",
    fightId: 1,
    dungeonSlug: "skyreach",
    keyLevel: 10,
    durationMs: 600_000,
    playerActorId: 10,
    petActorIds: [],
    specialization: "frost",
    classSlug: "mage",
    roleSlug: "dps",
    interruptEvents: [],
    ccEvents: [],
    dispelPurgeEvents: [],
    externalGroupUtilityEvents: [],
    classSpecificEvents: [],
    interruptOpportunities: [],
    dispelPurgeOpportunities: [],
    unmatchedAbilityIds: [],
    incompleteDatasets: [],
    datasetStates: {
      CombatantInfo: "OK",
      Casts: "OK",
      Buffs: "OK",
      Debuffs: "OK",
      Interrupts: "OK",
      Dispels: "OK",
      Deaths: "OK",
      DamageDone: "OK",
    },
    truncatedDatasets: [],
    ...partial,
  } as UtilityNormalizedRun;
}

describe("V3.2 opportunity extraction", () => {
  it("creates success-only implied opportunities when hostile casts absent", () => {
    const run = baseRun({
      interruptEvents: [
        {
          timestamp: 5000,
          sourceID: 10,
          targetID: 99,
          abilityGameID: 2139,
          interruptedSpellId: 1271094,
          sourceKind: "PLAYER",
          canonical: null,
          unmatchedSpellId: false,
          cooldownStateAtCast: "AVAILABLE",
          event: {} as never,
        },
      ],
    });
    const opps = extractRunOpportunities({
      normalized: run,
      castEvents: [
        {
          timestamp: 1000,
          type: "cast",
          source: { id: 10, type: "Mage" },
          ability: { guid: 2139 },
        },
      ],
    });
    const interrupts = opps.filter((o) => o.opportunityType === "interrupt");
    expect(interrupts.length).toBe(1);
    expect(interrupts[0]!.derivation).toBe("success_only_implied");
    expect(interrupts[0]!.outcome).toBe("SUCCESS_DIRECT_INTERRUPT");
    expect(interrupts.every((o) => o.outcome !== "CAST_COMPLETED_CONFIRMED_MISS")).toBe(true);
  });

  it("derives confirmed miss from hostile cast window with strong evidence", () => {
    const run = baseRun();
    const opps = extractRunOpportunities({
      normalized: run,
      castEvents: [
        {
          timestamp: 1000,
          type: "begincast",
          source: { id: 50, type: "NPC" },
          ability: { guid: 400010 },
          interruptible: true,
        },
        {
          timestamp: 2800,
          type: "cast",
          source: { id: 50, type: "NPC" },
          ability: { guid: 400010 },
          interruptible: true,
        },
      ],
      interruptEvents: [],
      catalog: getAbilityCatalog({ classSlug: "mage", specSlug: "frost", includeRacials: false }),
    });
    const miss = opps.find((o) => o.outcome === "CAST_COMPLETED_CONFIRMED_MISS");
    expect(miss).toBeDefined();
    expect(miss!.confidence).not.toBe("LOW");
  });

  it("does not count uncertain opportunities as misses", () => {
    const run = baseRun();
    const opps = extractRunOpportunities({
      normalized: run,
      castEvents: [
        {
          timestamp: 1000,
          type: "begincast",
          source: { id: 50, type: "NPC" },
          ability: { guid: 400011 },
        },
        {
          timestamp: 2800,
          type: "cast",
          source: { id: 50, type: "NPC" },
          ability: { guid: 400011 },
        },
      ],
      interruptEvents: [],
    });
    expect(opps.every((o) => o.outcome !== "CAST_COMPLETED_CONFIRMED_MISS")).toBe(true);
  });
});

describe("V3.2 support semantics", () => {
  it("classifies Shimmer as PERSONAL_MOBILITY", () => {
    const catalog = getAbilityCatalog({ classSlug: "mage", specSlug: "frost" });
    expect(
      classifySupportSemantic({
        abilityGameId: 212653,
        abilityName: "Shimmer",
        kind: "EXTERNAL",
        tier: "CONFIRMED_APPLICATION",
        targetActorId: -1,
        playerActorId: 1,
        correlationNotes: ["cast_observed"],
        catalog,
      }),
    ).toBe("PERSONAL_MOBILITY");
  });

  it("excludes personal mobility from elite support scores", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      domain: "support" as const,
      kind: "EXTERNAL" as const,
      tier: "CONFIRMED_APPLICATION" as const,
      timestamp: i,
      abilityGameID: 212653,
      abilityName: "Shimmer",
      targetActorId: -1,
      interruptedSpellId: null,
      removedSpellId: null,
      durationMs: null,
      correlationNotes: ["cast_observed", "value_not_inferable_from_cast_alone"],
      confidence: "MEDIUM" as const,
      observability: "PARTIAL" as const,
    }));
    const scored = scoreSupportFromSemantics(items, 1, 1);
    expect(scored.bySemantic.PERSONAL_MOBILITY).toBe(0);
    expect(scored.rawScore).toBeLessThanOrEqual(65);
  });
});

describe("V3.2 castStops opportunity scoring", () => {
  it("scores below 50 with confirmed misses", () => {
    const opps = buildInterruptFixture({ id: "miss", count: 20, missRate: 1 });
    const scored = scoreCastStopsFromOpportunities(opps, {
      tierCounts: { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
      durationHours: 1,
    });
    expect(scored.mode).toBe("opportunity_primary");
    expect(scored.rawScore).toBeLessThan(50);
  });

  it("does not use volume alone for 95+", () => {
    const scored = scoreCastStopsFromOpportunities([], {
      tierCounts: { CONFIRMED_IMPACT: 50, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
      durationHours: 0.5,
    });
    expect(scored.mode).toBe("volume_fallback");
    expect(scored.rawScore).toBeLessThan(95);
    expect(scored.rawScore).toBeLessThanOrEqual(76);
  });
});

describe("V3.2 behavior vs confidence separation", () => {
  it("reliability shrinks toward 50 without inventing below-50", () => {
    const r = computeReliability({
      dungeonCount: 2,
      runCount: 2,
      missObservable: false,
      opportunityCount: 2,
    });
    expect(r).toBeLessThan(0.6);
    const adjusted = 50 + r * (70 - 50);
    expect(adjusted).toBeGreaterThanOrEqual(50);
  });

  it("confidence is higher for complete coverage than tiny sample", () => {
    const tiny = computeV3_2Confidence({
      dungeonCount: 2,
      runCount: 2,
      expectedDungeons: 8,
      eventCompleteness: 0.9,
      opportunityObservability: 0.3,
      actorResolved: true,
      mechanicCatalogCoverage: 0.2,
      abilityCatalogCoverage: 0.9,
      datasetIntegrity: 0.9,
      artifactState: "PARTIAL",
    });
    const complete = computeV3_2Confidence({
      dungeonCount: 8,
      runCount: 8,
      expectedDungeons: 8,
      eventCompleteness: 0.9,
      opportunityObservability: 0.3,
      actorResolved: true,
      mechanicCatalogCoverage: 0.2,
      abilityCatalogCoverage: 0.9,
      datasetIntegrity: 0.9,
      artifactState: "COMPLETE",
    });
    expect(complete.confidence).toBeGreaterThan(tiny.confidence);
    expect(tiny.confidence).toBeLessThanOrEqual(60);
  });
});

describe("V3.2 synthetic fixtures", () => {
  it("demonstrates monotonic miss discrimination and support rules", () => {
    const fixtures = runSyntheticFixtureSuite();
    const allOk = fixtures.find((f) => f.id === "all_successfully_handled")!;
    const half = fixtures.find((f) => f.id === "half_missed")!;
    const allMiss = fixtures.find((f) => f.id === "all_missed")!;
    expect(allOk.castStopsRaw).toBeGreaterThan(half.castStopsRaw);
    expect(half.castStopsRaw).toBeGreaterThan(allMiss.castStopsRaw);
    expect(allMiss.castStopsRaw).toBeLessThan(50);

    const passive = fixtures.find((f) => f.id === "passive_support_spam")!;
    const reactive = fixtures.find((f) => f.id === "reactive_high_impact_support")!;
    expect(passive.supportRaw!).toBeLessThanOrEqual(65);
    expect(reactive.supportRaw!).toBeGreaterThan(passive.supportRaw!);

    const lowVol = fixtures.find((f) => f.id === "low_volume_perfect_dangerous")!;
    const highVol = fixtures.find((f) => f.id === "high_volume_poor_priority")!;
    expect(lowVol.castStopsRaw).toBeGreaterThan(highVol.castStopsRaw);
  });
});
