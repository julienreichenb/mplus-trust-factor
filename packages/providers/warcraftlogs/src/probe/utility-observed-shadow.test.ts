/**
 * Shadow-mode + one-sided OBSERVED_CONTRIBUTION acceptance tests.
 */
import { describe, expect, it } from "vitest";
import {
  assertUtilityPublicationNotEnabled,
  parseUtilityPublicationMode,
  isUtilityResearchAllowedInPublication,
} from "./utility-publication-mode.js";
import {
  filterOutObservedContributionFromPublicUtility,
  runUtilityObservedShadowPass,
} from "./utility-observed-shadow.js";
import { scoreObservedContribution } from "./utility-v3_2-observed-contribution.js";
import { UTILITY_OBSERVED_SCORE_SEMANTICS } from "./utility-observed-semantics.js";
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

function opp(
  partial: Partial<UtilityOpportunity> & Pick<UtilityOpportunity, "id" | "outcome">,
): UtilityOpportunity {
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

describe("UTILITY_PUBLICATION_MODE", () => {
  it("defaults to shadow", () => {
    expect(parseUtilityPublicationMode(undefined)).toBe("shadow");
    expect(parseUtilityPublicationMode("")).toBe("shadow");
  });

  it("published mode is no longer a hard throw (eligibility gates apply downstream)", () => {
    expect(() => assertUtilityPublicationNotEnabled("published")).not.toThrow();
  });

  it("never allows research mode in publication", () => {
    expect(isUtilityResearchAllowedInPublication()).toBe(false);
  });
});

describe("shadow-mode acceptance", () => {
  it("shadow calculation does not alter public Trust flags", () => {
    const result = runUtilityObservedShadowPass({
      mode: "shadow",
      hasPersistedSharedEvidence: true,
      runs: [baseRun()],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [opp({ id: "1", outcome: "SUCCESS_DIRECT_INTERRUPT" })],
      detailedWclEventCallsMade: 0,
    });
    expect(result.status).toBe("SHADOW_SCORED");
    expect(result.altersPublicUtility).toBe(false);
    expect(result.altersPublicTrustScore).toBe(false);
    expect(result.replacesLastKnownGoodUtility).toBe(false);
    expect(result.adminDiagnosticsOnly).toBe(true);
    expect(result.detailedWclEventCallsMade).toBe(0);
  });

  it("zero attributable evidence stays neutral with low confidence", () => {
    const scored = scoreObservedContribution({
      runs: [baseRun(), baseRun({ fightId: 2, reportCode: "T2" })],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [
        opp({ id: "no", outcome: "NOT_OBSERVABLE" }),
        opp({ id: "other", outcome: "SUCCESS_OTHER_PLAYER", opportunityType: "dispel" }),
        opp({ id: "miss", outcome: "CAST_COMPLETED_CONFIRMED_MISS" }),
      ],
      mechanicCatalogCoverageObserved: 0.9,
    });
    expect(scored.context.attributableEvents).toBe(0);
    expect(scored.rawBehaviorEstimate).toBe(50);
    expect(scored.reliabilityAdjustedScore).toBe(50);
    expect(scored.confidence).toBeLessThanOrEqual(35);
    expect(scored.scoreKind).toBe(UTILITY_OBSERVED_SCORE_SEMANTICS.scoreKind);
  });

  it("gives no SUCCESS_OTHER_PLAYER credit and no miss penalties", () => {
    const scored = scoreObservedContribution({
      runs: [baseRun()],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [
        opp({ id: "1", outcome: "SUCCESS_DIRECT_INTERRUPT" }),
        opp({ id: "2", outcome: "CAST_COMPLETED_CONFIRMED_MISS" }),
        opp({ id: "3", outcome: "SUCCESS_OTHER_PLAYER", opportunityType: "dispel" }),
      ],
    });
    expect(scored.context.playerInterruptSuccesses).toBe(1);
    expect(scored.context.playerDispelPurgeSuccesses).toBe(0);
    expect(scored.rawBehaviorEstimate).toBeGreaterThanOrEqual(50);
    expect(scored.researchModeExcluded).toContain("SUCCESS_OTHER_PLAYER");
    expect(scored.researchModeExcluded).toContain("CAST_COMPLETED_CONFIRMED_MISS");
  });

  it("keeps toolkit-inapplicable domains neutral without treating as missing evidence", () => {
    const scored = scoreObservedContribution({
      runs: [
        baseRun({
          classSlug: "warrior",
          specialization: "arms",
        }),
      ],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [],
    });
    const support = scored.domainBreakdown.find((d) => d.domain === "support")!;
    // Warrior arms typically has no dispel/purge toolkit → support N/A or zero-neutral
    if (!support.applicable) {
      expect(support.rawScore).toBeNull();
      expect(support.cappedContribution).toBe(0);
    } else {
      expect(support.rawScore).toBeGreaterThanOrEqual(50);
    }
    expect(scored.rawBehaviorEstimate).toBeGreaterThanOrEqual(50);
  });

  it("compatible second shadow pass reports zero detailed WCL event calls", () => {
    const first = runUtilityObservedShadowPass({
      mode: "shadow",
      hasPersistedSharedEvidence: true,
      runs: [baseRun()],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [],
      detailedWclEventCallsMade: 0,
    });
    const second = runUtilityObservedShadowPass({
      mode: "shadow",
      hasPersistedSharedEvidence: true,
      runs: [baseRun()],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [],
      detailedWclEventCallsMade: 0,
    });
    expect(first.detailedWclEventCallsMade).toBe(0);
    expect(second.detailedWclEventCallsMade).toBe(0);
  });

  it("skips when shared evidence is missing (provider failure path preserves published Utility)", () => {
    const result = runUtilityObservedShadowPass({
      mode: "shadow",
      hasPersistedSharedEvidence: false,
      runs: [baseRun()],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [],
    });
    expect(result.status).toBe("SKIPPED_NO_PERSISTED_EVIDENCE");
    expect(result.score).toBeNull();
    expect(result.altersPublicUtility).toBe(false);
  });

  it("published mode scores OBSERVED_CONTRIBUTION without mutating public flags here", () => {
    const result = runUtilityObservedShadowPass({
      mode: "published",
      hasPersistedSharedEvidence: true,
      runs: [baseRun()],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [opp({ id: "1", outcome: "SUCCESS_DIRECT_INTERRUPT" })],
    });
    expect(result.status).toBe("SHADOW_SCORED");
    expect(result.score).not.toBeNull();
    expect(result.altersPublicUtility).toBe(false);
    expect(result.altersPublicTrustScore).toBe(false);
    expect(result.adminDiagnosticsOnly).toBe(false);
  });

  it("keeps score and domain contributions bounded", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      opp({ id: `i${i}`, outcome: "SUCCESS_DIRECT_INTERRUPT" }),
    );
    const scored = scoreObservedContribution({
      runs: [baseRun({ durationMs: 300_000 })],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: many,
    });
    expect(scored.rawBehaviorEstimate).toBeGreaterThanOrEqual(50);
    expect(scored.rawBehaviorEstimate).toBeLessThanOrEqual(50 + 8 * 3);
    for (const d of scored.domainBreakdown) {
      expect(d.cappedContribution).toBeGreaterThanOrEqual(0);
      expect(d.cappedContribution).toBeLessThanOrEqual(8);
    }
  });

  it("filters OBSERVED_CONTRIBUTION / research out of public Utility observations", () => {
    const filtered = filterOutObservedContributionFromPublicUtility([
      { metricKey: "utility.interrupts", context: { from: "combat-facts" } },
      {
        metricKey: "utility.observed_contribution",
        context: { utilityScoringMode: "OBSERVED_CONTRIBUTION" },
      },
      {
        metricKey: "utility.research",
        context: { scoringMode: "OPPORTUNITY_RESEARCH" },
      },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.metricKey).toBe("utility.interrupts");
  });

  it("absence never lowers aggregate below neutral", () => {
    const scored = scoreObservedContribution({
      runs: [baseRun({ classSlug: "mage", specialization: "frost" })],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [],
    });
    expect(scored.rawBehaviorEstimate).toBeGreaterThanOrEqual(50);
    for (const d of scored.domainBreakdown) {
      if (d.applicable && d.rawScore != null) {
        expect(d.rawScore).toBeGreaterThanOrEqual(50);
      }
    }
  });
});
