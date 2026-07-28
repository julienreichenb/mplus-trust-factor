export type SurvivalRunSelectionReason =
  | "HIGHEST_KEY"
  | "HIGHEST_SCORE_TIEBREAK"
  | "LATEST_TIEBREAK"
  | "WCL_PREFERRED_OVER_HIGHER_UNLOGGED";

export interface SurvivalRunCandidateInput {
  canonicalRunId: string;
  dungeonSlug: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  durationMs: number | null;
  scoreValue: number | null;
  hasWclSource: boolean;
}

export interface SurvivalRunSelectionEntry {
  dungeonSlug: string;
  canonicalRunId: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  durationMs: number | null;
  raiderIoScore: number | null;
  wclReportMatched: boolean;
  selectionReason: SurvivalRunSelectionReason;
}

export interface SurvivalRunSelection {
  selectedRuns: SurvivalRunSelectionEntry[];
  maxRunsPerDungeon: number;
  allowedDungeonCount: number;
}

function compareRuns(a: SurvivalRunCandidateInput, b: SurvivalRunCandidateInput): number {
  if (a.keyLevel !== b.keyLevel) return b.keyLevel - a.keyLevel;
  const scoreA = a.scoreValue ?? -1;
  const scoreB = b.scoreValue ?? -1;
  if (scoreA !== scoreB) return scoreB - scoreA;
  return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
}

function selectionReasonFor(
  winner: SurvivalRunCandidateInput,
  challengers: SurvivalRunCandidateInput[],
  replacedHigherUnlogged: boolean,
): SurvivalRunSelectionReason {
  if (replacedHigherUnlogged) return "WCL_PREFERRED_OVER_HIGHER_UNLOGGED";
  const sameKey = challengers.filter((c) => c.keyLevel === winner.keyLevel);
  if (sameKey.length <= 1) return "HIGHEST_KEY";
  const scores = new Set(sameKey.map((c) => c.scoreValue ?? null));
  if (scores.size > 1) return "HIGHEST_SCORE_TIEBREAK";
  return "LATEST_TIEBREAK";
}

/**
 * Per active dungeon, select up to `maxRunsPerDungeon` highest key/score runs.
 * Prefers hasWclSource: if a top candidate lacks WCL, try the next-best with WCL.
 * Caller passes allowedDungeonSlugs without inactive/off-pool (e.g. no Icecrown).
 */
export function selectSurvivalAnalysisRuns(
  candidates: SurvivalRunCandidateInput[],
  options: {
    allowedDungeonSlugs: string[];
    maxRunsPerDungeon?: number;
  },
): SurvivalRunSelection {
  const maxRunsPerDungeon = options.maxRunsPerDungeon ?? 3;
  const allowed = new Set(
    options.allowedDungeonSlugs
      .map((slug) => slug.trim().toLowerCase())
      .filter((slug) => slug.length > 0),
  );

  const byDungeon = new Map<string, SurvivalRunCandidateInput[]>();
  for (const run of candidates) {
    const slug = run.dungeonSlug.trim().toLowerCase();
    if (!slug || !allowed.has(slug)) continue;
    const bucket = byDungeon.get(slug) ?? [];
    bucket.push(run);
    byDungeon.set(slug, bucket);
  }

  const selectedRuns: SurvivalRunSelectionEntry[] = [];
  const dungeonSlugs = [...allowed].sort((a, b) => a.localeCompare(b));

  for (const dungeonSlug of dungeonSlugs) {
    const bucket = byDungeon.get(dungeonSlug);
    if (!bucket || bucket.length === 0) continue;
    const sorted = [...bucket].sort(compareRuns);
    const used = new Set<string>();

    for (const candidate of sorted) {
      if (selectedRuns.filter((r) => r.dungeonSlug === dungeonSlug).length >= maxRunsPerDungeon) {
        break;
      }
      if (used.has(candidate.canonicalRunId)) continue;

      let winner = candidate;
      let replacedHigherUnlogged = false;

      if (!candidate.hasWclSource) {
        const alt = sorted.find(
          (r) => !used.has(r.canonicalRunId) && r.hasWclSource,
        );
        if (alt) {
          winner = alt;
          replacedHigherUnlogged = true;
        }
      }

      used.add(winner.canonicalRunId);
      selectedRuns.push({
        dungeonSlug,
        canonicalRunId: winner.canonicalRunId,
        keyLevel: winner.keyLevel,
        timed: winner.timed,
        completedAt: winner.completedAt,
        durationMs: winner.durationMs,
        raiderIoScore: winner.scoreValue,
        wclReportMatched: winner.hasWclSource,
        selectionReason: selectionReasonFor(winner, bucket, replacedHigherUnlogged),
      });
    }
  }

  return {
    selectedRuns,
    maxRunsPerDungeon,
    allowedDungeonCount: allowed.size,
  };
}
