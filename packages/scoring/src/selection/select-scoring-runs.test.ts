import { describe, expect, it } from "vitest";
import { MIDNIGHT_S1_SEASON } from "@mplus/mechanics";
import {
  compareSelectableRuns,
  rawFactsToMetricObservations,
  selectScoringRuns,
  toPerformanceRawInputs,
  toSurvivalRawFacts,
  toUtilityRawFacts,
  buildProvenance,
  type SelectableScoringRun,
} from "../index.js";
import { loadSeedAbilityCatalog, loadSeedScoringMechanicCatalog } from "@mplus/mechanics";

function run(partial: Partial<SelectableScoringRun> & Pick<SelectableScoringRun, "id" | "dungeonSlug">): SelectableScoringRun {
  return {
    seasonSlug: MIDNIGHT_S1_SEASON.seasonSlug,
    keyLevel: 10,
    timed: true,
    completedAt: "2026-07-01T12:00:00.000Z",
    durationMs: 1_800_000,
    raiderIoScore: 100,
    wclReportMatched: true,
    wclCoverageRatio: 1,
    ...partial,
  };
}

describe("selectScoringRuns", () => {
  it("selects exactly one run per expected dungeon", () => {
    const runs = MIDNIGHT_S1_SEASON.dungeonSlugs.flatMap((dungeonSlug, index) => [
      run({
        id: `${dungeonSlug}-low`,
        dungeonSlug,
        keyLevel: 10,
        completedAt: `2026-07-0${(index % 8) + 1}T10:00:00.000Z`,
      }),
      run({
        id: `${dungeonSlug}-high`,
        dungeonSlug,
        keyLevel: 18,
        completedAt: `2026-07-0${(index % 8) + 1}T12:00:00.000Z`,
      }),
    ]);
    const selection = selectScoringRuns({ season: MIDNIGHT_S1_SEASON, runs });
    expect(selection.selectedRuns).toHaveLength(8);
    expect(new Set(selection.selectedRuns.map((r) => r.dungeonSlug)).size).toBe(8);
    expect(selection.selectedRuns.every((r) => r.keyLevel === 18)).toBe(true);
    expect(selection.missingDungeonSlugs).toEqual([]);
  });

  it("applies deterministic tie-breaking: key → score → timed → latest", () => {
    const dungeonSlug = "skyreach";
    const runs = [
      run({
        id: "a",
        dungeonSlug,
        keyLevel: 20,
        raiderIoScore: 200,
        timed: false,
        completedAt: "2026-07-10T10:00:00.000Z",
      }),
      run({
        id: "b",
        dungeonSlug,
        keyLevel: 20,
        raiderIoScore: 250,
        timed: true,
        completedAt: "2026-07-09T10:00:00.000Z",
      }),
      run({
        id: "c",
        dungeonSlug,
        keyLevel: 19,
        raiderIoScore: 999,
        timed: true,
        completedAt: "2026-07-11T10:00:00.000Z",
        wclReportMatched: true,
      }),
    ];
    expect(compareSelectableRuns(runs[1]!, runs[0]!)).toBeLessThan(0);
    const selection = selectScoringRuns({
      season: {
        ...MIDNIGHT_S1_SEASON,
        dungeonSlugs: [dungeonSlug],
        expectedDungeonCount: 1,
      },
      runs,
    });
    expect(selection.selectedRuns[0]?.canonicalRunId).toBe("b");
    expect(selection.selectedRuns[0]?.selectionReason).toBe("HIGHEST_SCORE_TIEBREAK");
  });

  it("does not replace an unlogged highest run with a lower logged run", () => {
    const dungeonSlug = "pit-of-saron";
    const selection = selectScoringRuns({
      season: {
        ...MIDNIGHT_S1_SEASON,
        dungeonSlugs: [dungeonSlug],
        expectedDungeonCount: 1,
      },
      runs: [
        run({
          id: "highest-unlogged",
          dungeonSlug,
          keyLevel: 22,
          wclReportMatched: false,
          raiderIoScore: 300,
          completedAt: "2026-07-20T10:00:00.000Z",
        }),
        run({
          id: "lower-logged",
          dungeonSlug,
          keyLevel: 18,
          wclReportMatched: true,
          raiderIoScore: 280,
          completedAt: "2026-07-21T10:00:00.000Z",
        }),
      ],
    });
    expect(selection.selectedRuns[0]?.canonicalRunId).toBe("highest-unlogged");
    expect(selection.selectedRuns[0]?.detailAvailable).toBe(false);
    expect(selection.selectedRuns[0]?.rejectionReasons).toContain(
      "wcl_detail_unavailable_on_highest_run",
    );
  });

  it("excludes out-of-season runs", () => {
    const dungeonSlug = "skyreach";
    const selection = selectScoringRuns({
      season: {
        ...MIDNIGHT_S1_SEASON,
        dungeonSlugs: [dungeonSlug],
        expectedDungeonCount: 1,
      },
      runs: [
        run({
          id: "old",
          dungeonSlug,
          seasonSlug: "season-tww-3",
          keyLevel: 25,
          wclReportMatched: true,
        }),
        run({
          id: "current",
          dungeonSlug,
          keyLevel: 12,
          wclReportMatched: true,
        }),
      ],
    });
    expect(selection.selectedRuns[0]?.canonicalRunId).toBe("current");
    expect(selection.selectedRuns[0]?.keyLevel).toBe(12);
  });
});

describe("raw fact persistence envelopes", () => {
  it("embeds formula/catalog versions and observedAt", () => {
    const ability = loadSeedAbilityCatalog();
    const mechanic = loadSeedScoringMechanicCatalog();
    const observedAt = "2026-07-28T00:00:00.000Z";
    const provenance = buildProvenance({
      sourceProvider: "warcraftlogs",
      canonicalRunId: "run-1",
      dungeonSlug: "skyreach",
      abilityCatalog: ability,
      mechanicCatalog: mechanic,
      observedAt,
    });
    const survival = toSurvivalRawFacts({
      provenance,
      detailAvailable: false,
      counts: null,
      missingReasons: ["wcl_detail_unavailable_on_highest_run"],
    });
    const utility = toUtilityRawFacts({
      provenance,
      detailAvailable: false,
      counts: null,
    });
    const performance = toPerformanceRawInputs({
      provenance,
      parsePercentile: null,
      keyLevel: 20,
      timed: true,
      seasonSlug: MIDNIGHT_S1_SEASON.seasonSlug,
      region: "EU",
      detailAvailable: false,
    });
    const observations = rawFactsToMetricObservations({ survival, utility, performance });
    expect(observations.length).toBeGreaterThan(0);
    for (const obs of observations) {
      expect(obs.observedAt).toBe(observedAt);
      const ctx = obs.context as { formulaVersion: string; abilityCatalogVersion: string };
      expect(ctx.formulaVersion).toBeTruthy();
      expect(ctx.abilityCatalogVersion).toBe(ability.catalogVersion);
    }
  });
});
