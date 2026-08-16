import type { BoostDungeonContext, BoostRunInput } from "./types.js";

export function dungeonContextBySlug(
  contexts: BoostDungeonContext[] | undefined,
): Map<string, BoostDungeonContext> {
  const map = new Map<string, BoostDungeonContext>();
  for (const ctx of contexts ?? []) {
    map.set(ctx.dungeonSlug.trim().toLowerCase(), ctx);
  }
  return map;
}

export function isDungeonBehaviourAnalysable(
  dungeonSlug: string | null | undefined,
  contexts: BoostDungeonContext[] | undefined,
): boolean {
  if (!contexts || contexts.length === 0) return true;
  if (!dungeonSlug) return true;
  const ctx = dungeonContextBySlug(contexts).get(dungeonSlug.trim().toLowerCase());
  if (!ctx) return true;
  return ctx.topPublicEvidenceAvailable;
}

export function analysableRuns(
  runs: BoostRunInput[],
  contexts: BoostDungeonContext[] | undefined,
): BoostRunInput[] {
  return runs.filter((run) => isDungeonBehaviourAnalysable(run.dungeonSlug, contexts));
}

export function primaryAnalysableRuns(
  runs: BoostRunInput[],
  contexts: BoostDungeonContext[] | undefined,
): BoostRunInput[] {
  return analysableRuns(runs, contexts).filter((r) => r.slotIndex !== 1);
}
