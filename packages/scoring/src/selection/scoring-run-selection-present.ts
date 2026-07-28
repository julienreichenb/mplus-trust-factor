import type { ScoringRunSelection as ContractScoringRunSelection } from "@mplus/contracts";
import type { ScoringRunSelection, ScoringRunSelectionEntry } from "./scoring-run-selection.js";

export interface ScoringRunPresentationMeta {
  dungeonName: string;
  wclReportMatched: boolean;
  wclCoverageRatio: number | null;
  hasDetailedAnalysis: boolean;
}

/**
 * Build the persisted/public scoringRunSelection from the canonical internal selection.
 */
export function toContractScoringRunSelection(
  selection: ScoringRunSelection,
  metaByRunId: Record<string, ScoringRunPresentationMeta>,
  dungeonNamesBySlug: Record<string, string>,
): ContractScoringRunSelection {
  return {
    seasonSlug: selection.seasonSlug,
    expectedDungeonCount: selection.expectedDungeonCount,
    selectedRuns: selection.selectedRuns.map((entry) => {
      const meta = metaByRunId[entry.canonicalRunId];
      const dungeonName =
        meta?.dungeonName ??
        dungeonNamesBySlug[entry.dungeonSlug] ??
        entry.dungeonSlug;
      return {
        dungeonSlug: entry.dungeonSlug,
        dungeonName,
        canonicalRunId: entry.canonicalRunId,
        keyLevel: entry.keyLevel,
        timed: entry.timed,
        completedAt: entry.completedAt,
        wclReportMatched: meta?.wclReportMatched ?? entry.wclReportMatched,
        selectionReason: entry.selectionReason,
        coverageRatio: meta?.wclCoverageRatio ?? entry.wclCoverageRatio ?? null,
      };
    }),
  };
}

export function applyRunMetadataToSelection(
  selection: ScoringRunSelection,
  metaByRunId: Record<string, ScoringRunPresentationMeta>,
): ScoringRunSelection {
  const selectedRuns: ScoringRunSelectionEntry[] = selection.selectedRuns.map((entry) => {
    const meta = metaByRunId[entry.canonicalRunId];
    if (!meta) return entry;
    return {
      ...entry,
      wclReportMatched: meta.wclReportMatched,
      wclCoverageRatio: meta.wclCoverageRatio,
    };
  });
  return { ...selection, selectedRuns };
}
