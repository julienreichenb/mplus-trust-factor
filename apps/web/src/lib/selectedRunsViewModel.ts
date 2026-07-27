import type { CharacterProfileView, SelectedRunView } from "../api/types";
import { formatPercent, formatScore } from "./format";

export interface SelectedRunsPresentation {
  runs: SelectedRunView[];
  expectedCount: number;
  coverageLabel: string;
  hasAny: boolean;
}

/** Resolve eight-run selection from profile without computing scores. */
export function resolveSelectedRuns(profile: CharacterProfileView): SelectedRunsPresentation {
  const expected =
    profile.selectedRunExpectedCount ??
    profile.performanceSummary?.currentSeason.expectedDungeonCount ??
    8;

  if (profile.selectedRuns?.length) {
    return {
      runs: profile.selectedRuns,
      expectedCount: expected,
      coverageLabel: `${profile.selectedRuns.length}/${expected} dungeons`,
      hasAny: true,
    };
  }

  const fromPerf = profile.performanceSummary?.currentSeason.dungeons ?? [];
  if (fromPerf.length) {
    const runs: SelectedRunView[] = fromPerf.map((d) => {
      const run = d.bestRun ?? d.latestRun;
      return {
        runId: run?.runId ?? `missing-${d.dungeonSlug}`,
        dungeonName: d.dungeonName,
        dungeonSlug: d.dungeonSlug,
        keyLevel: run?.keyLevel ?? 0,
        completedAt: run?.completedAt ?? "",
        timed: run?.timed ?? null,
        durationMs: null,
        raiderIoScore: null,
        wclReportMatched: run != null && run.parsePercentile != null,
        wclCoverageRatio: null,
        selectionReason: "HIGHEST_KEY",
        parsePercentile: run?.parsePercentile ?? d.bestParsePercentile,
        keyDifficultyPercentile: null,
        evidenceSummary: run
          ? `Selected ${run.kind.toLowerCase()} run for ${d.dungeonName}.`
          : "No selected run for this dungeon.",
        missingMetrics: run ? [] : ["selected_run", "parse_percentile"],
      };
    });
    return {
      runs,
      expectedCount: expected,
      coverageLabel: `${runs.filter((r) => r.keyLevel > 0).length}/${expected} dungeons`,
      hasAny: runs.some((r) => r.keyLevel > 0),
    };
  }

  const fallback: SelectedRunView[] = [];
  for (const run of [profile.highestAnalyzedRun, profile.lastAnalyzedRun]) {
    if (!run) continue;
    if (fallback.some((r) => r.runId === run.runId)) continue;
    fallback.push({
      runId: run.runId,
      dungeonName: run.dungeonName,
      dungeonSlug: run.dungeonSlug,
      keyLevel: run.keyLevel,
      completedAt: run.completedAt,
      timed: run.timed,
      durationMs: null,
      raiderIoScore: null,
      wclReportMatched: run.coverageRatio > 0,
      wclCoverageRatio: run.coverageRatio,
      selectionReason: "HIGHEST_KEY",
      parsePercentile: null,
      keyDifficultyPercentile: null,
      evidenceSummary: run.performanceSummary,
      missingMetrics: [],
    });
  }

  return {
    runs: fallback,
    expectedCount: expected,
    coverageLabel: `${fallback.length}/${expected} dungeons`,
    hasAny: fallback.length > 0,
  };
}

export function formatRunTimed(timed: boolean | null | undefined): string {
  if (timed === true) return "Timed";
  if (timed === false) return "Depleted";
  return "Unknown";
}

export function formatNullableMetric(
  value: number | null | undefined,
  kind: "score" | "percent" = "score",
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "Unavailable";
  return kind === "percent" ? formatPercent(value, 0) : formatScore(value, 0);
}
