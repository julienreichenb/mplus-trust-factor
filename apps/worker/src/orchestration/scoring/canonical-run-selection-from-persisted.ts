/**
 * Architecture A for RECALCULATE_ONLY:
 * Rebuild the canonical 8-run ScoringRunSelection from persisted MythicRun
 * evidence via selectScoringRuns. No providers, no EvidenceManifest 16-slot
 * list, no CharacterScore.selectedRuns digest, no ScoreSnapshot authority.
 *
 * Incomplete persisted coverage yields an incomplete selection; applyScoreContext
 * then marks INCOMPLETE_SELECTION / UNKNOWN. Evidence is never fabricated.
 */
import { selectScoringRuns, type ScoringRunSelection } from "@mplus/scoring";
import { canonicalDungeonKey, sourceRefHasWcl } from "../run-fusion.js";

export interface PersistedMythicRunForCanonicalSelection {
  id: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: Date;
  durationMs: number | null;
  scoreValue: number | null;
  dungeon: { slug: string };
  sources: Array<{ provider: string }>;
}

export function selectCanonicalRunsFromPersistedMythicRuns(input: {
  seasonSlug: string;
  expectedDungeonCount: number;
  allowedDungeonSlugs: string[];
  persistedRuns: PersistedMythicRunForCanonicalSelection[];
}): ScoringRunSelection {
  const candidates = input.persistedRuns.map((run) => ({
    canonicalRunId: run.id,
    dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
    keyLevel: run.keyLevel,
    timed: run.timed,
    completedAt: run.completedAt.toISOString(),
    durationMs: run.durationMs,
    scoreValue: run.scoreValue,
    hasWclSource: run.sources.some((s) => sourceRefHasWcl(s.provider)),
  }));
  return selectScoringRuns(candidates, {
    seasonSlug: input.seasonSlug,
    expectedDungeonCount: input.expectedDungeonCount,
    allowedDungeonSlugs: input.allowedDungeonSlugs,
  });
}
