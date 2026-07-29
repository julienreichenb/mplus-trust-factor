import { describe, expect, it } from "vitest";
import {
  combatFactsStubFromHandle,
  readPersistedCombatFactsHandle,
} from "./persisted-combat-facts.js";
import {
  applyUtilityPublicationBoundary,
  replaceUtilityObservationsDimensionScoped,
} from "./utility-publication-refresh.js";
import type { MetricObservationDTO } from "@mplus/contracts";
import { DEFAULT_V6_UTILITY_PUBLICATION_ELIGIBILITY } from "@mplus/scoring";
import type { UtilityShadowPassResult } from "@mplus/provider-warcraftlogs";

const GATES = { ...DEFAULT_V6_UTILITY_PUBLICATION_ELIGIBILITY };

function survivalObs(): MetricObservationDTO {
  return {
    metricKey: "survival.outcome",
    dimension: "SURVIVAL",
    rawValue: 70,
    normalizedValue: 70,
    confidence: 0.9,
    observedAt: new Date().toISOString(),
    sourceProvider: "warcraftlogs",
    coverage: null,
    context: {},
  };
}

function scoredShadow(mode: "off" | "shadow" | "published" = "published"): UtilityShadowPassResult {
  return {
    analysisVersion: "utility-observed-shadow-v1",
    publicationMode: mode,
    status: "SHADOW_SCORED",
    altersPublicUtility: false,
    altersPublicTrustScore: false,
    replacesLastKnownGoodUtility: false,
    detailedWclEventCallsMade: 0,
    researchModeAllowedInPublication: false,
    semantics: {
      version: "utility-observed-semantics-v1",
      scoreKind: "observed_positive_contribution",
    } as UtilityShadowPassResult["semantics"],
    adminDiagnosticsOnly: false,
    score: {
      mode: "OBSERVED_CONTRIBUTION",
      productionCandidate: true,
      scoreKind: "observed_positive_contribution",
      rawBehaviorEstimate: 65,
      reliabilityAdjustedScore: 61.91,
      confidence: 70,
      confidenceComponents: {},
      reliability: 0.8,
      domainBreakdown: [
        {
          domain: "castStops",
          applicable: true,
          rawScore: 52,
          weight: 0.45,
          weightShare: 0.45,
          uncappedContribution: 1,
          cappedContribution: 1,
          capApplied: false,
          events: 3,
          perCombatHour: 1.2,
          notes: [],
        },
        {
          domain: "support",
          applicable: true,
          rawScore: 64,
          weight: 0.28,
          weightShare: 0.28,
          uncappedContribution: 4,
          cappedContribution: 4,
          capApplied: false,
          events: 45,
          perCombatHour: 7,
          notes: [],
        },
      ],
      context: {},
      denominatorChoice: "combat_hours",
      explanations: [],
    },
  };
}

describe("persisted combat facts hydrate", () => {
  it("reads actor metadata from wcl-combat-facts-v1 summary", () => {
    const handle = readPersistedCombatFactsHandle({
      combatFacts: {
        reportCode: "AbCdEf",
        fightId: 3,
        revision: 2,
        targetSourceId: 10,
      },
      attributedSourceIds: [10, 44],
      fightStartTime: 100,
      fightEndTime: 500,
    });
    expect(handle).toMatchObject({
      reportCode: "AbCdEf",
      fightId: 3,
      revision: 2,
      targetSourceId: 10,
      attributedSourceIds: [10, 44],
    });
    const stub = combatFactsStubFromHandle(handle!);
    expect(stub.targetSourceId).toBe(10);
    expect(stub.attributedSourceIds).toEqual([10, 44]);
  });
});

describe("Utility publication preserves Survival", () => {
  for (const mode of ["off", "shadow", "published"] as const) {
    it(`keeps Survival observations in ${mode} mode`, () => {
      const survival = survivalObs();
      const performance: MetricObservationDTO = {
        metricKey: "performance.current_season_peak",
        dimension: "PERFORMANCE",
        rawValue: 80,
        normalizedValue: 80,
        confidence: 0.9,
        observedAt: new Date().toISOString(),
        sourceProvider: "warcraftlogs",
        coverage: null,
        context: {},
      };
      const result = applyUtilityPublicationBoundary({
        gates: GATES,
        observations: [performance, survival],
        shadow: scoredShadow(mode),
        coverage: {
          candidateRunCount: 15,
          compatibleEvidenceCount: 15,
          analyzedRunCount: 15,
          observedDomainCount: 2,
          classSlug: "warlock",
          specSlug: "affliction",
        },
        observedAt: new Date().toISOString(),
        classSlug: "warlock",
        specSlug: "affliction",
      });
      const survivalOut = result.publicUtilitySafeObservations.filter((o) => o.dimension === "SURVIVAL");
      expect(survivalOut).toHaveLength(1);
      expect(survivalOut[0]!.normalizedValue).toBe(70);
      expect(result.publicUtilitySafeObservations.some((o) => o.dimension === "PERFORMANCE")).toBe(
        true,
      );
      if (mode === "published") {
        const util = result.publicUtilitySafeObservations.filter((o) => o.dimension === "UTILITY");
        expect(util).toHaveLength(1);
        expect(util[0]!.normalizedValue).toBe(61.91);
      }
    });
  }

  it("dimension-scoped replace cannot drop Survival when utility array is empty", () => {
    const survival = survivalObs();
    const next = replaceUtilityObservationsDimensionScoped([survival], []);
    expect(next).toHaveLength(1);
    expect(next[0]!.dimension).toBe("SURVIVAL");
  });
});
