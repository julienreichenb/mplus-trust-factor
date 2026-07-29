import { describe, expect, it } from "vitest";
import {
  InMemorySharedEvidenceStore,
  ingestSharedEvidenceBundle,
  countDetailedWclEventCalls,
  survivalDatasetsFromEvidenceBundle,
  sharedEvidenceBundleHasSurvivalDatasets,
  buildEmptyBundle,
  attachDatasetToBundle,
} from "@mplus/provider-warcraftlogs";
import { buildRefreshPolicyConfig } from "@mplus/config";
import {
  selectCohort,
  type CohortCandidate,
} from "./cohort-selector.js";
import {
  runSchedulerPlan,
  type PlannedRefreshItem,
} from "./refresh-scheduler.js";
import { WclBudgetManager } from "./wcl-budget-manager.js";
import {
  estimateScenariosFromLedger,
  assertUnknownCostNotZero as assertLedgerUnknown,
  type RefreshCostRecord,
} from "./refresh-cost-ledger.js";
import {
  RefreshCostAccumulator,
  buildSharedEvidenceCostRecords,
} from "./refresh-cost-recorder.js";
import { planDatasetRefresh } from "./dataset-refresh-planner.js";

const policyEnv = {
  REFRESH_SCHEDULER_ENABLED: false,
  REFRESH_DRY_RUN_ONLY: true,
  REFRESH_SAFETY_RESERVE_FRACTION: 0.1,
  REFRESH_BATCH_SIZE: 10,
  REFRESH_GLOBAL_CONCURRENCY: 2,
  REFRESH_PER_CHARACTER_COOLDOWN_SECONDS: 3600,
  REFRESH_SPREAD_HOURS: 24,
  REFRESH_TRACKED_TOP_PERCENT: 25,
  REFRESH_RATING_THRESHOLD: 2500,
} as const;

function makeCandidate(
  id: string,
  overrides: Partial<CohortCandidate> = {},
): CohortCandidate {
  return {
    characterId: id,
    region: overrides.region ?? "EU",
    realmSlug: "realm",
    name: id,
    mythicRating: 2800,
    lastPublicRefreshAt: new Date(Date.now() - 10 * 86_400_000),
    lastSeenAt: new Date(),
    lastViewedAt: null,
    hasPublishedScore: true,
    specRole: "DPS",
    priority: 1,
    ...overrides,
  };
}

describe("production readiness — shared evidence + ledger + views + dry-run", () => {
  const policy = buildRefreshPolicyConfig(policyEnv);

  it("shared evidence ingest reuses persisted datasets with zero detailed WCL calls", async () => {
    const store = new InMemorySharedEvidenceStore();
    let fetchCalls = 0;
    const client = {
      requestPermissive: async () => {
        fetchCalls += 1;
        store.bumpFetch();
        return {
          response: {
            data: {
              reportData: {
                report: {
                  events: {
                    data: [{ timestamp: 1, type: "cast", sourceID: 1, abilityGameID: 1 }],
                    nextPageTimestamp: null,
                  },
                },
              },
            },
          },
          costUnits: 2,
          durationMs: 1,
        };
      },
    };

    const input = {
      client: client as never,
      store,
      reportCode: "ABC",
      reportRevision: 1,
      fightId: 10,
      playerActorId: 5,
      ownedPetActorIds: [] as number[],
      dungeonSlug: "gate",
      startTime: 0,
      endTime: 1000,
      consumers: ["survival", "utility"] as Array<"survival" | "utility">,
    };

    const first = await ingestSharedEvidenceBundle(input);
    const firstCalls = countDetailedWclEventCalls(first);
    expect(firstCalls).toBeGreaterThan(0);
    expect(fetchCalls).toBe(firstCalls);

    const second = await ingestSharedEvidenceBundle({ ...input, forceRefetch: false });
    expect(countDetailedWclEventCalls(second)).toBe(0);
    expect(second.accounting.providerCalls).toBe(0);
    expect(fetchCalls).toBe(firstCalls);
    expect(sharedEvidenceBundleHasSurvivalDatasets(second)).toBe(true);
  });

  it("survival datasets adapt from shared evidence bundle", () => {
    let bundle = buildEmptyBundle({
      reportCode: "R",
      reportRevision: 1,
      fightId: 1,
      playerActorId: 2,
      ownedPetActorIds: [],
      dungeonSlug: "d",
      startTime: 0,
      endTime: 1,
      consumers: ["survival"],
    });
    for (const key of [
      "Casts",
      "Deaths",
      "DamageTaken",
      "Buffs",
      "Debuffs",
      "Healing",
      "CombatantInfo",
    ] as const) {
      bundle = attachDatasetToBundle(bundle, {
        key,
        state: "PERSISTED",
        truncated: false,
        pageCount: 1,
        eventCount: 1,
        filterSourceId: 2,
        filterExpression: "+resources",
        pages: [],
        events: [{ timestamp: 1 }],
        consumers: ["survival"],
        pointsConsumed: 0,
        costSource: "measured",
        requestCostUnits: [],
        wclRequests: 0,
        fetchedAt: new Date().toISOString(),
        source: "persisted",
      });
    }
    const datasets = survivalDatasetsFromEvidenceBundle(bundle);
    expect(datasets.Casts.state).toBe("OK");
    expect(datasets.DamageTaken.events).toHaveLength(1);
  });

  it("RECENTLY_VIEWED selection works from aggregated lastViewedAt", () => {
    const candidates = [
      makeCandidate("hot", { lastViewedAt: new Date(), priority: 5 }),
      makeCandidate("cold", { lastViewedAt: null }),
      makeCandidate("old", {
        lastViewedAt: new Date(Date.now() - 30 * 86_400_000),
      }),
    ];
    const result = selectCohort(
      { strategy: "RECENTLY_VIEWED", viewedWithinDays: 7, batchSize: 10 },
      candidates,
      { freshnessTtlMs: 86_400_000 },
    );
    expect(result.candidates.map((c) => c.characterId)).toEqual(["hot"]);
  });

  it("ledger records preserve unknown cost as null (never zero)", () => {
    expect(() => assertLedgerUnknown("unknown", 0)).toThrow(/never become zero/);
    expect(assertLedgerUnknown("unknown", null)).toBeNull();

    const acc = new RefreshCostAccumulator();
    acc.add({
      provider: "WARCRAFT_LOGS",
      operation: "sharedEvidenceBundle",
      dataset: "wcl.combat_events",
      refreshReason: "scheduled_refresh",
      cacheHit: false,
      estimatedCost: null,
      measuredCost: 0,
      costSource: "unknown",
      modelOnly: false,
      providerRefetch: true,
    });
    expect(acc.records[0]?.measuredCost).toBeNull();
  });

  it("ledger cost records built from shared evidence accounting", () => {
    const records = buildSharedEvidenceCostRecords({
      characterId: "c1",
      jobId: "j1",
      runId: "r1",
      refreshReason: "scheduled_refresh",
      reportCode: "ABC",
      fightId: 1,
      providerCalls: 0,
      pages: 4,
      pointsConsumed: null,
      estimatedPointsConsumed: 12,
      costSource: "unknown",
      cacheHits: 0,
      persistedHits: 4,
    });
    expect(records[0]?.costSource).toBe("unknown");
    expect(records[0]?.measuredCost).toBeNull();
    expect(records[0]?.cacheHit).toBe(true);
  });

  it("planner switches from fallback to measured estimates", () => {
    const samples: RefreshCostRecord[] = Array.from({ length: 5 }, (_, i) => ({
      provider: "WARCRAFT_LOGS" as const,
      operation: "sharedEvidenceBundle",
      dataset: "wcl.combat_events",
      refreshReason: "scheduled_refresh",
      cacheHit: true,
      estimatedCost: 40,
      measuredCost: 20 + i,
      costSource: "measured" as const,
      modelOnly: false,
      providerRefetch: false,
    }));
    const estimates = estimateScenariosFromLedger(samples, 5);
    const warm = estimates.find((e) => e.scenario === "warm_refresh")!;
    expect(warm.source).toBe("measured");
    expect(warm.wclPoints).toBeCloseTo(22, 0);

    const insufficient = estimateScenariosFromLedger(samples.slice(0, 2), 5);
    expect(insufficient.find((e) => e.scenario === "warm_refresh")?.source).toBe("fallback");
  });

  it("dry-run Tier A/B/C capacity report with safety gates", () => {
    expect(policy.schedulerEnabled).toBe(false);
    expect(policy.dryRunOnly).toBe(true);

    const candidates = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeCandidate(`a${i}`, { mythicRating: 3200, priority: 10, region: i % 2 ? "US" : "EU" }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        makeCandidate(`b${i}`, { mythicRating: 2600, priority: 5 }),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        makeCandidate(`c${i}`, { mythicRating: 1800, priority: 2, specRole: i % 2 ? "HEALER" : "DPS" }),
      ),
    ];

    const daily = runSchedulerPlan({
      mode: "DRY_RUN",
      policy: { ...policy, batchSize: 20 },
      cohortConfig: {
        strategy: "DAILY_ELITE_COHORT",
        ratingThreshold: 3000,
        activityWithinDays: 7,
        batchSize: 20,
      },
      candidates,
    });
    const threeDay = runSchedulerPlan({
      mode: "DRY_RUN",
      policy: { ...policy, batchSize: 20 },
      cohortConfig: {
        strategy: "RATING_THRESHOLD",
        ratingThreshold: 2500,
        batchSize: 20,
      },
      candidates,
    });
    const weekly = runSchedulerPlan({
      mode: "DRY_RUN",
      policy: { ...policy, batchSize: 30 },
      cohortConfig: { strategy: "PUBLISHED_AND_STALE", batchSize: 30 },
      candidates,
    });

    expect(daily.dryRun).toBe(true);
    expect(daily.providerCalls).toBe(0);
    expect(daily.scoreMutations).toBe(0);
    expect(threeDay.dryRun).toBe(true);
    expect(weekly.dryRun).toBe(true);

    const report = {
      daily: {
        cohortSize: daily.items.length,
        planned: daily.items.filter((i) => i.status === "PLANNED").length,
        skipped: daily.items.filter((i) => i.status.startsWith("SKIPPED_")).length,
        deferred: daily.items.filter((i) => i.status === "DEFERRED_RATE_LIMIT").length,
        estimatedWclPoints: daily.estimatedWclPoints,
        regions: daily.regionDistribution,
        cadence: daily.cadenceRecommendation,
      },
      threeDay: {
        cohortSize: threeDay.items.length,
        planned: threeDay.items.filter((i) => i.status === "PLANNED").length,
        estimatedWclPoints: threeDay.estimatedWclPoints,
      },
      weekly: {
        cohortSize: weekly.items.length,
        planned: weekly.items.filter((i) => i.status === "PLANNED").length,
        estimatedWclPoints: weekly.estimatedWclPoints,
        fairness: weekly.specDistribution,
      },
    };
    expect(report.daily.planned).toBeGreaterThanOrEqual(0);
    expect(report.weekly.estimatedWclPoints).toBeGreaterThanOrEqual(0);
  });

  it("simulated low-quota batch defers and preserves published score contract", () => {
    const manager = new WclBudgetManager({
      env: { WCL_RATE_DEFER_PERCENT: 80, WCL_RATE_STOP_PERCENT: 90 },
      safetyReserveFraction: 0.1,
    });
    const plan = runSchedulerPlan({
      mode: "DRY_RUN",
      policy: { ...policy, batchSize: 10 },
      cohortConfig: { strategy: "PUBLISHED_AND_STALE", batchSize: 10 },
      candidates: Array.from({ length: 10 }, (_, i) => makeCandidate(`q${i}`, { mythicRating: 3000 })),
      budgetManager: manager,
      rateLimitState: {
        pointsRemaining: 15,
        pointsLimit: 100,
        resetAt: new Date(Date.now() + 3600_000).toISOString(),
        fetchedAt: new Date().toISOString(),
      },
      averageWclPointsPerCharacter: 20,
    });
    expect(plan.items.some((i: PlannedRefreshItem) => i.status === "DEFERRED_RATE_LIMIT")).toBe(
      true,
    );
    const deferPlan = planDatasetRefresh({
      reason: "scheduled_refresh",
      wclUnavailable: true,
    });
    expect(deferPlan.preservePublishedScore).toBe(true);
  });

  it("LIVE_ENQUEUE remains blocked while safety gates are on", () => {
    expect(() =>
      runSchedulerPlan({
        mode: "LIVE_ENQUEUE",
        policy,
        cohortConfig: { strategy: "ON_DEMAND" },
        candidates: [],
      }),
    ).toThrow(/REFRESH_SCHEDULER_ENABLED/);
  });
});
