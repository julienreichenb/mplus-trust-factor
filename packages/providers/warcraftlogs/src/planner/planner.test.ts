/**
 * Pure planner tests — no provider execution.
 */
import { describe, expect, it } from "vitest";
import {
  buildDiscoveryPlan,
  buildPlannerCompatibilityKey,
  estimateDatasetCost,
  estimatePaginationCost,
  groupCandidatesByReportCode,
  planCandidateDiscovery,
  planDetailedEvidence,
  previewRateBudgetForPlan,
  sumEvidenceCostEstimates,
  toCandidateMetadataV2,
  unionDatasetsForConsumers,
  V2_MAX_CANDIDATES_PER_DUNGEON,
  discoveryIdentityKey,
  type DiscoverySourceRow,
} from "./index.js";
import {
  FIXTURE_ACTIVE_DUNGEONS,
  fixtureDiscoveryRows,
  fixtureFrozenSlots,
} from "./fixtures/planner-fixtures.js";

describe("discovery identity", () => {
  it("uses reportCode+fightId only at discovery", () => {
    expect(discoveryIdentityKey({ reportCode: "R1", fightId: 3 })).toBe("R1:3");
  });
});

describe("buildDiscoveryPlan", () => {
  it("is deterministic regardless of input order", () => {
    const src = fixtureDiscoveryRows();
    const a = buildDiscoveryPlan({
      ...src,
      activeDungeonSlugs: FIXTURE_ACTIVE_DUNGEONS,
    });
    const b = buildDiscoveryPlan({
      zoneRankingCandidates: [...src.zoneRankingCandidates].reverse(),
      parseRows: [...src.parseRows].reverse(),
      recentReportCandidates: [...src.recentReportCandidates].reverse(),
      persistedWclSources: [...src.persistedWclSources].reverse(),
      activeDungeonSlugs: FIXTURE_ACTIVE_DUNGEONS,
    });
    expect(a.candidates.map((c) => discoveryIdentityKey(c.discoveryIdentity))).toEqual(
      b.candidates.map((c) => discoveryIdentityKey(c.discoveryIdentity)),
    );
  });

  it("merges duplicate report/fight and prefers richer revision/actor", () => {
    const plan = planCandidateDiscovery({
      ...fixtureDiscoveryRows(),
      activeDungeonSlugs: FIXTURE_ACTIVE_DUNGEONS,
    });
    const abc = plan.candidates.find(
      (c) => c.discoveryIdentity.reportCode === "AbcDefGh" && c.discoveryIdentity.fightId === 1,
    );
    expect(abc).toBeDefined();
    // persisted_wcl duplicate carried revision+actor — wins merge for factual richness.
    expect(abc!.source).toBe("persisted_wcl");
    expect(abc!.reportRevision).toBe(2);
    expect(abc!.factual.actorId).toBe(7);
    expect(plan.totals.privateOrHiddenSkipped).toBe(1);
    expect(
      plan.candidates.some((c) => c.discoveryIdentity.reportCode === "Private01"),
    ).toBe(false);
  });

  it("exposes fallback depth without selecting slots", () => {
    const rows: DiscoverySourceRow[] = Array.from({ length: 6 }, (_, i) => ({
      reportCode: `R${i}`,
      fightId: i,
      dungeonSlug: "algethar-academy",
      keyLevel: 10 + i,
      timed: true,
      runScore: 2000,
      completedAt: "2026-07-01T00:00:00.000Z",
      fightDurationMs: 1_000_000,
      actorId: 1,
      reportRevision: 1,
      source: "zone_rankings" as const,
      visibility: "public" as const,
    }));
    const plan = buildDiscoveryPlan({
      zoneRankingCandidates: rows,
      activeDungeonSlugs: ["algethar-academy"],
    });
    expect(plan.perDungeon[0]!.retainedCount).toBe(6);
    expect(plan.perDungeon[0]!.fallbackDepth).toBe(4);
    // No selected slots field — discovery only.
    expect("selectedSlots" in plan).toBe(false);
  });

  it("bounds per dungeon and total", () => {
    const rows: DiscoverySourceRow[] = [];
    for (const dungeon of FIXTURE_ACTIVE_DUNGEONS) {
      for (let i = 0; i < V2_MAX_CANDIDATES_PER_DUNGEON + 3; i++) {
        rows.push({
          reportCode: `${dungeon}-${i}`,
          fightId: i,
          dungeonSlug: dungeon,
          keyLevel: 10,
          timed: true,
          runScore: null,
          completedAt: null,
          fightDurationMs: 1_000_000,
          actorId: null,
          reportRevision: null,
          source: "zone_rankings",
          visibility: "public",
        });
      }
    }
    const plan = buildDiscoveryPlan({
      zoneRankingCandidates: rows,
      activeDungeonSlugs: FIXTURE_ACTIVE_DUNGEONS,
      bounds: { maxPerDungeon: 10, maxTotal: 25 },
    });
    expect(plan.candidates.length).toBeLessThanOrEqual(25);
    for (const d of plan.perDungeon) {
      expect(d.retainedCount).toBeLessThanOrEqual(10);
    }
    expect(plan.totals.truncatedTotal).toBe(true);
  });

  it("groups candidates by report code with batched fight IDs", () => {
    const plan = planCandidateDiscovery({
      ...fixtureDiscoveryRows(),
      activeDungeonSlugs: FIXTURE_ACTIVE_DUNGEONS,
    });
    const groups = groupCandidatesByReportCode(plan.candidates);
    const abc = groups.find((g) => g.reportCode === "AbcDefGh");
    expect(abc?.fightIds).toEqual([1, 2]);
    expect(groups.map((g) => g.reportCode)).toEqual(
      [...groups.map((g) => g.reportCode)].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe("toCandidateMetadataV2", () => {
  it("maps factual metadata and keeps parse out of ordering fields", () => {
    const plan = planCandidateDiscovery({
      ...fixtureDiscoveryRows(),
      activeDungeonSlugs: FIXTURE_ACTIVE_DUNGEONS,
    });
    const parseCandidate = plan.candidates.find(
      (c) => c.discoveryIdentity.reportCode === "ParseRow1",
    )!;
    const meta = toCandidateMetadataV2(parseCandidate, {
      reportRevision: 1,
      identityResolution: "RESOLVED",
      accessState: "PUBLIC",
    });
    expect(meta.discoveryIdentity).toEqual({ reportCode: "ParseRow1", fightId: 9 });
    expect(meta.reportRevision).toBe(1);
    expect(meta.diagnosticsOnly?.parsePercentile).toBe(88);
    expect(meta.evidenceCompleteness).toBeGreaterThan(0);
  });
});

describe("dataset union and compatibility keys", () => {
  it("unions datasets across Performance/Survival/Utility without duplicates", () => {
    const union = unionDatasetsForConsumers(["PERFORMANCE", "SURVIVAL", "UTILITY"]);
    expect(union.filter((d) => d === "MASTER_DATA").length).toBe(1);
    expect(union.filter((d) => d === "CASTS").length).toBe(1);
    expect(union).toContain("RANKING_PARSE");
    expect(union).toContain("HOSTILE_CASTS");
    expect(union).toContain("DISPELS");
  });

  it("builds deterministic compatibility keys including hostility and resources", () => {
    const a = buildPlannerCompatibilityKey({
      reportCode: "R1",
      reportRevision: 3,
      fightId: 12,
      actorId: 5,
      dataset: "HOSTILE_CASTS",
      startTime: 0,
      endTime: 1000,
      filterExpression: "hostile",
      hostilityType: 1,
      includeResources: false,
      providerContractVersion: "wcl-graphql-v2-events",
    });
    const b = buildPlannerCompatibilityKey({
      reportCode: "R1",
      reportRevision: 3,
      fightId: 12,
      actorId: 5,
      dataset: "HOSTILE_CASTS",
      startTime: 0,
      endTime: 1000,
      filterExpression: "hostile",
      hostilityType: 1,
      includeResources: false,
      providerContractVersion: "wcl-graphql-v2-events",
    });
    expect(a).toBe(b);
    const differentHostility = buildPlannerCompatibilityKey({
      reportCode: "R1",
      reportRevision: 3,
      fightId: 12,
      actorId: 5,
      dataset: "HOSTILE_CASTS",
      startTime: 0,
      endTime: 1000,
      filterExpression: "hostile",
      hostilityType: 0,
      includeResources: false,
      providerContractVersion: "wcl-graphql-v2-events",
    });
    expect(differentHostility).not.toBe(a);
  });

  it("plans batched metadata-friendly multi-fight same report without duplicate keys", () => {
    const { datasetCostPlan } = planDetailedEvidence({
      frozenSlots: fixtureFrozenSlots(),
      planContentHash: "hash-1",
      characterId: "char-1",
      seasonId: "season-1",
      plannedAt: "2026-08-01T12:00:00.000Z",
      dataset: {
        enabledConsumers: ["SURVIVAL", "UTILITY"],
      },
    });
    const keys = datasetCostPlan.entries.map((e) => e.compatibilityKey);
    expect(new Set(keys).size).toBe(keys.length);
    const masterForReport = datasetCostPlan.entries.filter(
      (e) => e.reportCode === "AbcDefGh" && e.dataset === "MASTER_DATA",
    );
    // One master-data entry per fight (fight-scoped key); no consumer duplication.
    expect(masterForReport.length).toBe(2);
    expect(masterForReport.every((e) => e.consumers.includes("SURVIVAL"))).toBe(true);
    expect(masterForReport.every((e) => e.consumers.includes("UTILITY"))).toBe(true);
  });
});

describe("cost plan", () => {
  it("removes cost on cache hits", () => {
    const slots = fixtureFrozenSlots().slice(0, 1);
    const preview = planDetailedEvidence({
      frozenSlots: slots,
      planContentHash: "h",
      characterId: "c",
      seasonId: "s",
      plannedAt: "2026-08-01T12:00:00.000Z",
      dataset: { enabledConsumers: ["SURVIVAL"] },
    });
    const cacheKeys = new Set(preview.datasetCostPlan.entries.map((e) => e.compatibilityKey));
    const withHits = planDetailedEvidence({
      frozenSlots: slots,
      planContentHash: "h",
      characterId: "c",
      seasonId: "s",
      plannedAt: "2026-08-01T12:00:00.000Z",
      dataset: {
        enabledConsumers: ["SURVIVAL"],
        cacheHitKeys: cacheKeys,
      },
    });
    expect(withHits.cost.cacheHitCount).toBe(withHits.datasetCostPlan.entries.length);
    expect(withHits.cost.totalEstimatedCost).toEqual({ kind: "ZERO_CACHE_HIT" });
    expect(
      withHits.datasetCostPlan.entries.every((e) => e.estimatedCost.kind === "ZERO_CACHE_HIT"),
    ).toBe(true);
  });

  it("keeps unknown distinct from zero", () => {
    expect(estimateDatasetCost("CASTS", Number.NaN)).toEqual({ kind: "UNKNOWN" });
    expect(sumEvidenceCostEstimates([{ kind: "KNOWN", points: 2 }, { kind: "UNKNOWN" }])).toEqual({
      kind: "UNKNOWN",
    });
    expect(sumEvidenceCostEstimates([{ kind: "ZERO_CACHE_HIT" }, { kind: "ZERO_CACHE_HIT" }])).toEqual({
      kind: "ZERO_CACHE_HIT",
    });
    // Zero known points is KNOWN 0 — not UNKNOWN.
    expect(sumEvidenceCostEstimates([{ kind: "KNOWN", points: 0 }])).toEqual({
      kind: "KNOWN",
      points: 0,
    });
  });

  it("estimates pagination by page count", () => {
    expect(estimatePaginationCost("DEATHS", 5)).toEqual({ kind: "KNOWN", points: 5 });
    expect(estimatePaginationCost("MASTER_DATA", 2)).toEqual({ kind: "KNOWN", points: 2 });
  });

  it("emits total and safety margin on dataset cost plan", () => {
    const { datasetCostPlan, cost } = planDetailedEvidence({
      frozenSlots: fixtureFrozenSlots().slice(0, 1),
      planContentHash: "hash",
      characterId: "c1",
      seasonId: "s1",
      plannedAt: "2026-08-01T12:00:00.000Z",
      dataset: { enabledConsumers: ["PERFORMANCE", "SURVIVAL", "UTILITY"] },
      safetyMarginPoints: 7,
    });
    expect(datasetCostPlan.schemaVersion).toBe("wcl-dataset-cost-plan-v2");
    expect(datasetCostPlan.safetyMargin).toEqual({ kind: "KNOWN", points: 7 });
    expect(cost.totalWithSafetyMargin.kind).toBe("KNOWN");
    if (cost.totalEstimatedCost.kind === "KNOWN" && cost.totalWithSafetyMargin.kind === "KNOWN") {
      expect(cost.totalWithSafetyMargin.points).toBe(cost.totalEstimatedCost.points + 7);
    }
  });

  it("previews rate budget without enabling admission", () => {
    const preview = previewRateBudgetForPlan(
      {
        limitPerHour: 3600,
        pointsSpentThisHour: 100,
        pointsRemaining: 3500,
        resetAt: null,
        fetchedAt: "2026-08-01T12:00:00.000Z",
      },
      { kind: "KNOWN", points: 40 },
      { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      { kind: "KNOWN", points: 5 },
    );
    expect(preview.note).toBe("preview_only_no_admission");
    expect(preview.remainingAfterPlan).toBe(3455);
    expect(preview.decision.action).toBe("OK");
  });
});

describe("planner does not execute providers", () => {
  it("has no client or fetch side effects in planDetailedEvidence", () => {
    const before = process.env.ALLOW_LIVE_PROVIDER_CALLS;
    process.env.ALLOW_LIVE_PROVIDER_CALLS = "false";
    try {
      const result = planDetailedEvidence({
        frozenSlots: fixtureFrozenSlots(),
        planContentHash: "m",
        characterId: "c",
        seasonId: "s",
        plannedAt: "2026-08-01T12:00:00.000Z",
        dataset: { enabledConsumers: ["UTILITY"] },
      });
      expect(result.datasetCostPlan.entries.length).toBeGreaterThan(0);
      // WS03 must not emit WS02 EvidenceAcquisitionPlanV2 / manifest finalization.
      expect(result).not.toHaveProperty("acquisitionPlan");
      expect(result).not.toHaveProperty("manifest");
      expect(result).not.toHaveProperty("selectedSlots");
    } finally {
      if (before === undefined) delete process.env.ALLOW_LIVE_PROVIDER_CALLS;
      else process.env.ALLOW_LIVE_PROVIDER_CALLS = before;
    }
  });
});
