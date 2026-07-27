import type {
  ScoringRunSelection,
  ScoringRunSelectionReason,
  ScoringSelectedRun,
} from "@mplus/contracts";
import type { SeasonDungeonSet } from "@mplus/mechanics";

/** Candidate run for per-dungeon canonical selection. */
export interface SelectableScoringRun {
  id: string;
  dungeonSlug: string;
  seasonSlug: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  durationMs: number | null;
  raiderIoScore: number | null;
  wclReportMatched: boolean;
  wclCoverageRatio: number | null;
}

export interface SelectScoringRunsInput {
  season: SeasonDungeonSet;
  runs: SelectableScoringRun[];
  observedAt?: string;
  /**
   * When true, drop runs whose seasonSlug does not match the active season.
   * Default true — enforces no out-of-season runs in the eight-run set.
   */
  enforceSeasonSlug?: boolean;
}

function timedRank(timed: boolean | null): number {
  if (timed === true) return 2;
  if (timed === false) return 0;
  return 1;
}

function completedMs(run: SelectableScoringRun): number {
  const ms = Date.parse(run.completedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Compare two runs for canonical selection.
 * Order: highest key → higher score → better timed state → latest completion.
 */
export function compareSelectableRuns(a: SelectableScoringRun, b: SelectableScoringRun): number {
  if (b.keyLevel !== a.keyLevel) return b.keyLevel - a.keyLevel;
  const aScore = a.raiderIoScore ?? Number.NEGATIVE_INFINITY;
  const bScore = b.raiderIoScore ?? Number.NEGATIVE_INFINITY;
  if (bScore !== aScore) return bScore - aScore;
  const timedDelta = timedRank(b.timed) - timedRank(a.timed);
  if (timedDelta !== 0) return timedDelta;
  return completedMs(b) - completedMs(a);
}

function selectionReason(
  winner: SelectableScoringRun,
  contenders: SelectableScoringRun[],
): ScoringRunSelectionReason {
  const others = contenders.filter((r) => r.id !== winner.id);
  if (others.every((r) => r.keyLevel < winner.keyLevel)) return "HIGHEST_KEY";
  const sameKey = contenders.filter((r) => r.keyLevel === winner.keyLevel);
  if (sameKey.length === 1) return "HIGHEST_KEY";
  const winnerScore = winner.raiderIoScore ?? Number.NEGATIVE_INFINITY;
  const scoreBeats = sameKey.some((r) => {
    if (r.id === winner.id) return false;
    const score = r.raiderIoScore ?? Number.NEGATIVE_INFINITY;
    return score < winnerScore;
  });
  const scoreTied = sameKey.every((r) => (r.raiderIoScore ?? null) === (winner.raiderIoScore ?? null));
  if (!scoreTied && scoreBeats) return "HIGHEST_SCORE_TIEBREAK";
  if (!scoreTied) {
    const maxOther = Math.max(
      ...sameKey.filter((r) => r.id !== winner.id).map((r) => r.raiderIoScore ?? Number.NEGATIVE_INFINITY),
    );
    if (winnerScore > maxOther) return "HIGHEST_SCORE_TIEBREAK";
  }
  return "LATEST_TIEBREAK";
}

function toSelected(run: SelectableScoringRun, reason: ScoringRunSelectionReason): ScoringSelectedRun {
  const rejectionReasons: string[] = [];
  if (!run.wclReportMatched) {
    rejectionReasons.push("wcl_detail_unavailable_on_highest_run");
  }
  return {
    dungeonSlug: run.dungeonSlug,
    canonicalRunId: run.id,
    keyLevel: run.keyLevel,
    timed: run.timed,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    raiderIoScore: run.raiderIoScore,
    wclReportMatched: run.wclReportMatched,
    wclCoverageRatio: run.wclCoverageRatio,
    detailAvailable: run.wclReportMatched,
    selectionReason: reason,
    rejectionReasons,
  };
}

/**
 * Select exactly one canonical run per expected dungeon.
 * Never demotes an unlogged highest run in favor of a lower logged run.
 */
export function selectScoringRuns(input: SelectScoringRunsInput): ScoringRunSelection {
  const enforceSeason = input.enforceSeasonSlug !== false;
  const expected = [...input.season.dungeonSlugs];
  const observedAt = input.observedAt ?? new Date().toISOString();

  const byDungeon = new Map<string, SelectableScoringRun[]>();
  for (const run of input.runs) {
    if (enforceSeason && run.seasonSlug !== input.season.seasonSlug) continue;
    const key = run.dungeonSlug.toLowerCase();
    const list = byDungeon.get(key) ?? [];
    list.push(run);
    byDungeon.set(key, list);
  }

  const selectedRuns: ScoringSelectedRun[] = [];
  const missingDungeonSlugs: string[] = [];

  for (const dungeonSlug of expected) {
    const contenders = byDungeon.get(dungeonSlug.toLowerCase()) ?? [];
    if (contenders.length === 0) {
      missingDungeonSlugs.push(dungeonSlug);
      continue;
    }
    const sorted = [...contenders].sort(compareSelectableRuns);
    const winner = sorted[0]!;
    // Explicit invariant: never prefer a lower key just because it has WCL.
    const highestKey = Math.max(...contenders.map((r) => r.keyLevel));
    if (winner.keyLevel < highestKey) {
      throw new Error(
        `Selection invariant broken for ${dungeonSlug}: chose key ${winner.keyLevel} below highest ${highestKey}`,
      );
    }
    const loggedLower = contenders.find(
      (r) => r.wclReportMatched && r.keyLevel < winner.keyLevel && !winner.wclReportMatched,
    );
    if (loggedLower && winner.keyLevel === highestKey && !winner.wclReportMatched) {
      // Keep winner — detail unavailable is the correct outcome.
    }
    selectedRuns.push(toSelected(winner, selectionReason(winner, contenders)));
  }

  const expectedCount = input.season.expectedDungeonCount || expected.length || 8;
  const detailAvailableCount = selectedRuns.filter((r) => r.detailAvailable).length;
  const selectionConfidence =
    expectedCount === 0
      ? 0
      : (selectedRuns.length / expectedCount) * 0.7 +
        (selectedRuns.length === 0 ? 0 : detailAvailableCount / selectedRuns.length) * 0.3;

  return {
    seasonSlug: input.season.seasonSlug,
    expectedDungeonCount: expectedCount,
    expectedDungeonSlugs: expected,
    selectedRuns,
    missingDungeonSlugs,
    selectionConfidence: Math.min(1, Math.max(0, selectionConfidence)),
    observedAt,
  };
}
