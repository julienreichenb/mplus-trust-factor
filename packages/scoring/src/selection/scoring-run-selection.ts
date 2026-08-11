export type ScoringRunSelectionReason =
  | "HIGHEST_KEY"
  | "HIGHEST_SCORE_TIEBREAK"
  | "LATEST_TIEBREAK"
  | "WCL_PREFERRED_OVER_HIGHER_UNLOGGED";

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
  replacedHigherUnlogged: boolean,
): ScoringRunSelectionReason {
  if (replacedHigherUnlogged) return "WCL_PREFERRED_OVER_HIGHER_UNLOGGED";
  const sameKey = challengers.filter((c) => c.keyLevel === winner.keyLevel);
  if (sameKey.length <= 1) return "HIGHEST_KEY";
  const scores = new Set(sameKey.map((c) => c.scoreValue ?? null));
  if (scores.size > 1) return "HIGHEST_SCORE_TIEBREAK";
  return "LATEST_TIEBREAK";
}

/**
 * Select exactly one canonical run per dungeon: highest key, then score, then latest.
 * Prefers hasWclSource: if the nominal winner lacks WCL, use the next-best candidate that has WCL.
 */
export function selectScoringRuns(
  runs: ScoringRunCandidateInput[],
  options: {
    seasonSlug: string;
    expectedDungeonCount: number;
    /** Active-season dungeon slugs — off-pool dungeons are excluded before selection. */
    allowedDungeonSlugs?: string[];
  },
): ScoringRunSelection {
  const allowed =
    options.allowedDungeonSlugs != null
      ? new Set(
          options.allowedDungeonSlugs
            .map((slug) => slug.trim().toLowerCase())
            .filter((slug) => slug.length > 0),
        )
      : null;

  const byDungeon = new Map<string, ScoringRunCandidateInput[]>();
  for (const run of runs) {
    const slug = run.dungeonSlug.trim().toLowerCase();
    if (!slug) continue;
    if (allowed && !allowed.has(slug)) continue;
    const bucket = byDungeon.get(slug) ?? [];
    bucket.push(run);
    byDungeon.set(slug, bucket);
  }

  const dungeonSlugsToSelect =
    allowed != null
      ? [...allowed].sort((a, b) => a.localeCompare(b))
      : [...byDungeon.keys()].sort((a, b) => a.localeCompare(b));

  const selectedRuns: ScoringRunSelectionEntry[] = [];
  for (const dungeonSlug of dungeonSlugsToSelect) {
    const bucket = byDungeon.get(dungeonSlug);
    if (!bucket || bucket.length === 0) continue;
    const sorted = [...bucket].sort(compareRuns);
    let winner = sorted[0]!;
    let replacedHigherUnlogged = false;
    if (!winner.hasWclSource) {
      const alt = sorted.find((r) => !replacedHigherUnlogged && r.hasWclSource);
      if (alt) {
        winner = alt;
        replacedHigherUnlogged = true;
      }
    }
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
      selectionReason: selectionReasonFor(winner, bucket, replacedHigherUnlogged),
    });
  }

  return {
    seasonSlug: options.seasonSlug,
    expectedDungeonCount: options.expectedDungeonCount,
    selectedRuns,
  };
}
