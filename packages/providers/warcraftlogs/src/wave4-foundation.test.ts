import { describe, expect, it } from "vitest";
import { buildActorMap, resolveAttributedSourceIds } from "./discovery/run-matching.js";
import { MAX_EVENT_PAGES, MAX_EVENTS_PER_CATEGORY } from "./discovery/bounds.js";
import { sanitizeReportCode, sanitizeReportRef } from "./smoke/sanitize.js";
import {
  buildEightRunRawFactRows,
  buildScoringDataFoundationSnapshot,
} from "./smoke/eight-run-facts.js";
import { MIDNIGHT_S1_SEASON } from "@mplus/mechanics";
import { selectScoringRuns } from "@mplus/scoring";
import type { RunCombatFacts } from "./types.js";

describe("wave4 data foundation helpers", () => {
  it("attributes pets to owning player", () => {
    const map = buildActorMap([
      { id: 1, name: "Wallidrixe", type: "Player", server: "archimonde" },
      { id: 2, name: "Felhunter", type: "Pet", petOwner: 1 },
      { id: 3, name: "OtherPet", type: "Pet", petOwner: 99 },
    ]);
    const attributed = resolveAttributedSourceIds(map, 1);
    expect([...attributed].sort()).toEqual([1, 2]);
  });

  it("keeps event pagination bounds", () => {
    expect(MAX_EVENT_PAGES).toBeLessThanOrEqual(10);
    expect(MAX_EVENTS_PER_CATEGORY).toBeLessThanOrEqual(2000);
  });

  it("sanitizes report codes and never embeds raw secrets", () => {
    const code = "AbCdEfGhIjKl";
    const sanitized = sanitizeReportRef(code);
    expect(sanitized.maskedCode).not.toBe(code);
    expect(sanitizeReportCode(code)).toContain("****");
    expect(JSON.stringify(sanitized)).not.toContain(code);
  });

  it("builds eight-run foundation snapshot with fingerprints only", () => {
    const runs = MIDNIGHT_S1_SEASON.dungeonSlugs.map((dungeonSlug, i) => ({
      id: `run-${dungeonSlug}`,
      dungeonSlug,
      seasonSlug: MIDNIGHT_S1_SEASON.seasonSlug,
      keyLevel: 15 + (i % 3),
      timed: true as boolean | null,
      completedAt: `2026-07-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      durationMs: 1_800_000,
      raiderIoScore: 200 + i,
      wclReportMatched: i % 2 === 0,
      wclCoverageRatio: i % 2 === 0 ? 0.9 : null,
    }));
    const selection = selectScoringRuns({ season: MIDNIGHT_S1_SEASON, runs });
    expect(selection.selectedRuns).toHaveLength(8);

    const emptyFacts: RunCombatFacts = {
      reportCode: "SecretReport99",
      fightId: 1,
      revision: 1,
      targetSourceId: 1,
      actorMap: buildActorMap([{ id: 1, name: "Wallidrixe", type: "Player", server: "archimonde" }]),
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
        deaths: false,
        damageTaken: false,
        auras: false,
        dispels: false,
        healing: false,
        combatantInfo: false,
      },
      limitations: { missingCategories: [], truncatedPages: [], notes: [] },
    };

    const analyses = selection.selectedRuns.map((selected) => ({
      selectable: runs.find((r) => r.id === selected.canonicalRunId)!,
      reportCode: selected.wclReportMatched ? "SecretReport99" : null,
      fightId: selected.wclReportMatched ? 7 : null,
      combatFacts: selected.wclReportMatched ? emptyFacts : null,
      parsePercentile: selected.wclReportMatched ? 90 : null,
      apiPointCost: 12,
      analysisError: selected.wclReportMatched ? null : "wcl_detail_unavailable_on_highest_run",
      classSlug: "warlock",
      specSlug: "demonology",
      region: "EU",
    }));

    const rows = buildEightRunRawFactRows({ selection, analyses });
    const snapshot = buildScoringDataFoundationSnapshot({
      selection,
      rows,
      providerPointCost: 42,
    });
    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toContain("SecretReport99");
    expect(snapshot.rows).toHaveLength(selection.selectedRuns.length);
    expect(snapshot.pagination.maxEventPages).toBeLessThanOrEqual(10);
  });
});
