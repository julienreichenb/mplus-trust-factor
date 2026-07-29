/**
 * Deterministic synthetic / counterfactual fixtures for Utility V3.2.
 * Built from controlled opportunity sets — not live WCL.
 */
import type { UtilityOpportunity } from "./utility-opportunity-types.js";
import { scoreCastStopsFromOpportunities, scoreSupportFromSemantics } from "./utility-v3_2-scoring-logic.js";
import type { UtilityV2EvidenceItem } from "./utility-v2-types.js";

function opp(
  partial: Partial<UtilityOpportunity> &
    Pick<UtilityOpportunity, "id" | "outcome" | "confidence" | "severity">,
): UtilityOpportunity {
  return {
    runId: "fixture:1",
    dungeonSlug: partial.dungeonSlug ?? "skyreach",
    sourceActorId: 100,
    targetActorId: 100,
    hostileSpellId: partial.hostileSpellId ?? 400001,
    abilityGameId: 2139,
    opportunityType: "interrupt",
    openedAt: 1000,
    closedAt: 2500,
    eligibleActions: [2139],
    exclusionReasons: [],
    evidenceReferences: ["synthetic"],
    derivation: "synthetic_fixture",
    ...partial,
  };
}

/** Build N opportunities across dungeons with a given miss rate. */
export function buildInterruptFixture(input: {
  id: string;
  count: number;
  missRate: number;
  dungeons?: string[];
  severity?: number;
  confidence?: UtilityOpportunity["confidence"];
}): UtilityOpportunity[] {
  const dungeons = input.dungeons ?? [
    "skyreach",
    "pit-of-saron",
    "magisters-terrace",
    "algethar-academy",
    "maisara-caverns",
    "nexus-point-xenas",
    "seat-of-the-triumvirate",
    "windrunner-spire",
  ];
  const out: UtilityOpportunity[] = [];
  const missCount = Math.round(input.count * input.missRate);
  for (let i = 0; i < input.count; i += 1) {
    const isMiss = i < missCount;
    out.push(
      opp({
        id: `${input.id}:${i}`,
        dungeonSlug: dungeons[i % dungeons.length]!,
        hostileSpellId: 400000 + (i % 12),
        outcome: isMiss ? "CAST_COMPLETED_CONFIRMED_MISS" : "SUCCESS_DIRECT_INTERRUPT",
        confidence: input.confidence ?? "HIGH",
        severity: input.severity ?? 0.8,
      }),
    );
  }
  return out;
}

export function runSyntheticFixtureSuite(): Array<{
  id: string;
  label: string;
  castStopsRaw: number;
  responseRate: number | null;
  misses: number;
  successes: number;
  supportRaw?: number;
}> {
  const emptyFallback = {
    tierCounts: { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
    durationHours: 1,
  };

  const allSuccess = scoreCastStopsFromOpportunities(
    buildInterruptFixture({ id: "all-success", count: 20, missRate: 0 }),
    emptyFallback,
  );
  const halfMiss = scoreCastStopsFromOpportunities(
    buildInterruptFixture({ id: "half-miss", count: 20, missRate: 0.5 }),
    emptyFallback,
  );
  const allMiss = scoreCastStopsFromOpportunities(
    buildInterruptFixture({ id: "all-miss", count: 20, missRate: 1 }),
    emptyFallback,
  );

  // High volume poor priority: many low-severity successes + misses on high severity
  const highVolPoor: UtilityOpportunity[] = [
    ...buildInterruptFixture({
      id: "hv-low",
      count: 30,
      missRate: 0,
      severity: 0.3,
      dungeons: ["skyreach"],
    }),
    ...buildInterruptFixture({
      id: "hv-high-miss",
      count: 10,
      missRate: 1,
      severity: 1,
      dungeons: ["skyreach", "pit-of-saron"],
    }),
  ];
  const highVolPoorScore = scoreCastStopsFromOpportunities(highVolPoor, {
    tierCounts: { CONFIRMED_IMPACT: 40, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
    durationHours: 1,
  });

  // Low volume perfect dangerous response
  const lowVolPerfect = scoreCastStopsFromOpportunities(
    buildInterruptFixture({
      id: "lv-perfect",
      count: 8,
      missRate: 0,
      severity: 1,
      dungeons: [
        "skyreach",
        "pit-of-saron",
        "magisters-terrace",
        "algethar-academy",
        "maisara-caverns",
        "nexus-point-xenas",
        "seat-of-the-triumvirate",
        "windrunner-spire",
      ],
    }),
    emptyFallback,
  );

  // Passive support spam
  const passiveItems: UtilityV2EvidenceItem[] = Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`,
    domain: "support",
    kind: "EXTERNAL",
    tier: "CONFIRMED_APPLICATION",
    timestamp: i,
    abilityGameID: 212653,
    abilityName: "Shimmer",
    targetActorId: -1,
    interruptedSpellId: null,
    removedSpellId: null,
    durationMs: null,
    correlationNotes: ["cast_observed", "value_not_inferable_from_cast_alone"],
    confidence: "MEDIUM",
    observability: "PARTIAL",
  }));
  const passiveSupport = scoreSupportFromSemantics(passiveItems, 1, 1);

  // Reactive high-impact support
  const reactiveItems: UtilityV2EvidenceItem[] = Array.from({ length: 12 }, (_, i) => ({
    id: `r${i}`,
    domain: "support",
    kind: "DISPEL",
    tier: "CONFIRMED_IMPACT",
    timestamp: i,
    abilityGameID: 475,
    abilityName: "Remove Curse",
    targetActorId: 2,
    interruptedSpellId: null,
    removedSpellId: 1000 + i,
    durationMs: null,
    correlationNotes: ["removed_spell_confirmed"],
    confidence: "HIGH",
    observability: "FULL",
  }));
  const reactiveSupport = scoreSupportFromSemantics(reactiveItems, 1, 1);

  // Coverage vs behavior: identical opportunities, different dungeon counts affect confidence path externally;
  // raw castStops should be similar when missObservable.
  const smallSample = scoreCastStopsFromOpportunities(
    buildInterruptFixture({
      id: "small",
      count: 8,
      missRate: 0.25,
      dungeons: ["skyreach", "pit-of-saron"],
    }),
    emptyFallback,
  );
  const completeSample = scoreCastStopsFromOpportunities(
    buildInterruptFixture({
      id: "complete",
      count: 8,
      missRate: 0.25,
      dungeons: [
        "skyreach",
        "pit-of-saron",
        "magisters-terrace",
        "algethar-academy",
        "maisara-caverns",
        "nexus-point-xenas",
        "seat-of-the-triumvirate",
        "windrunner-spire",
      ],
    }),
    emptyFallback,
  );

  return [
    {
      id: "all_successfully_handled",
      label: "Same opportunities, all successfully handled",
      castStopsRaw: allSuccess.rawScore,
      responseRate: allSuccess.responseRate,
      misses: allSuccess.misses,
      successes: allSuccess.successes,
    },
    {
      id: "half_missed",
      label: "Same opportunities, half missed",
      castStopsRaw: halfMiss.rawScore,
      responseRate: halfMiss.responseRate,
      misses: halfMiss.misses,
      successes: halfMiss.successes,
    },
    {
      id: "all_missed",
      label: "Same opportunities, all missed",
      castStopsRaw: allMiss.rawScore,
      responseRate: allMiss.responseRate,
      misses: allMiss.misses,
      successes: allMiss.successes,
    },
    {
      id: "high_volume_poor_priority",
      label: "High raw interrupt volume but poor priority-response rate",
      castStopsRaw: highVolPoorScore.rawScore,
      responseRate: highVolPoorScore.responseRate,
      misses: highVolPoorScore.misses,
      successes: highVolPoorScore.successes,
    },
    {
      id: "low_volume_perfect_dangerous",
      label: "Low volume but perfect response to dangerous casts",
      castStopsRaw: lowVolPerfect.rawScore,
      responseRate: lowVolPerfect.responseRate,
      misses: lowVolPerfect.misses,
      successes: lowVolPerfect.successes,
    },
    {
      id: "passive_support_spam",
      label: "Passive/personal support spam only",
      castStopsRaw: 50,
      responseRate: null,
      misses: 0,
      successes: 0,
      supportRaw: passiveSupport.rawScore,
    },
    {
      id: "reactive_high_impact_support",
      label: "Reactive high-impact support only",
      castStopsRaw: 50,
      responseRate: null,
      misses: 0,
      successes: 0,
      supportRaw: reactiveSupport.rawScore,
    },
    {
      id: "small_sample_identical_behavior",
      label: "Small sample identical behavior",
      castStopsRaw: smallSample.rawScore,
      responseRate: smallSample.responseRate,
      misses: smallSample.misses,
      successes: smallSample.successes,
    },
    {
      id: "complete_sample_identical_behavior",
      label: "Complete sample identical behavior",
      castStopsRaw: completeSample.rawScore,
      responseRate: completeSample.responseRate,
      misses: completeSample.misses,
      successes: completeSample.successes,
    },
  ];
}
