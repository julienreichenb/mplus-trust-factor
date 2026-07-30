/**
 * Utility fallback orchestration — Option A behaviours + Survival isolation.
 */
import { describe, expect, it, vi } from "vitest";
import {
  attachDatasetToBundle,
  buildEmptyBundle,
  HOSTILE_CAST_FILTER_EXPRESSION,
  UTILITY_EVIDENCE_CONSUMERS,
  evaluateUtilityPublicationEligibility,
  MODEL_V6_UTILITY_PUBLICATION_GATES,
  unionRequiredDatasets,
  type WclRunEvidenceBundle,
  type WclRunEvidenceDataset,
  type UtilityShadowPassResult,
} from "@mplus/provider-warcraftlogs";
import {
  emptyUtilityFallbackDiagnostics,
  runUtilityFallbackEvidencePass,
  UTILITY_FALLBACK_MAX_EXTRA_RUNS,
  buildUtilityFallbackIngestConsumers,
  assertUtilityFallbackBundleIsUtilityOnly,
  partitionEvidenceForScoringConsumers,
  utilityFallbackAllowedDatasetKeys,
} from "./utility-fallback-refresh.js";
import { applyUtilityPublicationBoundary } from "./utility-publication-refresh.js";
import type { MetricObservationDTO } from "@mplus/contracts";

function okDataset(
  key: WclRunEvidenceDataset["key"],
  events: Array<Record<string, unknown>> = [],
): WclRunEvidenceDataset {
  return {
    key,
    state: "OK",
    truncated: false,
    pageCount: 1,
    eventCount: events.length,
    filterSourceId: key === "HostileCasts" ? null : 10,
    filterExpression: key === "HostileCasts" ? HOSTILE_CAST_FILTER_EXPRESSION : null,
    pages: [
      {
        pageIndex: 0,
        startTime: 0,
        nextPageTimestamp: null,
        eventCount: events.length,
        payloadFingerprint: `${key}-fp`,
      },
    ],
    events,
    consumers: ["utility"],
    pointsConsumed: 1,
    costSource: "estimated",
    requestCostUnits: [1],
    wclRequests: 1,
    fetchedAt: new Date().toISOString(),
    source: "persisted",
  };
}

function completeBundle(opts: {
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  providerCalls?: number;
  withInterrupt?: boolean;
}): WclRunEvidenceBundle {
  let bundle = buildEmptyBundle({
    reportCode: opts.reportCode,
    reportRevision: 1,
    fightId: opts.fightId,
    playerActorId: 10,
    ownedPetActorIds: [],
    dungeonSlug: opts.dungeonSlug,
    startTime: 0,
    endTime: 600_000,
    consumers: ["utility"],
  });
  bundle = {
    ...bundle,
    masterData: {
      actors: [{ id: 10, name: "Test", type: "Player", subType: "Mage", petOwner: null }],
    },
  };
  for (const key of UTILITY_EVIDENCE_CONSUMERS) {
    if (key === "masterData") continue;
    const events =
      opts.withInterrupt && key === "Interrupts"
        ? [
            {
              type: "interrupt",
              sourceID: 10,
              targetID: 99,
              abilityGameID: 2139,
              timestamp: 1000,
            },
          ]
        : [];
    bundle = attachDatasetToBundle(bundle, {
      ...okDataset(key, events),
      // Avoid attachDatasetToBundle inflating providerCalls for fixture control.
      wclRequests: 0,
      pageCount: 0,
      requestCostUnits: [],
    });
  }
  const providerCalls = opts.providerCalls ?? 0;
  bundle = {
    ...bundle,
    accounting: {
      ...bundle.accounting,
      providerCalls,
      pages: providerCalls,
      pointsConsumed: providerCalls,
      estimatedPointsConsumed: providerCalls,
      costSource: providerCalls === 0 ? "measured" : "estimated",
      persistedHits: providerCalls === 0 ? 1 : 0,
      cacheHits: providerCalls === 0 ? 1 : 0,
      consumers: ["utility"],
    },
  };
  return bundle;
}

describe("runUtilityFallbackEvidencePass", () => {
  it("does not ingest when baseline is publishable", async () => {
    const ingest = vi.fn();
    const baseline = [
      completeBundle({
        reportCode: "A",
        fightId: 1,
        dungeonSlug: "ara-kara",
        withInterrupt: true,
      }),
      completeBundle({
        reportCode: "B",
        fightId: 1,
        dungeonSlug: "dawnbreaker",
        withInterrupt: true,
      }),
      completeBundle({
        reportCode: "C",
        fightId: 1,
        dungeonSlug: "priory",
        withInterrupt: true,
      }),
      completeBundle({
        reportCode: "D",
        fightId: 1,
        dungeonSlug: "floodgate",
        withInterrupt: true,
      }),
    ];
    const result = await runUtilityFallbackEvidencePass({
      baselineState: "PUBLISHABLE",
      baselineBundles: baseline,
      baselineDungeonSlugs: baseline.map((b) => b.dungeonSlug),
      activeDungeonPool: ["ara-kara", "dawnbreaker", "priory", "floodgate"],
      candidates: [
        {
          dungeonSlug: "cinderbrew-meadery",
          reportCode: "X",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
        },
      ],
      classSlug: "mage",
      specSlug: "fire",
      roleSlug: "dps",
      detailedWclEventCallsMade: 0,
      ingestExtraRun: ingest,
    });
    expect(ingest).not.toHaveBeenCalled();
    expect(result.diagnostics.triggered).toBe(false);
    expect(result.selection.stoppedReason).toBe("not_retryable");
  });

  it("does not fallback for complete-zero contribution (Option A)", async () => {
    const ingest = vi.fn();
    const baseline = [
      completeBundle({ reportCode: "A", fightId: 1, dungeonSlug: "ara-kara" }),
      completeBundle({ reportCode: "B", fightId: 1, dungeonSlug: "dawnbreaker" }),
      completeBundle({ reportCode: "C", fightId: 1, dungeonSlug: "priory" }),
      completeBundle({ reportCode: "D", fightId: 1, dungeonSlug: "floodgate" }),
    ];
    const result = await runUtilityFallbackEvidencePass({
      baselineState: "COMPLETE_ZERO_CONTRIBUTION",
      baselineBundles: baseline,
      baselineDungeonSlugs: baseline.map((b) => b.dungeonSlug),
      activeDungeonPool: ["ara-kara", "dawnbreaker", "priory", "floodgate"],
      candidates: [
        {
          dungeonSlug: "cinderbrew-meadery",
          reportCode: "X",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
        },
      ],
      classSlug: "mage",
      specSlug: "fire",
      roleSlug: "dps",
      detailedWclEventCallsMade: 0,
      ingestExtraRun: ingest,
    });
    expect(ingest).not.toHaveBeenCalled();
    expect(result.baseline.state).toBe("COMPLETE_ZERO_CONTRIBUTION");
    expect(result.baseline.publishable).toBe(false);
    expect(result.diagnostics.triggered).toBe(false);
  });

  it("selects bounded extras for retryable insufficient baseline and never exceeds four", async () => {
    const ingest = vi.fn(async ({ candidate }) => ({
      bundle: completeBundle({
        reportCode: candidate.reportCode,
        fightId: candidate.fightId,
        dungeonSlug: candidate.dungeonSlug,
        providerCalls: 3,
        withInterrupt: true,
      }),
    }));
    const baseline = [
      completeBundle({
        reportCode: "A",
        fightId: 1,
        dungeonSlug: "ara-kara",
        withInterrupt: true,
      }),
    ];
    const pool = [
      "ara-kara",
      "dawnbreaker",
      "priory",
      "floodgate",
      "cinderbrew-meadery",
      "rookery",
    ];
    const candidates = pool.slice(1).map((dungeonSlug, i) => ({
      dungeonSlug,
      reportCode: `R${i}`,
      fightId: 1,
      reportRevision: 1,
      hasPublicReport: true,
      alreadyInBaseline: false,
      scoreValue: 200 - i,
    }));
    // Add a 6th to prove the hard cap.
    candidates.push({
      dungeonSlug: "motherlode",
      reportCode: "R99",
      fightId: 1,
      reportRevision: 1,
      hasPublicReport: true,
      alreadyInBaseline: false,
      scoreValue: 100,
    });

    const result = await runUtilityFallbackEvidencePass({
      baselineState: "INSUFFICIENT_EVIDENCE_RETRYABLE",
      baselineBundles: baseline,
      baselineDungeonSlugs: ["ara-kara"],
      activeDungeonPool: [...pool, "motherlode"],
      candidates,
      classSlug: "mage",
      specSlug: "fire",
      roleSlug: "dps",
      detailedWclEventCallsMade: 2,
      maxExtraRuns: UTILITY_FALLBACK_MAX_EXTRA_RUNS,
      ingestExtraRun: ingest,
    });

    expect(result.diagnostics.triggered).toBe(true);
    expect(ingest.mock.calls.length).toBeLessThanOrEqual(4);
    expect(result.diagnostics.selected.length).toBeLessThanOrEqual(4);
    expect(result.diagnostics.providerCalls).toBe(ingest.mock.calls.length * 3);
  });

  it("stops after first sufficient extra run", async () => {
    const ingest = vi.fn(async ({ candidate }) => ({
      bundle: completeBundle({
        reportCode: candidate.reportCode,
        fightId: candidate.fightId,
        dungeonSlug: candidate.dungeonSlug,
        providerCalls: 2,
        withInterrupt: true,
      }),
    }));
    // One analyzed run → need more; after adding complete interrupt runs, may become publishable.
    const baseline = [
      completeBundle({
        reportCode: "A",
        fightId: 1,
        dungeonSlug: "ara-kara",
        withInterrupt: true,
      }),
    ];
    const result = await runUtilityFallbackEvidencePass({
      baselineState: "INSUFFICIENT_EVIDENCE_RETRYABLE",
      baselineBundles: baseline,
      baselineDungeonSlugs: ["ara-kara"],
      activeDungeonPool: ["ara-kara", "dawnbreaker", "priory", "floodgate"],
      candidates: [
        {
          dungeonSlug: "dawnbreaker",
          reportCode: "D1",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
          scoreValue: 300,
        },
        {
          dungeonSlug: "priory",
          reportCode: "P1",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
          scoreValue: 290,
        },
        {
          dungeonSlug: "floodgate",
          reportCode: "F1",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
          scoreValue: 280,
        },
      ],
      classSlug: "mage",
      specSlug: "fire",
      roleSlug: "dps",
      detailedWclEventCallsMade: 0,
      targetExtraCompleteRuns: 4,
      ingestExtraRun: ingest,
    });

    // Stops when no longer retryable (publishable or complete-zero), or at cap.
    expect(result.diagnostics.triggered).toBe(true);
    expect(ingest.mock.calls.length).toBeGreaterThan(0);
    expect(ingest.mock.calls.length).toBeLessThanOrEqual(4);
    if (result.baseline.state === "PUBLISHABLE") {
      expect(result.diagnostics.stoppedReason).toBe("publishable_after_ingest");
      // Should not have continued after becoming publishable.
      expect(ingest.mock.calls.length).toBeLessThan(4);
    }
  });

  it("stops on rate budget without looping", async () => {
    const ingest = vi.fn();
    const result = await runUtilityFallbackEvidencePass({
      baselineState: "INSUFFICIENT_EVIDENCE_RETRYABLE",
      baselineBundles: [completeBundle({ reportCode: "A", fightId: 1, dungeonSlug: "ara-kara" })],
      baselineDungeonSlugs: ["ara-kara"],
      activeDungeonPool: ["ara-kara", "dawnbreaker"],
      candidates: [
        {
          dungeonSlug: "dawnbreaker",
          reportCode: "D1",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
        },
      ],
      classSlug: "mage",
      specSlug: "fire",
      roleSlug: "dps",
      detailedWclEventCallsMade: 0,
      rateBudgetAction: "STOP",
      ingestExtraRun: ingest,
    });
    expect(ingest).not.toHaveBeenCalled();
    expect(result.diagnostics.stoppedReason).toBe("budget");
    expect(result.baseline.state).toBe("BUDGET_EXHAUSTED");
  });

  it("does not fallback for NO_PUBLIC_LOGS", async () => {
    const ingest = vi.fn();
    await runUtilityFallbackEvidencePass({
      baselineState: "INSUFFICIENT_EVIDENCE_RETRYABLE",
      baselineBundles: [],
      baselineDungeonSlugs: [],
      activeDungeonPool: ["ara-kara"],
      candidates: [
        {
          dungeonSlug: "ara-kara",
          reportCode: "X",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
        },
      ],
      classSlug: "mage",
      specSlug: "fire",
      roleSlug: "dps",
      detailedWclEventCallsMade: 0,
      wclDataState: "NO_PUBLIC_LOGS",
      ingestExtraRun: ingest,
    });
    // Classifier maps NO_PUBLIC_LOGS before retryable when rebuilding; ingest must not run.
    expect(ingest).not.toHaveBeenCalled();
  });

  it("avoids duplicate cached fetch accounting when providerCalls=0", async () => {
    const ingest = vi.fn(async ({ candidate }) => ({
      bundle: completeBundle({
        reportCode: candidate.reportCode,
        fightId: candidate.fightId,
        dungeonSlug: candidate.dungeonSlug,
        providerCalls: 0,
        withInterrupt: true,
      }),
    }));
    const result = await runUtilityFallbackEvidencePass({
      baselineState: "INSUFFICIENT_EVIDENCE_RETRYABLE",
      baselineBundles: [
        completeBundle({
          reportCode: "A",
          fightId: 1,
          dungeonSlug: "ara-kara",
          withInterrupt: true,
        }),
      ],
      baselineDungeonSlugs: ["ara-kara"],
      activeDungeonPool: ["ara-kara", "dawnbreaker", "priory", "floodgate"],
      candidates: [
        {
          dungeonSlug: "dawnbreaker",
          reportCode: "D1",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
          predictedUtilityEvidenceComplete: true,
          predictedProviderCalls: 0,
        },
        {
          dungeonSlug: "priory",
          reportCode: "P1",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
          predictedUtilityEvidenceComplete: true,
          predictedProviderCalls: 0,
        },
      ],
      classSlug: "mage",
      specSlug: "fire",
      roleSlug: "dps",
      detailedWclEventCallsMade: 0,
      ingestExtraRun: ingest,
    });
    expect(result.diagnostics.newlyFetchedCount).toBe(0);
    expect(result.diagnostics.cachedReuseCount).toBe(result.diagnostics.ingestedCount);
    expect(result.diagnostics.providerCalls).toBe(0);
  });

  it("empty diagnostics defaults are stable", () => {
    const empty = emptyUtilityFallbackDiagnostics("PUBLISHABLE");
    expect(empty.triggered).toBe(false);
    expect(empty.maxExtraRuns).toBe(4);
    expect(empty.selected).toEqual([]);
  });
});

describe("Utility fallback Survival isolation contract", () => {
  it("requests Utility consumers only — never survival", () => {
    expect(buildUtilityFallbackIngestConsumers()).toEqual(["utility"]);
    expect(buildUtilityFallbackIngestConsumers()).not.toContain("survival");
  });

  it("Utility-only dataset union excludes Survival-only streams", () => {
    const utilityOnly = unionRequiredDatasets(buildUtilityFallbackIngestConsumers());
    expect(utilityOnly).not.toContain("DamageTaken");
    expect(utilityOnly).not.toContain("Healing");
    for (const key of utilityFallbackAllowedDatasetKeys()) {
      if (key === "masterData") continue;
      expect(utilityOnly).toContain(key);
    }
    const dual = unionRequiredDatasets(["survival", "utility"]);
    expect(dual).toContain("DamageTaken");
    expect(dual).toContain("Healing");
  });

  it("fallback bundles must not carry survival consumer tags or Survival-only datasets", () => {
    const bundle = completeBundle({
      reportCode: "FB1",
      fightId: 2,
      dungeonSlug: "dawnbreaker",
      withInterrupt: true,
    });
    expect(assertUtilityFallbackBundleIsUtilityOnly(bundle)).toEqual({ ok: true });
    expect(bundle.accounting.consumers).toEqual(["utility"]);
    expect(bundle.eventDatasets.DamageTaken).toBeUndefined();
    expect(bundle.eventDatasets.Healing).toBeUndefined();
  });

  it("rejects a mis-tagged survival+utility fallback bundle", () => {
    const bad = completeBundle({
      reportCode: "BAD",
      fightId: 1,
      dungeonSlug: "ara-kara",
    });
    bad.accounting.consumers = ["survival", "utility"];
    expect(assertUtilityFallbackBundleIsUtilityOnly(bad).ok).toBe(false);
  });

  it("Survival row set is value-identical whether or not fallback keys exist", () => {
    const survivalRows = [
      { runId: "canonical-1" },
      { runId: "canonical-2" },
    ];
    const withoutFallback = partitionEvidenceForScoringConsumers({
      survivalRows,
      utilityBundles: [
        { reportCode: "A", fightId: 1 },
        { reportCode: "B", fightId: 1 },
      ],
      fallbackReportFightKeys: [],
    });
    const withFallback = partitionEvidenceForScoringConsumers({
      survivalRows,
      utilityBundles: [
        { reportCode: "A", fightId: 1 },
        { reportCode: "B", fightId: 1 },
        { reportCode: "FB", fightId: 9 },
      ],
      fallbackReportFightKeys: ["FB:9"],
    });
    expect(withFallback.survivalRunIds).toEqual(withoutFallback.survivalRunIds);
    expect(withFallback.survivalRunIds).toEqual(["canonical-1", "canonical-2"]);
    expect(withFallback.survivalTouchedByFallback).toBe(false);
    expect(withoutFallback.survivalTouchedByFallback).toBe(false);
    expect(withFallback.utilityOnlyFallbackKeys).toEqual(["FB:9"]);
    expect(withoutFallback.utilityOnlyFallbackKeys).toEqual([]);
  });

  it("fallback pass does not invent a second refresh-character job", async () => {
    const enqueueRefresh = vi.fn();
    const ingest = vi.fn(async ({ candidate }) => ({
      bundle: completeBundle({
        reportCode: candidate.reportCode,
        fightId: candidate.fightId,
        dungeonSlug: candidate.dungeonSlug,
        providerCalls: 1,
        withInterrupt: true,
      }),
    }));
    await runUtilityFallbackEvidencePass({
      baselineState: "INSUFFICIENT_EVIDENCE_RETRYABLE",
      baselineBundles: [
        completeBundle({
          reportCode: "A",
          fightId: 1,
          dungeonSlug: "ara-kara",
          withInterrupt: true,
        }),
      ],
      baselineDungeonSlugs: ["ara-kara"],
      activeDungeonPool: ["ara-kara", "dawnbreaker", "priory", "floodgate"],
      candidates: [
        {
          dungeonSlug: "dawnbreaker",
          reportCode: "D1",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
        },
      ],
      classSlug: "mage",
      specSlug: "fire",
      roleSlug: "dps",
      detailedWclEventCallsMade: 0,
      ingestExtraRun: ingest,
    });
    expect(enqueueRefresh).not.toHaveBeenCalled();
  });

  it("hard cap of four extra runs remains intact", async () => {
    const ingest = vi.fn(async ({ candidate }) => ({
      bundle: completeBundle({
        reportCode: candidate.reportCode,
        fightId: candidate.fightId,
        dungeonSlug: candidate.dungeonSlug,
        providerCalls: 1,
      }),
    }));
    const pool = ["a", "b", "c", "d", "e", "f"];
    const result = await runUtilityFallbackEvidencePass({
      baselineState: "INSUFFICIENT_EVIDENCE_RETRYABLE",
      baselineBundles: [
        completeBundle({ reportCode: "BASE", fightId: 1, dungeonSlug: "z" }),
      ],
      baselineDungeonSlugs: ["z"],
      activeDungeonPool: pool,
      candidates: pool.map((dungeonSlug, i) => ({
        dungeonSlug,
        reportCode: `R${i}`,
        fightId: 1,
        reportRevision: 1,
        hasPublicReport: true,
        alreadyInBaseline: false,
        scoreValue: 100 - i,
      })),
      classSlug: "mage",
      specSlug: "fire",
      roleSlug: "dps",
      detailedWclEventCallsMade: 0,
      maxExtraRuns: UTILITY_FALLBACK_MAX_EXTRA_RUNS,
      ingestExtraRun: ingest,
    });
    expect(ingest.mock.calls.length).toBeLessThanOrEqual(4);
    expect(result.diagnostics.selected.length).toBeLessThanOrEqual(4);
  });

  it("complete-zero remains Utility U — never synthesizes 50 or 0", () => {
    const eligibility = evaluateUtilityPublicationEligibility({
      publicationMode: "published",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 50,
      confidence: 30,
      gates: MODEL_V6_UTILITY_PUBLICATION_GATES,
      baselineState: "COMPLETE_ZERO_CONTRIBUTION",
      coverage: {
        candidateRunCount: 8,
        compatibleEvidenceCount: 5,
        analyzedRunCount: 5,
        observedDomainCount: 0,
        attributableEvents: 0,
        missingMasterDataCount: 0,
        incompleteEvidenceCount: 0,
      },
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain("COMPLETE_ZERO_CONTRIBUTION");

    const shadow: UtilityShadowPassResult = {
      analysisVersion: "utility-observed-shadow-v1",
      publicationMode: "published",
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
        rawBehaviorEstimate: 50,
        reliabilityAdjustedScore: 50,
        confidence: 30,
        confidenceComponents: {},
        reliability: 0,
        domainBreakdown: [],
        explanations: [],
        context: {
          runCount: 5,
          dungeonCount: 5,
          dungeons: [],
          combatHours: 1,
          fightDurationHours: 1,
          activeCombatEstimate: null,
          hostileCastWindows: 0,
          playerInterruptSuccesses: 0,
          playerDispelPurgeSuccesses: 0,
          playerStrategicCcSuccesses: 0,
          playerSupportEvents: 0,
          attributableEvents: 0,
          toolkit: {
            hasInterrupt: true,
            hasDispel: false,
            hasPurge: false,
            hasHardCc: false,
          },
        },
        denominatorChoice: { selected: "x", rejected: [] },
        researchModeExcluded: [],
      } as UtilityShadowPassResult["score"],
    };
    const published = applyUtilityPublicationBoundary({
      observations: [] as MetricObservationDTO[],
      shadow,
      baselineState: "COMPLETE_ZERO_CONTRIBUTION",
      gates: MODEL_V6_UTILITY_PUBLICATION_GATES,
      coverage: {
        candidateRunCount: 8,
        compatibleEvidenceCount: 5,
        analyzedRunCount: 5,
        observedDomainCount: 0,
        attributableEvents: 0,
      },
      observedAt: new Date().toISOString(),
    });
    expect(published.published).toBe(false);
    expect(
      published.publicUtilitySafeObservations.some(
        (o) => o.metricKey === "utility.observed_contribution",
      ),
    ).toBe(false);
  });

  it("publishable Utility with observed contribution still publishes", () => {
    const eligibility = evaluateUtilityPublicationEligibility({
      publicationMode: "published",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 61.91,
      confidence: 70,
      gates: MODEL_V6_UTILITY_PUBLICATION_GATES,
      baselineState: "PUBLISHABLE",
      coverage: {
        candidateRunCount: 8,
        compatibleEvidenceCount: 6,
        analyzedRunCount: 6,
        observedDomainCount: 3,
        attributableEvents: 20,
        missingMasterDataCount: 0,
        incompleteEvidenceCount: 0,
        evidenceAnalysisVersion: "wcl-run-evidence-v1",
        classSlug: "mage",
        specSlug: "fire",
      },
    });
    expect(eligibility.eligible).toBe(true);
  });
});
