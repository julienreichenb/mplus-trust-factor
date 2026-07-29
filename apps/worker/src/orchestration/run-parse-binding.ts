import type { WclRankingObservation } from "@mplus/provider-warcraftlogs";
import { ENCOUNTER_DUNGEON_MAP } from "@mplus/provider-warcraftlogs";
import { canonicalDungeonKey } from "./run-fusion.js";

export interface SelectedRunParseBinding {
  runId: string;
  dungeonSlug: string;
  reportCode: string | null;
  fightId: number | null;
  parsePercentile: number | null;
  rankPercent: number | null;
  bracketPercent: number | null;
  parseAvailable: boolean;
  parseUnavailableReason: string | null;
}

export function bindParseToSelectedRun(input: {
  runId: string;
  dungeonSlug: string;
  reportCode: string | null;
  fightId: number | null;
  rankings: WclRankingObservation[];
}): SelectedRunParseBinding {
  const dungeonKey = canonicalDungeonKey(input.dungeonSlug);
  const exact =
    input.reportCode && input.fightId != null
      ? input.rankings.find(
          (r) => r.reportCode === input.reportCode && r.fightId === input.fightId,
        )
      : null;

  if (exact) {
    const parsePercentile = exact.rankPercent ?? exact.bracketPercent ?? exact.percentile;
    return {
      runId: input.runId,
      dungeonSlug: input.dungeonSlug,
      reportCode: input.reportCode,
      fightId: input.fightId,
      parsePercentile,
      rankPercent: exact.rankPercent,
      bracketPercent: exact.bracketPercent,
      parseAvailable: parsePercentile != null,
      parseUnavailableReason: parsePercentile == null ? "ranking_row_missing_percentiles" : null,
    };
  }

  const byDungeon = input.rankings.filter((r) => {
    const slug = ENCOUNTER_DUNGEON_MAP[r.encounterId];
    return slug != null && canonicalDungeonKey(slug) === dungeonKey;
  });

  if (byDungeon.length === 0) {
    return {
      runId: input.runId,
      dungeonSlug: input.dungeonSlug,
      reportCode: input.reportCode,
      fightId: input.fightId,
      parsePercentile: null,
      rankPercent: null,
      bracketPercent: null,
      parseAvailable: false,
      parseUnavailableReason: input.reportCode
        ? "no_matching_fight_ranking_row"
        : "no_wcl_source_on_selected_run",
    };
  }

  const best = [...byDungeon].sort(
    (a, b) => (b.rankPercent ?? b.percentile ?? 0) - (a.rankPercent ?? a.percentile ?? 0),
  )[0]!;
  const parsePercentile = best.rankPercent ?? best.bracketPercent ?? best.percentile;

  return {
    runId: input.runId,
    dungeonSlug: input.dungeonSlug,
    reportCode: input.reportCode,
    fightId: input.fightId,
    parsePercentile,
    rankPercent: best.rankPercent,
    bracketPercent: best.bracketPercent,
    parseAvailable: parsePercentile != null,
    parseUnavailableReason:
      parsePercentile == null
        ? "dungeon_ranking_without_percentile"
        : "fallback_dungeon_ranking_not_fight_bound",
  };
}
