/**
 * Utility baseline diagnostics — classification and fallback selection.
 */
import { describe, expect, it } from "vitest";
import {
  UTILITY_ONLY_DATASET_KEYS,
  UTILITY_SURVIVAL_OVERLAP_DATASET_KEYS,
  UTILITY_BASELINE_REQUEST_COST_TABLE,
  classifyUtilityBaselineState,
  classifyUtilityEvidenceAbsence,
  selectUtilityFallbackRuns,
  diagnoseUtilityBaselineRun,
  survivalBundleSatisfiesUtility,
} from "./utility-baseline-diagnostics.js";
import { attachDatasetToBundle, buildEmptyBundle } from "./wcl-run-evidence.js";
import {
  HOSTILE_CAST_FILTER_EXPRESSION,
  UTILITY_EVIDENCE_CONSUMERS,
  SURVIVAL_EVIDENCE_CONSUMERS,
  type WclRunEvidenceDataset,
} from "./wcl-run-evidence-types.js";

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
    consumers: ["survival", "utility"],
    pointsConsumed: 1,
    costSource: "estimated",
    requestCostUnits: [1],
    wclRequests: 1,
    fetchedAt: new Date().toISOString(),
    source: "persisted",
  };
}

function completeUtilityBundle() {
  let bundle = buildEmptyBundle({
    reportCode: "ABC",
    reportRevision: 1,
    fightId: 7,
    playerActorId: 10,
    ownedPetActorIds: [],
    dungeonSlug: "ara-kara",
    startTime: 0,
    endTime: 600_000,
    consumers: ["survival", "utility"],
  });
  bundle = {
    ...bundle,
    masterData: {
      actors: [{ id: 10, name: "Test", type: "Player", subType: "Mage", petOwner: null }],
    },
  };
  for (const key of UTILITY_EVIDENCE_CONSUMERS) {
    if (key === "masterData") continue;
    bundle = attachDatasetToBundle(bundle, okDataset(key));
  }
  return bundle;
}

describe("utility dataset gap vs Survival", () => {
  it("identifies Utility-only streams Survival cannot supply alone", () => {
    expect(UTILITY_ONLY_DATASET_KEYS.sort()).toEqual(
      ["DamageDone", "Dispels", "HostileCasts", "Interrupts"].sort(),
    );
    for (const k of UTILITY_SURVIVAL_OVERLAP_DATASET_KEYS) {
      expect(SURVIVAL_EVIDENCE_CONSUMERS).toContain(k);
    }
  });

  it("Survival-only bundle does not satisfy Utility", () => {
    let bundle = buildEmptyBundle({
      reportCode: "S",
      reportRevision: 1,
      fightId: 1,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "ara-kara",
      startTime: 0,
      endTime: 1000,
      consumers: ["survival"],
    });
    bundle = {
      ...bundle,
      masterData: { actors: [{ id: 10, name: "T", type: "Player" }] },
    };
    for (const key of SURVIVAL_EVIDENCE_CONSUMERS) {
      if (key === "masterData") continue;
      bundle = attachDatasetToBundle(bundle, okDataset(key));
    }
    expect(survivalBundleSatisfiesUtility(bundle)).toBe(false);
    const causes = classifyUtilityEvidenceAbsence({ bundle });
    expect(causes).toContain("incomplete_utility_datasets");
    expect(causes).toContain("survival_only_bundle");
  });

  it("dual-consumer complete bundle satisfies Utility", () => {
    const bundle = completeUtilityBundle();
    expect(survivalBundleSatisfiesUtility(bundle)).toBe(true);
    const diag = diagnoseUtilityBaselineRun(bundle);
    expect(diag.evidenceComplete).toBe(true);
    expect(diag.absenceCauses).toEqual([]);
  });
});

describe("classifyUtilityBaselineState", () => {
  it("marks PUBLISHABLE when gates and attributable events are met", () => {
    const result = classifyUtilityBaselineState({
      candidateRunCount: 8,
      compatibleEvidenceCount: 6,
      analyzedRunCount: 6,
      attributableEvents: 12,
      observedDomainCount: 2,
      confidence: 55,
      shadowStatus: "SHADOW_SCORED",
    });
    expect(result.state).toBe("PUBLISHABLE");
    expect(result.fallbackAllowed).toBe(false);
    expect(result.publishable).toBe(true);
  });

  it("marks COMPLETE_ZERO_CONTRIBUTION as non-calculable without fallback (Option A)", () => {
    const result = classifyUtilityBaselineState({
      candidateRunCount: 8,
      compatibleEvidenceCount: 5,
      analyzedRunCount: 5,
      attributableEvents: 0,
      observedDomainCount: 0,
      confidence: 30,
      shadowStatus: "SHADOW_SCORED",
    });
    expect(result.state).toBe("COMPLETE_ZERO_CONTRIBUTION");
    expect(result.fallbackAllowed).toBe(false);
    expect(result.completeZeroContribution).toBe(true);
    expect(result.publishable).toBe(false);
    expect(result.absenceCauses).toContain("truly_zero_observed_contribution");
  });

  it("marks INSUFFICIENT_EVIDENCE_RETRYABLE and estimates extra runs", () => {
    const result = classifyUtilityBaselineState({
      candidateRunCount: 8,
      compatibleEvidenceCount: 1,
      analyzedRunCount: 1,
      attributableEvents: 2,
      observedDomainCount: 1,
      confidence: 40,
      dungeonCount: 1,
    });
    expect(result.state).toBe("INSUFFICIENT_EVIDENCE_RETRYABLE");
    expect(result.fallbackAllowed).toBe(true);
    expect(result.estimatedExtraRunsToPublishable).toBeGreaterThanOrEqual(1);
    expect(result.estimatedExtraRunsToPublishable).toBeLessThanOrEqual(4);
  });

  it("maps hard WCL states without fallback", () => {
    expect(
      classifyUtilityBaselineState({
        candidateRunCount: 0,
        compatibleEvidenceCount: 0,
        analyzedRunCount: 0,
        wclDataState: "NO_PUBLIC_LOGS",
      }).state,
    ).toBe("NO_PUBLIC_LOGS");
    expect(
      classifyUtilityBaselineState({
        candidateRunCount: 4,
        compatibleEvidenceCount: 0,
        analyzedRunCount: 0,
        rateBudgetAction: "STOP",
      }).state,
    ).toBe("BUDGET_EXHAUSTED");
    expect(
      classifyUtilityBaselineState({
        candidateRunCount: 4,
        compatibleEvidenceCount: 0,
        analyzedRunCount: 0,
        identityOrMatchFailure: true,
      }).fallbackAllowed,
    ).toBe(false);
  });
});

describe("selectUtilityFallbackRuns", () => {
  const pool = ["ara-kara", "dawnbreaker", "priory", "floodgate"];

  it("does not select when baseline is not retryable", () => {
    const result = selectUtilityFallbackRuns({
      baselineState: "COMPLETE_ZERO_CONTRIBUTION",
      baselineDungeonSlugs: ["ara-kara"],
      activeDungeonPool: pool,
      candidates: [
        {
          dungeonSlug: "dawnbreaker",
          reportCode: "X",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
        },
      ],
    });
    expect(result.selected).toEqual([]);
    expect(result.stoppedReason).toBe("not_retryable");
  });

  it("prefers missing dungeons and caps at 4", () => {
    const candidates = [
      {
        dungeonSlug: "ara-kara",
        reportCode: "A2",
        fightId: 2,
        reportRevision: 1,
        hasPublicReport: true,
        alreadyInBaseline: false,
        scoreValue: 300,
      },
      {
        dungeonSlug: "dawnbreaker",
        reportCode: "D1",
        fightId: 1,
        reportRevision: 1,
        hasPublicReport: true,
        alreadyInBaseline: false,
        scoreValue: 200,
        predictedUtilityEvidenceComplete: true,
      },
      {
        dungeonSlug: "priory",
        reportCode: "P1",
        fightId: 1,
        reportRevision: 1,
        hasPublicReport: true,
        alreadyInBaseline: false,
        scoreValue: 250,
      },
      {
        dungeonSlug: "floodgate",
        reportCode: "F1",
        fightId: 1,
        reportRevision: 1,
        hasPublicReport: true,
        alreadyInBaseline: false,
        scoreValue: 180,
      },
      {
        dungeonSlug: "dawnbreaker",
        reportCode: "D2",
        fightId: 2,
        reportRevision: 1,
        hasPublicReport: true,
        alreadyInBaseline: false,
        scoreValue: 190,
      },
    ];
    const result = selectUtilityFallbackRuns({
      baselineState: "INSUFFICIENT_EVIDENCE_RETRYABLE",
      baselineDungeonSlugs: ["ara-kara"],
      activeDungeonPool: pool,
      candidates,
      maxExtraRuns: 4,
    });
    expect(result.selected.length).toBeLessThanOrEqual(4);
    expect(result.selected[0]?.dungeonSlug).not.toBe("ara-kara");
    expect(result.selected.map((s) => s.dungeonSlug)).toContain("dawnbreaker");
    // First pass should not duplicate dungeon before filling others.
    const firstThreeDungeons = result.selected.slice(0, 3).map((s) => s.dungeonSlug);
    expect(new Set(firstThreeDungeons).size).toBe(firstThreeDungeons.length);
  });

  it("skips private / already-baseline / out-of-pool", () => {
    const result = selectUtilityFallbackRuns({
      baselineState: "INSUFFICIENT_EVIDENCE_RETRYABLE",
      baselineDungeonSlugs: [],
      activeDungeonPool: ["ara-kara"],
      candidates: [
        {
          dungeonSlug: "ara-kara",
          reportCode: "PRIV",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: false,
          alreadyInBaseline: false,
        },
        {
          dungeonSlug: "other",
          reportCode: "O",
          fightId: 1,
          reportRevision: 1,
          hasPublicReport: true,
          alreadyInBaseline: false,
        },
      ],
    });
    expect(result.selected).toEqual([]);
    expect(result.stoppedReason).toBe("no_candidates");
  });
});

describe("request cost table", () => {
  it("documents conservative page cost and Utility-only gap", () => {
    expect(UTILITY_BASELINE_REQUEST_COST_TABLE.rows.length).toBeGreaterThan(5);
    expect(
      UTILITY_BASELINE_REQUEST_COST_TABLE.rows.some((r) =>
        String(r.operation).includes("HostileCasts"),
      ),
    ).toBe(true);
  });
});
