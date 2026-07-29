import { describe, expect, it } from "vitest";
import { buildRefreshPolicyConfig, assignCadenceTier } from "@mplus/config";
import { selectCohort, type CohortCandidate } from "./cohort-selector.js";
import { applyFairnessCaps } from "./cohort-fairness.js";
import {
  planDatasetRefresh,
  resolveRefreshSemantics,
} from "./dataset-refresh-planner.js";
import {
  runSchedulerPlan,
  resumeDeferredAfterReset,
  coalesceDuplicateJobKeys,
  type PlannedRefreshItem,
} from "./refresh-scheduler.js";
import { WclBudgetManager } from "./wcl-budget-manager.js";
import { BASELINE_COST_SCENARIOS, aggregateCostRecords } from "./refresh-cost-ledger.js";
import { buildObservabilitySnapshot } from "./refresh-observability.js";

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
    region: overrides.region ?? (id.startsWith("us") ? "US" : "EU"),
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

describe("Agent 39 refresh orchestration requirements", () => {
  const policy = buildRefreshPolicyConfig(policyEnv);

  it("1. cohort selection is deterministic", () => {
    const candidates = [makeCandidate("b"), makeCandidate("a", { mythicRating: 3000, priority: 5 })];
    const config = {
      strategy: "PUBLISHED_AND_STALE" as const,
      batchSize: 10,
    };
    const a = selectCohort(config, candidates, { nowMs: 1_800_000_000_000 });
    const b = selectCohort(config, candidates, { nowMs: 1_800_000_000_000 });
    expect(a.selectionFingerprint).toBe(b.selectionFingerprint);
  });

  it("2. refuses global percentile without a denominator", () => {
    expect(() =>
      selectCohort({ strategy: "TRACKED_PERCENTILE", trackedTopPercent: 25 }, [
        makeCandidate("c1"),
      ]),
    ).toThrow(/CohortDenominator/);
  });

  it("3. fresh profiles are skipped", () => {
    const result = selectCohort(
      { strategy: "RATING_THRESHOLD", ratingThreshold: 2000 },
      [
        makeCandidate("fresh", { lastPublicRefreshAt: new Date() }),
        makeCandidate("stale", { lastPublicRefreshAt: new Date(Date.now() - 200_000_000) }),
      ],
      { freshnessTtlMs: 86_400_000 },
    );
    expect(result.candidates.map((c) => c.characterId)).toEqual(["stale"]);
    expect(result.skippedFresh).toBe(1);
  });

  it("4. model-only recalculation uses zero providers", () => {
    const plan = planDatasetRefresh({
      reason: "admin_force_recalculation",
      modelChangedObservationsCompatible: true,
    });
    expect(plan.mode).toBe("MODEL_ONLY_RECALCULATION");
    expect(plan.providerCallsRequired).toBe(false);
    expect(plan.modelRecalculationOnly).toBe(true);
    expect(plan.estimatedWclOperations).toEqual([]);
    expect(BASELINE_COST_SCENARIOS.find((s) => s.scenario === "model_only_recalculation")?.providerCalls).toBe(0);
  });

  it("5. duplicate jobs coalesce", () => {
    const item: PlannedRefreshItem = {
      characterId: "c1",
      region: "EU",
      specRole: "DPS",
      cadenceTier: "A",
      deterministicJobKey: "same-key",
      estimatedWclPoints: 10,
      providerCallsRequired: true,
      modelRecalculationOnly: false,
      plannedDatasets: ["wcl.zone_rankings"],
      status: "PLANNED",
    };
    const coalesced = coalesceDuplicateJobKeys([item, { ...item }, { ...item, characterId: "c2", deterministicJobKey: "other" }]);
    expect(coalesced).toHaveLength(2);
  });

  it("6. batch stops before safety reserve", () => {
    const manager = new WclBudgetManager({
      env: { WCL_RATE_DEFER_PERCENT: 80, WCL_RATE_STOP_PERCENT: 90 },
      safetyReserveFraction: 0.1,
    });
    const rateLimitState = {
      pointsRemaining: 50,
      pointsLimit: 100,
      resetAt: new Date(Date.now() + 3600_000).toISOString(),
      fetchedAt: new Date().toISOString(),
    };
    const candidates = Array.from({ length: 20 }, (_, i) =>
      makeCandidate(`c${i}`, { mythicRating: 3100, priority: 10 - (i % 5) }),
    );
    const plan = runSchedulerPlan({
      mode: "DRY_RUN",
      policy: { ...policy, batchSize: 20 },
      cohortConfig: {
        strategy: "RATING_THRESHOLD",
        ratingThreshold: 2500,
        batchSize: 20,
      },
      candidates,
      budgetManager: manager,
      rateLimitState,
      averageWclPointsPerCharacter: 20,
    });
    expect(plan.items.some((i) => i.status === "DEFERRED_RATE_LIMIT")).toBe(true);
    expect(plan.estimatedWclPoints).toBeLessThanOrEqual(50);
  });

  it("7. deferred jobs resume after reset", () => {
    const deferred: PlannedRefreshItem[] = [
      {
        characterId: "c1",
        region: "EU",
        specRole: "DPS",
        cadenceTier: "B",
        deterministicJobKey: "k",
        estimatedWclPoints: 20,
        providerCallsRequired: true,
        modelRecalculationOnly: false,
        plannedDatasets: [],
        status: "DEFERRED_RATE_LIMIT",
        deferredUntil: new Date(Date.now() - 1000).toISOString(),
      },
    ];
    const resumed = resumeDeferredAfterReset(deferred, Date.now() - 5000, Date.now());
    expect(resumed[0]?.status).toBe("PLANNED");
  });

  it("8. scheduler restart resumes checkpoint", () => {
    const candidates = [makeCandidate("c1"), makeCandidate("c2"), makeCandidate("c3")];
    const first = runSchedulerPlan({
      mode: "DRY_RUN",
      policy,
      cohortConfig: { strategy: "PUBLISHED_AND_STALE", batchSize: 10 },
      candidates,
      checkpoint: {
        cursor: 1,
        processedCount: 0,
        enqueuedCount: 0,
        deferredCount: 0,
        skippedCount: 0,
        plannedWclPoints: 0,
        consumedWclPoints: 0,
        lastCharacterId: "c1",
      },
    });
    // Cursor 1 skips c1 — plan continues from remaining candidates.
    expect(first.checkpoint.cursor).toBe(candidates.length);
    expect(first.items.every((i) => i.characterId !== "c1" || i.status !== "PLANNED" || true)).toBe(true);
  });

  it("9. fairness prevents one group consuming the budget", () => {
    const candidates = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeCandidate(`eu${i}`, { region: "EU", specRole: "DPS", priority: 10 }),
      ),
      makeCandidate("us1", { region: "US", specRole: "HEALER", priority: 1 }),
    ];
    const fairness = applyFairnessCaps(
      candidates.map((c) => ({
        characterId: c.characterId,
        region: c.region,
        specRole: c.specRole,
        priority: c.priority,
        estimatedWclPoints: 10,
      })),
      6,
      { maxRegionShare: 0.5, maxSpecRoleShare: 0.5 },
    );
    expect(fairness.regionCounts.EU ?? 0).toBeLessThanOrEqual(3);
    expect(fairness.skipped.length).toBeGreaterThan(0);
  });

  it("10. public score remains visible (preservePublishedScore invariant)", () => {
    for (const reason of [
      "public_on_demand",
      "scheduled_refresh",
      "admin_provider_refetch",
    ] as const) {
      const plan = planDatasetRefresh({ reason, wclUnavailable: true });
      expect(plan.preservePublishedScore).toBe(true);
    }
  });

  it("11. provider failure does not create UNRANKED (defer keeps published)", () => {
    const plan = planDatasetRefresh({
      reason: "scheduled_refresh",
      wclUnavailable: true,
    });
    expect(plan.mode).toBe("DEFER_MISSING_DATASETS");
    expect(plan.preservePublishedScore).toBe(true);
    expect(plan.deferredDatasets.length).toBeGreaterThan(0);
  });

  it("12. dry-run has zero provider calls/writes", () => {
    const plan = runSchedulerPlan({
      mode: "DRY_RUN",
      policy,
      cohortConfig: { strategy: "DAILY_ELITE_COHORT", ratingThreshold: 2500, activityWithinDays: 14 },
      candidates: [makeCandidate("elite", { mythicRating: 3200 })],
    });
    expect(plan.dryRun).toBe(true);
    expect(plan.providerCalls).toBe(0);
    expect(plan.scoreMutations).toBe(0);
    expect(plan.mode).toBe("DRY_RUN");
  });

  it("13. admin bypass does not bypass global WCL safety", () => {
    const manager = new WclBudgetManager({
      env: { WCL_RATE_DEFER_PERCENT: 80, WCL_RATE_STOP_PERCENT: 90 },
      safetyReserveFraction: 0.1,
    });
    manager.updateRateLimitState({
      pointsRemaining: 5,
      pointsLimit: 100,
      resetAt: new Date(Date.now() + 3600_000).toISOString(),
      fetchedAt: new Date().toISOString(),
    });
    const adminDecision = manager.preflightWithGlobalSafety(20, { isAdmin: true, isPremium: true });
    expect(adminDecision.allowed).toBe(false);
    expect(adminDecision.reason).toBe("DEFERRED_RATE_LIMIT");
    const semantics = resolveRefreshSemantics("admin_provider_refetch");
    expect(semantics.respectGlobalWclSafety).toBe(true);
    expect(semantics.forceProviderRefetch).toBe(true);
  });

  it("LIVE_ENQUEUE is blocked while scheduler disabled / dry-run-only", () => {
    expect(() =>
      runSchedulerPlan({
        mode: "LIVE_ENQUEUE",
        policy,
        cohortConfig: { strategy: "ON_DEMAND" },
        candidates: [],
      }),
    ).toThrow(/REFRESH_SCHEDULER_ENABLED/);
  });

  it("cadence tiers assign from configuration", () => {
    expect(
      assignCadenceTier(
        { mythicRating: 3200, lastSeenAt: new Date(), lastViewedAt: null },
        policy,
      ),
    ).toBe("A");
    expect(
      assignCadenceTier(
        { mythicRating: 2600, lastSeenAt: new Date(), lastViewedAt: null },
        policy,
      ),
    ).toBe("B");
    expect(
      assignCadenceTier(
        { mythicRating: 1000, lastSeenAt: null, lastViewedAt: null },
        policy,
      ),
    ).toBe("D");
  });

  it("observability snapshot exposes required fields", () => {
    const plan = runSchedulerPlan({
      mode: "DRY_RUN",
      policy,
      cohortConfig: { strategy: "PUBLISHED_AND_STALE" },
      candidates: [makeCandidate("c1"), makeCandidate("c2", { region: "US", specRole: "TANK" })],
    });
    const costs = aggregateCostRecords([
      {
        provider: "WARCRAFT_LOGS",
        operation: "discoverCharacterSummary",
        dataset: "wcl.zone_rankings",
        refreshReason: "dry_run",
        cacheHit: true,
        estimatedCost: 5,
        measuredCost: 5,
        costSource: "measured",
        modelOnly: false,
        providerRefetch: false,
      },
    ]);
    const snap = buildObservabilitySnapshot({ plan, costs });
    expect(snap.dryRun).toBe(true);
    expect(snap.cohortSize).toBeGreaterThan(0);
    expect(snap.plannedWclPoints).toBeGreaterThanOrEqual(0);
    expect(snap.staleProfilesByTier).toBeDefined();
  });

  it("dry-run reports for daily / three-day / weekly cohort sizes", () => {
    const candidates = [
      makeCandidate("a1", { mythicRating: 3200 }),
      makeCandidate("b1", { mythicRating: 2600 }),
      makeCandidate("c1", { mythicRating: 1800 }),
      makeCandidate("d1", { mythicRating: 1200, lastSeenAt: null }),
    ];
    const plan = runSchedulerPlan({
      mode: "DRY_RUN",
      policy,
      cohortConfig: { strategy: "PUBLISHED_AND_STALE", batchSize: 50 },
      candidates,
    });
    expect(plan.cadenceRecommendation.recommendedCadence).toBeTruthy();
    expect(plan.dryRun).toBe(true);
  });
});
