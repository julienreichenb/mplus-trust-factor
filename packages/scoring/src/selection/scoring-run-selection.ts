export type ScoringRunSelectionReason =
  | "HIGHEST_KEY"
  | "HIGHEST_SCORE_TIEBREAK"
  | "LATEST_TIEBREAK";

export interface ScoringRunSelectionEntry {
  dungeonSlug: string;
  canonicalRunId: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  durationMs: number | null;
  raiderIoScore: number | null;
  wclReportMatched: boolean;
  wclCoverageRatio: number | null;
  selectionReason: ScoringRunSelectionReason;
}

export interface ScoringRunSelection {
  seasonSlug: string;
  expectedDungeonCount: number;
  selectedRuns: ScoringRunSelectionEntry[];
}

export interface ScoringRunCandidateInput {
  canonicalRunId: string;
  dungeonSlug: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  durationMs: number | null;
  scoreValue: number | null;
  hasWclSource: boolean;
}

function compareRuns(a: ScoringRunCandidateInput, b: ScoringRunCandidateInput): number {
  if (a.keyLevel !== b.keyLevel) return b.keyLevel - a.keyLevel;
  const scoreA = a.scoreValue ?? -1;
  const scoreB = b.scoreValue ?? -1;
  if (scoreA !== scoreB) return scoreB - scoreA;
  return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
}

function selectionReasonFor(
  winner: ScoringRunCandidateInput,
  challengers: ScoringRunCandidateInput[],
): ScoringRunSelectionReason {
  const sameKey = challengers.filter((c) => c.keyLevel === winner.keyLevel);
  if (sameKey.length <= 1) return "HIGHEST_KEY";
  const scores = new Set(sameKey.map((c) => c.scoreValue ?? null));
  if (scores.size > 1) return "HIGHEST_SCORE_TIEBREAK";
  return "LATEST_TIEBREAK";
}

/**
 * Select exactly one canonical run per dungeon: highest key, then score, then latest.
 * Never demotes a higher unlogged run — WCL detail is tracked separately via hasWclSource.
 */
export function selectScoringRuns(
  runs: ScoringRunCandidateInput[],
  options: { seasonSlug: string; expectedDungeonCount: number },
): ScoringRunSelection {
  const byDungeon = new Map<string, ScoringRunCandidateInput[]>();
  for (const run of runs) {
    const slug = run.dungeonSlug.trim().toLowerCase();
    if (!slug) continue;
    const bucket = byDungeon.get(slug) ?? [];
    bucket.push(run);
    byDungeon.set(slug, bucket);
  }

  const selectedRuns: ScoringRunSelectionEntry[] = [];
  for (const [dungeonSlug, bucket] of byDungeon) {
    const sorted = [...bucket].sort(compareRuns);
    const winner = sorted[0]!;
    selectedRuns.push({
      dungeonSlug,
      canonicalRunId: winner.canonicalRunId,
      keyLevel: winner.keyLevel,
      timed: winner.timed,
      completedAt: winner.completedAt,
      durationMs: winner.durationMs,
      raiderIoScore: winner.scoreValue,
      wclReportMatched: winner.hasWclSource,
      wclCoverageRatio: null,
      selectionReason: selectionReasonFor(winner, bucket),
    });
  }

  selectedRuns.sort((a, b) => a.dungeonSlug.localeCompare(b.dungeonSlug));
  return {
    seasonSlug: options.seasonSlug,
    expectedDungeonCount: options.expectedDungeonCount,
    selectedRuns,
  };
}
