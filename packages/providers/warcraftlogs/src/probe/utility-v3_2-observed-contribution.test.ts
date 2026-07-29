/**
 * OBSERVED_CONTRIBUTION production-candidate tests (offline).
 */
import { describe, expect, it } from "vitest";
import {
  scoreObservedContribution,
  summarizeDispelVolumeStats,
} from "./utility-v3_2-observed-contribution.js";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import type { UtilityOpportunity } from "./utility-opportunity-types.js";

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
  };
}

function opp(partial: Partial<UtilityOpportunity> & Pick<UtilityOpportunity, "id" | "outcome">): UtilityOpportunity {
  return {
    runId: "TESTCODE:1",
    dungeonSlug: "skyreach",
    sourceActorId: 50,
    targetActorId: null,
    hostileSpellId: 400001,
    abilityGameId: 2139,
    opportunityType: "interrupt",
    openedAt: 1000,
    closedAt: 2500,
    confidence: "HIGH",
    severity: 0.7,
    eligibleActions: [2139],
    exclusionReasons: [],
    evidenceReferences: ["test"],
    derivation: "hostile_cast_window",
    ...partial,
  };
}

describe("OBSERVED_CONTRIBUTION", () => {
  it("never counts confirmed misses or other-player successes", () => {
    const runs = [baseRun()];
    const opportunities = [
      opp({ id: "1", outcome: "SUCCESS_DIRECT_INTERRUPT" }),
      opp({ id: "2", outcome: "CAST_COMPLETED_CONFIRMED_MISS" }),
      opp({
        id: "3",
        outcome: "SUCCESS_OTHER_PLAYER",
        opportunityType: "dispel",
      }),
      opp({
        id: "4",
        outcome: "SUCCESS_REACTIVE_SUPPORT",
        opportunityType: "dispel",
      }),
    ];
    const scored = scoreObservedContribution({
      runs,
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities,
      mechanicCatalogCoverageObserved: 0.2,
    });
    expect(scored.mode).toBe("OBSERVED_CONTRIBUTION");
    expect(scored.context.playerInterruptSuccesses).toBe(1);
    expect(scored.context.playerDispelPurgeSuccesses).toBe(1);
    expect(scored.researchModeExcluded).toContain("CAST_COMPLETED_CONFIRMED_MISS");
    expect(scored.researchModeExcluded).toContain("SUCCESS_OTHER_PLAYER");
  });

  it("keeps confidence low with zero attributable events at neutral 50", () => {
    const scored = scoreObservedContribution({
      runs: [baseRun(), baseRun({ fightId: 2, reportCode: "T2" })],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [
        opp({ id: "no", outcome: "NOT_OBSERVABLE" }),
        opp({ id: "other", outcome: "SUCCESS_OTHER_PLAYER", opportunityType: "dispel" }),
      ],
      mechanicCatalogCoverageObserved: 0.9,
    });
    expect(scored.context.attributableEvents).toBe(0);
    expect(scored.rawBehaviorEstimate).toBe(50);
    expect(scored.confidence).toBeLessThanOrEqual(35);
  });

  it("caps domain contributions after weight share", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      opp({ id: `i${i}`, outcome: "SUCCESS_DIRECT_INTERRUPT" }),
    );
    const scored = scoreObservedContribution({
      runs: [baseRun({ durationMs: 300_000 })],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: many,
      mechanicCatalogCoverageObserved: 0.3,
    });
    const cast = scored.domainBreakdown.find((d) => d.domain === "castStops")!;
    expect(cast.cappedContribution).toBeLessThanOrEqual(8);
    expect(scored.rawBehaviorEstimate).toBeGreaterThanOrEqual(50);
  });

  it("does not credit SUCCESS_OTHER_PLAYER or miss outcomes in observed scoring", () => {
    const scored = scoreObservedContribution({
      runs: [baseRun({ classSlug: "warrior", specialization: "arms" })],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [
        opp({ id: "1", outcome: "SUCCESS_OTHER_PLAYER", opportunityType: "dispel" }),
        opp({ id: "2", outcome: "CAST_COMPLETED_CONFIRMED_MISS" }),
      ],
    });
    expect(scored.context.playerDispelPurgeSuccesses).toBe(0);
    expect(scored.context.playerInterruptSuccesses).toBe(0);
    expect(scored.rawBehaviorEstimate).toBeGreaterThanOrEqual(50);
  });

  it("summarizes dispel per-run volume stats", () => {
    const stats = summarizeDispelVolumeStats([10, 20, 30, 40, 100]);
    expect(stats.median).toBe(30);
    expect(stats.max).toBe(100);
    expect(stats.total).toBe(200);
  });
});
