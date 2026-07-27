import type {
  CombatCoverageState,
  PerformanceSummaryDTO,
  ScoringRunSelectionProfileDTO,
  ScoringRunSelectionReason,
  ScoringSelectedRunProfileDTO,
} from "@mplus/contracts";
import {
  MIDNIGHT_S1_SEASON,
  resolveSeasonDungeonSet,
  type SeasonDungeonSet,
} from "@mplus/mechanics";
import { selectScoringRuns, type SelectableScoringRun } from "@mplus/scoring";

export interface ScoringRunSelectionSourceRun {
  runId: string;
  dungeonSlug: string;
  dungeonName: string;
  seasonSlug: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  durationMs: number | null;
  raiderIoScore: number | null;
  wclReportMatched: boolean;
  analysis?: {
    coverage: number | null;
    detailAvailable?: boolean | null;
    rejectionReason?: string | null;
    selectionReason?: ScoringRunSelectionReason | null;
    evidenceSummary?: string | null;
  } | null;
}

function dungeonTitle(slug: string, name?: string | null): string {
  if (name && name.trim()) return name.trim();
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function resolveCombatCoverageState(input: {
  wclReportMatched: boolean;
  detailAvailable: boolean;
  coverageRatio: number | null;
}): CombatCoverageState {
  if (!input.wclReportMatched || !input.detailAvailable) return "UNAVAILABLE";
  if (input.coverageRatio == null) return "PARTIAL";
  if (input.coverageRatio >= 0.75) return "AVAILABLE";
  if (input.coverageRatio > 0) return "PARTIAL";
  return "UNAVAILABLE";
}

function perfForDungeon(
  performanceSummary: PerformanceSummaryDTO | null | undefined,
  dungeonSlug: string,
): { parsePercentile: number | null; evidenceSummary: string | null } {
  const dungeon = performanceSummary?.currentSeason.dungeons.find(
    (d) => d.dungeonSlug === dungeonSlug,
  );
  if (!dungeon) return { parsePercentile: null, evidenceSummary: null };
  const parse =
    dungeon.bestParsePercentile ??
    dungeon.bestRun?.parsePercentile ??
    dungeon.latestRun?.parsePercentile ??
    null;
  const evidence =
    parse != null
      ? `Best parse ${Math.round(parse)}% across ${dungeon.loggedRunCount} logged run(s).`
      : dungeon.loggedRunCount > 0
        ? `${dungeon.loggedRunCount} logged run(s); parse percentile unavailable.`
        : null;
  return { parsePercentile: parse, evidenceSummary: evidence };
}

/**
 * Build the public ScoringRunSelection profile DTO from season runs + analysis metadata.
 * Selection rules match Gate A (highest key → score → timed → latest).
 */
export function mapScoringRunSelectionProfile(input: {
  seasonSlug: string;
  expectedDungeonCount?: number | null;
  dungeonSlugs?: readonly string[] | null;
  runs: ScoringRunSelectionSourceRun[];
  performanceSummary?: PerformanceSummaryDTO | null;
  observedAt?: string | null;
  allowPlaceholder?: boolean;
}): ScoringRunSelectionProfileDTO | null {
  if (!input.seasonSlug) return null;

  let season: SeasonDungeonSet;
  try {
    season = resolveSeasonDungeonSet({
      seasonSlug: input.seasonSlug,
      dungeonSlugs:
        input.dungeonSlugs && input.dungeonSlugs.length > 0
          ? input.dungeonSlugs
          : MIDNIGHT_S1_SEASON.dungeonSlugs,
      expectedDungeonCount:
        input.expectedDungeonCount && input.expectedDungeonCount > 0
          ? input.expectedDungeonCount
          : MIDNIGHT_S1_SEASON.expectedDungeonCount,
      allowPlaceholder: input.allowPlaceholder,
    });
  } catch {
    season = {
      ...MIDNIGHT_S1_SEASON,
      seasonSlug: input.seasonSlug,
      expectedDungeonCount:
        input.expectedDungeonCount && input.expectedDungeonCount > 0
          ? input.expectedDungeonCount
          : MIDNIGHT_S1_SEASON.expectedDungeonCount,
    };
  }

  // Align selectable seasonSlug with the active profile season so DB rows match.
  const selectables: SelectableScoringRun[] = input.runs.map((run) => ({
    id: run.runId,
    dungeonSlug: run.dungeonSlug,
    seasonSlug: input.seasonSlug,
    keyLevel: run.keyLevel,
    timed: run.timed,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    raiderIoScore: run.raiderIoScore,
    wclReportMatched: run.wclReportMatched,
    wclCoverageRatio: run.analysis?.coverage ?? null,
  }));

  const selection = selectScoringRuns({
    season: { ...season, seasonSlug: input.seasonSlug },
    runs: selectables,
    observedAt: input.observedAt ?? new Date().toISOString(),
    enforceSeasonSlug: true,
  });

  const byId = new Map(input.runs.map((r) => [r.runId, r]));
  const selectedRuns: ScoringSelectedRunProfileDTO[] = selection.selectedRuns.map((selected) => {
    const source = byId.get(selected.canonicalRunId);
    const detailAvailable =
      source?.analysis?.detailAvailable ?? selected.detailAvailable;
    const coverageRatio = source?.analysis?.coverage ?? selected.wclCoverageRatio;
    const combatCoverageState = resolveCombatCoverageState({
      wclReportMatched: selected.wclReportMatched,
      detailAvailable,
      coverageRatio,
    });
    const unavailableReason =
      combatCoverageState === "AVAILABLE"
        ? null
        : source?.analysis?.rejectionReason ??
          selected.rejectionReasons[0] ??
          (combatCoverageState === "PARTIAL"
            ? "combat_coverage_incomplete"
            : "wcl_detail_unavailable_on_highest_run");

    const perf = perfForDungeon(input.performanceSummary, selected.dungeonSlug);
    const evidenceSummary =
      source?.analysis?.evidenceSummary ??
      perf.evidenceSummary ??
      (detailAvailable
        ? `Selected ${selected.selectionReason.toLowerCase().replace(/_/g, " ")} run.`
        : "Selected highest key; combat detail unavailable.");

    const missingMetrics: string[] = [];
    if (!selected.wclReportMatched || !detailAvailable) {
      missingMetrics.push("wcl_match", "combat_facts");
    }
    if (perf.parsePercentile == null) missingMetrics.push("parse_percentile");
    if (combatCoverageState === "PARTIAL") missingMetrics.push("combat_coverage");

    return {
      canonicalRunId: selected.canonicalRunId,
      dungeonSlug: selected.dungeonSlug,
      dungeonName: dungeonTitle(selected.dungeonSlug, source?.dungeonName),
      keyLevel: selected.keyLevel,
      completedAt: selected.completedAt,
      timed: selected.timed,
      durationMs: selected.durationMs,
      raiderIoScore: selected.raiderIoScore,
      selectionReason: selected.selectionReason,
      combatCoverageState,
      unavailableReason,
      wclReportMatched: selected.wclReportMatched,
      wclCoverageRatio: coverageRatio,
      parsePercentile: perf.parsePercentile,
      keyDifficultyPercentile: null,
      evidenceSummary,
      missingMetrics: [...new Set(missingMetrics)],
    };
  });

  return {
    seasonSlug: selection.seasonSlug,
    expectedDungeonCount: selection.expectedDungeonCount,
    expectedDungeonSlugs: selection.expectedDungeonSlugs,
    selectedRuns,
    missingDungeonSlugs: selection.missingDungeonSlugs,
    selectionConfidence: selection.selectionConfidence,
    observedAt: selection.observedAt,
  };
}
