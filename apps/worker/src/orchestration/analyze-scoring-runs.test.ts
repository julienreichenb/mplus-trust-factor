import { describe, expect, it, vi } from "vitest";
import { MIDNIGHT_S1_SEASON } from "@mplus/mechanics";
import { resolveMaxAnalysisFights, ABSOLUTE_MAX_ANALYSIS_FIGHTS } from "@mplus/provider-warcraftlogs";
import {
  analyzeScoringRuns,
  type ScoringRunAnalysisCandidate,
} from "./analyze-scoring-runs.js";
import type { ProviderFetchContext } from "@mplus/contracts";

const seasonSlug = MIDNIGHT_S1_SEASON.seasonSlug;
const observedAt = "2026-07-28T00:00:00.000Z";

function ctx(): ProviderFetchContext {
  return {
    region: "EU",
    requestId: "test",
    correlationId: null,
    forceRefresh: false,
    now: observedAt,
    targetCharacter: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
  };
}

function emptyCombatFacts(reportCode: string, fightId: number) {
  return {
    reportCode,
    fightId,
    revision: 1,
    targetSourceId: 1,
    actorMap: {
      byId: new Map([[1, { id: 1, name: "Wallidrixe", type: "Player", subType: null, server: "archimonde", petOwnerId: null }]]),
      byName: new Map([["wallidrixe", [1]]]),
    },
    casts: [],
    interrupts: [],
    deaths: [],
    damageTaken: [],
    auras: [],
    dispels: [],
    healing: [],
    combatantInfo: null,
    coverage: {
      casts: false,
      interrupts: false,
      deaths: true,
      damageTaken: false,
      auras: false,
      dispels: false,
      healing: false,
      combatantInfo: false,
    },
    limitations: { missingCategories: [], truncatedPages: [], notes: [] },
  };
}

function candidate(
  partial: Partial<ScoringRunAnalysisCandidate> &
    Pick<ScoringRunAnalysisCandidate, "runId" | "dungeonSlug">,
): ScoringRunAnalysisCandidate {
  return {
    seasonSlug,
    keyLevel: 15,
    timed: true,
    completedAt: "2026-07-10T12:00:00.000Z",
    durationMs: 1_800_000,
    raiderIoScore: 200,
    wclSource: { reportCode: `R-${partial.dungeonSlug}`, fightId: 1 },
    ...partial,
  };
}

describe("resolveMaxAnalysisFights", () => {
  it("defaults to expected dungeon count and respects hard cap", () => {
    expect(resolveMaxAnalysisFights({ expectedDungeonCount: 8 })).toBe(8);
    expect(resolveMaxAnalysisFights({ expectedDungeonCount: 8, configuredMax: 100 })).toBe(8);
    expect(
      resolveMaxAnalysisFights({
        expectedDungeonCount: 8,
        configuredMax: 100,
        hardCap: ABSOLUTE_MAX_ANALYSIS_FIGHTS,
      }),
    ).toBe(8);
    expect(resolveMaxAnalysisFights({ expectedDungeonCount: 8, configuredMax: 4 })).toBe(4);
  });
});

describe("analyzeScoringRuns", () => {
  it("attempts analysis for eight selected runs", async () => {
    const candidates = MIDNIGHT_S1_SEASON.dungeonSlugs.map((dungeonSlug, i) =>
      candidate({
        runId: `run-${dungeonSlug}`,
        dungeonSlug,
        keyLevel: 16 + (i % 3),
        completedAt: `2026-07-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      }),
    );
    const fetch = vi.fn(async (reportCode: string, fightId: number) => ({
      data: { combatFacts: emptyCombatFacts(reportCode, fightId) },
      provider: "warcraftlogs" as const,
      fetchedAt: observedAt,
      ttlSeconds: 60,
      requestId: "t",
      cacheHit: false,
      rawArtifactId: null,
    }));

    const result = await analyzeScoringRuns({
      candidates,
      season: MIDNIGHT_S1_SEASON,
      ctx: ctx(),
      fetchReportFightDetails: fetch,
      configuredMaxAnalysisFights: 8,
      observedAt,
    });

    expect(result.diagnostics.selectedRunCount).toBe(8);
    expect(result.diagnostics.analyzedFightCount).toBe(8);
    expect(result.diagnostics.missingCombatFactCount).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(result.v3Observations.length).toBeGreaterThan(0);
  });

  it("keeps six facts and two unavailable when only six logs exist", async () => {
    const candidates = MIDNIGHT_S1_SEASON.dungeonSlugs.map((dungeonSlug, i) =>
      candidate({
        runId: `run-${dungeonSlug}`,
        dungeonSlug,
        wclSource: i < 6 ? { reportCode: `R-${i}`, fightId: i + 1 } : null,
      }),
    );
    const fetch = vi.fn(async (reportCode: string, fightId: number) => ({
      data: { combatFacts: emptyCombatFacts(reportCode, fightId) },
      provider: "warcraftlogs" as const,
      fetchedAt: observedAt,
      ttlSeconds: 60,
      requestId: "t",
      cacheHit: false,
      rawArtifactId: null,
    }));

    const result = await analyzeScoringRuns({
      candidates,
      season: MIDNIGHT_S1_SEASON,
      ctx: ctx(),
      fetchReportFightDetails: fetch,
      observedAt,
    });

    expect(result.diagnostics.selectedRunCount).toBe(8);
    expect(result.diagnostics.analyzedFightCount).toBe(6);
    expect(result.diagnostics.missingCombatFactCount).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(result.rows.filter((r) => !r.detailAvailable)).toHaveLength(2);
    expect(
      result.rows
        .filter((r) => !r.detailAvailable)
        .every((r) => r.rejectionReason?.includes("wcl_detail_unavailable")),
    ).toBe(true);
  });

  it("requests duplicate report/fight only once", async () => {
    const shared = { reportCode: "SharedReport", fightId: 42 };
    const candidates = MIDNIGHT_S1_SEASON.dungeonSlugs.slice(0, 2).map((dungeonSlug, i) =>
      candidate({
        runId: `run-${dungeonSlug}`,
        dungeonSlug,
        keyLevel: 20,
        wclSource: shared,
        completedAt: `2026-07-1${i}T12:00:00.000Z`,
      }),
    );
    const fetch = vi.fn(async (reportCode: string, fightId: number) => ({
      data: { combatFacts: emptyCombatFacts(reportCode, fightId) },
      provider: "warcraftlogs" as const,
      fetchedAt: observedAt,
      ttlSeconds: 60,
      requestId: "t",
      cacheHit: false,
      rawArtifactId: null,
    }));

    const result = await analyzeScoringRuns({
      candidates,
      season: {
        ...MIDNIGHT_S1_SEASON,
        dungeonSlugs: MIDNIGHT_S1_SEASON.dungeonSlugs.slice(0, 2),
        expectedDungeonCount: 2,
      },
      ctx: ctx(),
      fetchReportFightDetails: fetch,
      observedAt,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.diagnostics.wclApiCallCount).toBe(1);
    expect(result.diagnostics.deduplicatedFightFetches).toBe(1);
    expect(result.diagnostics.analyzedFightCount).toBe(2);
  });

  it("does not replace an unlogged highest run with a lower logged run", async () => {
    const dungeonSlug = "skyreach";
    const candidates = [
      candidate({
        runId: "highest-unlogged",
        dungeonSlug,
        keyLevel: 22,
        wclSource: null,
        raiderIoScore: 300,
      }),
      candidate({
        runId: "lower-logged",
        dungeonSlug,
        keyLevel: 18,
        wclSource: { reportCode: "LowerOnly", fightId: 1 },
        raiderIoScore: 250,
      }),
    ];
    const fetch = vi.fn(async (reportCode: string, fightId: number) => ({
      data: { combatFacts: emptyCombatFacts(reportCode, fightId) },
      provider: "warcraftlogs" as const,
      fetchedAt: observedAt,
      ttlSeconds: 60,
      requestId: "t",
      cacheHit: false,
      rawArtifactId: null,
    }));

    const result = await analyzeScoringRuns({
      candidates,
      season: {
        ...MIDNIGHT_S1_SEASON,
        dungeonSlugs: [dungeonSlug],
        expectedDungeonCount: 1,
      },
      ctx: ctx(),
      fetchReportFightDetails: fetch,
      observedAt,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.runId).toBe("highest-unlogged");
    expect(result.rows[0]?.detailAvailable).toBe(false);
    expect(result.selection.selectedRuns[0]?.wclReportMatched).toBe(false);
    expect(result.selection.selectedRuns[0]?.combatCoverageState).toBe("UNAVAILABLE");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates accepted WCL identity onto ScoringRunSelection and counts nested API calls", async () => {
    const dungeonSlug = "skyreach";
    const candidates = [
      candidate({
        runId: "skyreach-22",
        dungeonSlug,
        keyLevel: 22,
        completedAt: "2026-07-11T16:39:43.000Z",
        durationMs: 1_557_871,
        wclSource: { reportCode: "7PajSkyreach6KAc", fightId: 1 },
      }),
    ];
    const fetch = vi.fn(async (reportCode: string, fightId: number) => ({
      data: { combatFacts: emptyCombatFacts(reportCode, fightId) },
      provider: "warcraftlogs" as const,
      fetchedAt: observedAt,
      ttlSeconds: 60,
      requestId: "t",
      cacheHit: false,
      rawArtifactId: null,
      wclApiCallCount: 9,
    }));

    let began = false;
    const result = await analyzeScoringRuns({
      candidates,
      season: {
        ...MIDNIGHT_S1_SEASON,
        dungeonSlugs: [dungeonSlug],
        expectedDungeonCount: 1,
      },
      ctx: ctx(),
      fetchReportFightDetails: fetch,
      observedAt,
      beginWclApiCallAccounting: () => {
        began = true;
      },
      endWclApiCallAccounting: () => 9,
    });

    expect(began).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.diagnostics.wclApiCallCount).toBe(9);
    expect(result.diagnostics.analyzedFightCount).toBe(1);
    const selected = result.selection.selectedRuns[0];
    expect(selected?.wclReportMatched).toBe(true);
    expect(selected?.detailAvailable).toBe(true);
    expect(selected?.wclFightId).toBe(1);
    expect(selected?.wclReportFingerprint).toMatch(/^[a-f0-9]{12}$/);
    expect(selected?.combatCoverageState).toBe("PARTIAL");
  });

  it("continues when a provider partial failure hits one dungeon", async () => {
    const candidates = MIDNIGHT_S1_SEASON.dungeonSlugs.slice(0, 3).map((dungeonSlug, i) =>
      candidate({
        runId: `run-${dungeonSlug}`,
        dungeonSlug,
        wclSource: { reportCode: `R-${i}`, fightId: i + 1 },
      }),
    );
    const fetch = vi.fn(async (reportCode: string, fightId: number) => {
      if (reportCode === "R-1") throw new Error("transient upstream");
      return {
        data: { combatFacts: emptyCombatFacts(reportCode, fightId) },
        provider: "warcraftlogs" as const,
        fetchedAt: observedAt,
        ttlSeconds: 60,
        requestId: "t",
        cacheHit: false,
        rawArtifactId: null,
      };
    });

    const result = await analyzeScoringRuns({
      candidates,
      season: {
        ...MIDNIGHT_S1_SEASON,
        dungeonSlugs: MIDNIGHT_S1_SEASON.dungeonSlugs.slice(0, 3),
        expectedDungeonCount: 3,
      },
      ctx: ctx(),
      fetchReportFightDetails: fetch,
      isSoftSkipError: () => false,
      observedAt,
    });

    expect(result.diagnostics.analyzedFightCount).toBe(2);
    expect(result.diagnostics.missingCombatFactCount).toBe(1);
    expect(result.rows.some((r) => r.rejectionReason?.includes("partial_failure"))).toBe(true);
  });

  it("does not analyze out-of-season runs", async () => {
    const dungeonSlug = "skyreach";
    const candidates = [
      candidate({
        runId: "old-season",
        dungeonSlug,
        seasonSlug: "season-tww-3",
        keyLevel: 30,
        wclSource: { reportCode: "Old", fightId: 1 },
      }),
      candidate({
        runId: "current",
        dungeonSlug,
        keyLevel: 12,
        wclSource: { reportCode: "Cur", fightId: 2 },
      }),
    ];
    const fetch = vi.fn(async (reportCode: string, fightId: number) => ({
      data: { combatFacts: emptyCombatFacts(reportCode, fightId) },
      provider: "warcraftlogs" as const,
      fetchedAt: observedAt,
      ttlSeconds: 60,
      requestId: "t",
      cacheHit: false,
      rawArtifactId: null,
    }));

    const result = await analyzeScoringRuns({
      candidates,
      season: {
        ...MIDNIGHT_S1_SEASON,
        dungeonSlugs: [dungeonSlug],
        expectedDungeonCount: 1,
      },
      ctx: ctx(),
      fetchReportFightDetails: fetch,
      observedAt,
    });

    expect(result.rows[0]?.runId).toBe("current");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("Cur");
  });
});
