/**
 * Utility V3.1 offline calibration unit tests.
 * No live WCL calls. V3 artifacts untouched.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateNeutralBaseline,
  classifySupportEvidence,
  computeDomainReliability,
  computeV3_1Confidence,
  scoreCastStopsV3_1,
  scoreSupportV3_1,
  shrinkTowardNeutral,
  supportItemEffectiveWeight,
} from "./utility-v3_1-scoring-logic.js";
import type { UtilityV2EvidenceItem } from "./utility-v2-types.js";
import type { UtilityV3DomainEligibility } from "./utility-v3-config.js";
import type { UtilityV3_1DomainKey } from "./utility-v3_1-config.js";

function supportItem(
  partial: Partial<UtilityV2EvidenceItem> &
    Pick<UtilityV2EvidenceItem, "kind" | "tier">,
): UtilityV2EvidenceItem {
  return {
    id: "t",
    domain: "support",
    timestamp: 1,
    abilityGameID: 1,
    abilityName: "Test",
    targetActorId: 2,
    interruptedSpellId: null,
    removedSpellId: null,
    durationMs: null,
    correlationNotes: [],
    confidence: "MEDIUM",
    observability: "FULL",
    ...partial,
  };
}

describe("V3.1 shrinkage", () => {
  it("shrinks toward 50 and never invents below-50 from low reliability alone", () => {
    expect(shrinkTowardNeutral(99, 0.2)).toBeCloseTo(50 + 0.2 * 49, 5);
    expect(shrinkTowardNeutral(99, 0.2)).toBeGreaterThanOrEqual(50);
    expect(shrinkTowardNeutral(40, 0.5)).toBe(45);
  });
});

describe("V3.1 neutral-baseline aggregation", () => {
  it("does not amplify castStops when N/A domains exist", () => {
    const weights = {
      castStops: 0.25,
      casterControl: 0.15,
      strategicCc: 0.2,
      mechanicAvoidance: 0.1,
      groupMobility: 0.1,
      support: 0.2,
    };
    const eligibility = {
      castStops: "SCORED",
      casterControl: "NOT_APPLICABLE",
      strategicCc: "NO_CONFIRMED_CONTRIBUTION",
      mechanicAvoidance: "NO_CONFIRMED_CONTRIBUTION",
      groupMobility: "NOT_APPLICABLE",
      support: "SCORED",
    } as Record<UtilityV3_1DomainKey, UtilityV3DomainEligibility>;
    const scores = {
      castStops: 100,
      casterControl: null,
      strategicCc: 50,
      mechanicAvoidance: 50,
      groupMobility: null,
      support: 90,
    } as Record<UtilityV3_1DomainKey, number | null>;
    const reliability = {
      castStops: 1,
      casterControl: 1,
      strategicCc: 1,
      mechanicAvoidance: 1,
      groupMobility: 1,
      support: 1,
    } as Record<UtilityV3_1DomainKey, number>;

    const agg = aggregateNeutralBaseline(scores, reliability, weights, eligibility);
    // 50 + 0.25*50 + 0.2*40 = 50 + 12.5 + 8 = 70.5
    expect(agg.behaviorScore).toBeCloseTo(70.5, 5);
    expect(agg.contributions.casterControl.contribution).toBe(0);
    expect(agg.contributions.groupMobility.contribution).toBe(0);
    // Full redistribution would give castStops weight 0.25/0.65 ≈ 0.385 → higher score
    expect(agg.behaviorScore).toBeLessThan(85);
  });
});

describe("V3.1 castStops", () => {
  it("does not saturate near 100 from volume alone without opportunities", () => {
    const result = scoreCastStopsV3_1({
      tierCounts: { CONFIRMED_IMPACT: 40, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
      durationHours: 0.5,
      opportunityCount: 0,
      confirmedStopsMatchingOpportunity: 0,
      confirmedMisses: 0,
      dungeonCount: 2,
      uniqueInterruptedSpells: 9,
      uniqueTargets: 9,
    });
    expect(result.mode).toBe("volume_cautious");
    expect(result.rawScore).toBeLessThan(95);
    expect(result.rawScore).toBeLessThanOrEqual(78);
    expect(result.rawScore).toBeGreaterThan(50);
  });

  it("can score below 50 with confirmed misses under opportunity curve", () => {
    const result = scoreCastStopsV3_1({
      tierCounts: { CONFIRMED_IMPACT: 1, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
      durationHours: 1,
      opportunityCount: 20,
      confirmedStopsMatchingOpportunity: 1,
      confirmedMisses: 19,
      dungeonCount: 8,
      uniqueInterruptedSpells: 1,
      uniqueTargets: 1,
    });
    expect(result.mode).toBe("opportunity_response");
    expect(result.rawScore).toBeLessThan(50);
  });

  it("gates 95+ without multi-dungeon opportunity coverage", () => {
    const result = scoreCastStopsV3_1({
      tierCounts: { CONFIRMED_IMPACT: 20, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
      durationHours: 1,
      opportunityCount: 20,
      confirmedStopsMatchingOpportunity: 20,
      confirmedMisses: 0,
      dungeonCount: 2,
      uniqueInterruptedSpells: 10,
      uniqueTargets: 10,
    });
    expect(result.rawScore).toBeLessThanOrEqual(92);
  });
});

describe("V3.1 support credit classes", () => {
  it("classifies dispel IMPACT as reactive", () => {
    expect(
      classifySupportEvidence(
        supportItem({
          kind: "DISPEL",
          tier: "CONFIRMED_IMPACT",
          removedSpellId: 123,
        }),
        1,
      ),
    ).toBe("reactive");
  });

  it("downweights unverified EXTERNAL casts (e.g. Shimmer/Time Warp pattern)", () => {
    const item = supportItem({
      kind: "EXTERNAL",
      tier: "CONFIRMED_APPLICATION",
      targetActorId: -1,
      abilityName: "Shimmer",
      correlationNotes: ["cast_observed", "value_not_inferable_from_cast_alone"],
    });
    expect(classifySupportEvidence(item, 99)).toBe("unverified");
    expect(supportItemEffectiveWeight(item, 99).weight).toBeLessThan(0.05);
  });

  it("excludes self-targeted EXTERNAL", () => {
    const item = supportItem({
      kind: "EXTERNAL",
      tier: "CONFIRMED_APPLICATION",
      targetActorId: 42,
      correlationNotes: ["cast_observed"],
    });
    expect(classifySupportEvidence(item, 42)).toBe("personalExcluded");
    expect(supportItemEffectiveWeight(item, 42).weight).toBe(0);
  });

  it("does not let routine/unverified spam alone produce elite support", () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      supportItem({
        id: `u${i}`,
        kind: "EXTERNAL",
        tier: "CONFIRMED_APPLICATION",
        targetActorId: -1,
        abilityName: "Routine Buff",
        correlationNotes: ["cast_observed", "value_not_inferable_from_cast_alone"],
      }),
    );
    const scored = scoreSupportV3_1({
      items,
      durationHours: 1,
      playerActorId: 1,
    });
    expect(scored.rawScore).toBeLessThanOrEqual(68);
  });

  it("credits reactive dispels above neutral", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      supportItem({
        id: `d${i}`,
        kind: "DISPEL",
        tier: "CONFIRMED_IMPACT",
        removedSpellId: 100 + i,
        abilityName: "Purify Spirit",
      }),
    );
    const scored = scoreSupportV3_1({
      items,
      durationHours: 1,
      playerActorId: 1,
    });
    expect(scored.rawScore).toBeGreaterThan(50);
    expect(scored.strategicShare).toBeGreaterThan(0.9);
  });
});

describe("V3.1 reliability and confidence", () => {
  it("assigns low reliability to tiny samples", () => {
    const rel = computeDomainReliability({
      dungeonCount: 2,
      runCount: 2,
      uniqueAbilityOrSpellCount: 5,
      uniqueTargetCount: 4,
      opportunityCount: 0,
      datasetComplete: true,
      domain: "castStops",
    });
    expect(rel.reliability).toBeLessThan(0.55);
  });

  it("caps confidence for partial tiny samples below complete profiles", () => {
    const tiny = computeV3_1Confidence({
      dungeonCount: 2,
      runCount: 2,
      expectedDungeons: 8,
      scoredDomainCount: 2,
      applicableDomainCount: 4,
      opportunityCount: 0,
      evidenceItemCount: 30,
      actorResolved: true,
      datasetsOkRatio: 1,
      artifactState: "PARTIAL",
    });
    const complete = computeV3_1Confidence({
      dungeonCount: 8,
      runCount: 8,
      expectedDungeons: 8,
      scoredDomainCount: 4,
      applicableDomainCount: 4,
      opportunityCount: 0,
      evidenceItemCount: 200,
      actorResolved: true,
      datasetsOkRatio: 1,
      artifactState: "COMPLETE",
    });
    expect(tiny.capped).toBeLessThanOrEqual(62);
    expect(complete.capped).toBeGreaterThan(tiny.capped);
  });
});
