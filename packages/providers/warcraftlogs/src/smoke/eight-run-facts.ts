/**
 * Eight-run Scoring v3 raw-fact assembly for sanitized deep smoke.
 */
import { createHash } from "node:crypto";
import type {
  ScoringDataFoundationSnapshot,
  ScoringRunRawFactRow,
  ScoringRunSelection,
} from "@mplus/contracts";
import { SCORING_V3_FORMULA_VERSION } from "@mplus/contracts";
import {
  extractSurvivalCounts,
  extractUtilityCounts,
  loadSeedAbilityCatalog,
  loadSeedScoringMechanicCatalog,
  type AbilityCatalog,
  type ScoringMechanicCatalog,
} from "@mplus/mechanics";
import {
  buildProvenance,
  toPerformanceRawInputs,
  toSurvivalRawFacts,
  toUtilityRawFacts,
  type SelectableScoringRun,
} from "@mplus/scoring";
import { MAX_EVENT_PAGES, MAX_EVENTS_PER_CATEGORY } from "../discovery/bounds.js";
import { resolveAttributedSourceIds } from "../discovery/run-matching.js";
import { sanitizeReportRef } from "./sanitize.js";
import type { RunCombatFacts } from "../types.js";

export interface EightRunCombatAnalysis {
  selectable: SelectableScoringRun;
  reportCode: string | null;
  fightId: number | null;
  combatFacts: RunCombatFacts | null;
  parsePercentile: number | null;
  apiPointCost: number | null;
  analysisError: string | null;
  classSlug?: string | null;
  specSlug?: string | null;
  region?: string | null;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

export function buildEightRunRawFactRows(input: {
  selection: ScoringRunSelection;
  analyses: EightRunCombatAnalysis[];
  abilityCatalog?: AbilityCatalog;
  mechanicCatalog?: ScoringMechanicCatalog;
  observedAt?: string;
}): ScoringRunRawFactRow[] {
  const abilityCatalog = input.abilityCatalog ?? loadSeedAbilityCatalog();
  const mechanicCatalog = input.mechanicCatalog ?? loadSeedScoringMechanicCatalog();
  const observedAt = input.observedAt ?? input.selection.observedAt;
  const byId = new Map(input.analyses.map((a) => [a.selectable.id, a]));

  return input.selection.selectedRuns.map((selected) => {
    const analysis = byId.get(selected.canonicalRunId);
    const facts = analysis?.combatFacts ?? null;
    const detailAvailable = Boolean(selected.detailAvailable && facts);
    const provenance = buildProvenance({
      sourceProvider: facts ? "warcraftlogs" : "derived",
      canonicalRunId: selected.canonicalRunId,
      dungeonSlug: selected.dungeonSlug,
      abilityCatalog,
      mechanicCatalog,
      observedAt,
    });

    let survivalCounts = null;
    let utilityCounts = null;
    if (facts) {
      const attributed = resolveAttributedSourceIds(facts.actorMap, facts.targetSourceId);
      const hostileTargetIds = new Set<number>();
      for (const actor of facts.actorMap.byId.values()) {
        if (actor.type === "NPC" || actor.type === "Boss" || actor.type === "Enemy") {
          hostileTargetIds.add(actor.id);
        }
      }
      const extractInput = {
        seasonSlug: input.selection.seasonSlug,
        dungeonSlug: selected.dungeonSlug,
        targetSourceId: facts.targetSourceId,
        attributedSourceIds: attributed,
        hostileTargetIds,
        maxHealth: facts.combatantInfo?.maxHitPoints ?? null,
        abilityCatalog,
        mechanicCatalog,
        casts: facts.casts,
        interrupts: facts.interrupts,
        deaths: facts.deaths,
        damageTaken: facts.damageTaken,
        healing: facts.healing,
        dispels: facts.dispels,
        auras: facts.auras,
        classSlug: analysis?.classSlug ?? "warlock",
        specSlug: analysis?.specSlug ?? "demonology",
      };
      survivalCounts = extractSurvivalCounts(extractInput);
      utilityCounts = extractUtilityCounts(extractInput);
    }

    const missingDataReasons = [
      ...selected.rejectionReasons,
      ...(analysis?.analysisError ? [analysis.analysisError] : []),
      ...(!detailAvailable ? ["combat_facts_unavailable"] : []),
      ...(facts?.limitations.truncatedPages.map((c) => `truncated:${c}`) ?? []),
      ...(facts?.limitations.missingCategories.map((c) => `missing_category:${c}`) ?? []),
    ];

    const survival = toSurvivalRawFacts({
      provenance,
      counts: survivalCounts,
      detailAvailable,
      missingReasons: missingDataReasons,
    });
    const utility = toUtilityRawFacts({
      provenance,
      counts: utilityCounts,
      detailAvailable,
      missingReasons: missingDataReasons,
    });
    const performance = toPerformanceRawInputs({
      provenance,
      parsePercentile: analysis?.parsePercentile ?? null,
      keyLevel: selected.keyLevel,
      timed: selected.timed,
      seasonSlug: input.selection.seasonSlug,
      region: analysis?.region ?? null,
      detailAvailable,
    });

    return {
      dungeonSlug: selected.dungeonSlug,
      canonicalRunFingerprint: fingerprint(selected.canonicalRunId),
      keyLevel: selected.keyLevel,
      durationMs: selected.durationMs,
      timed: selected.timed,
      selectionReason: selected.selectionReason,
      wclReportFingerprint: analysis?.reportCode
        ? sanitizeReportRef(analysis.reportCode).fingerprint
        : (selected.wclReportFingerprint ?? null),
      wclFightId: analysis?.fightId ?? selected.wclFightId ?? null,
      detailAvailable,
      performance,
      survival,
      utility,
      missingDataReasons,
      rejectionReasons: selected.rejectionReasons,
      apiPointCost: analysis?.apiPointCost ?? null,
    };
  });
}

export function buildScoringDataFoundationSnapshot(input: {
  selection: ScoringRunSelection;
  rows: ScoringRunRawFactRow[];
  providerPointCost: number | null;
  truncatedCategoriesObserved?: string[];
  abilityCatalogVersion?: string;
  mechanicCatalogVersion?: string;
  observedAt?: string;
}): ScoringDataFoundationSnapshot {
  const abilityCatalog = loadSeedAbilityCatalog();
  const mechanicCatalog = loadSeedScoringMechanicCatalog();
  return {
    seasonSlug: input.selection.seasonSlug,
    expectedDungeonCount: input.selection.expectedDungeonCount,
    selection: input.selection,
    rows: input.rows,
    aggregateCoverage: {
      selectedDungeonCount: input.selection.selectedRuns.length,
      detailAvailableCount: input.rows.filter((r) => r.detailAvailable).length,
      wclMatchedCount: input.selection.selectedRuns.filter((r) => r.wclReportMatched).length,
    },
    providerPointCost: input.providerPointCost,
    pagination: {
      maxEventPages: MAX_EVENT_PAGES,
      maxEventsPerCategory: MAX_EVENTS_PER_CATEGORY,
      truncatedCategoriesObserved: input.truncatedCategoriesObserved ?? [],
    },
    formulaVersion: SCORING_V3_FORMULA_VERSION,
    abilityCatalogVersion: input.abilityCatalogVersion ?? abilityCatalog.catalogVersion,
    mechanicCatalogVersion: input.mechanicCatalogVersion ?? mechanicCatalog.catalogVersion,
    observedAt: input.observedAt ?? input.selection.observedAt,
  };
}
