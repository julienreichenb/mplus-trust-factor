/**
 * Map persisted CharacterPerformanceAggregate → Performance profile fact.
 */

import type {
  PersistedCharacterPerformanceAggregateV1,
  PersistedDungeonPerformanceAggregateV1,
} from "@mplus/contracts";
import type { PerformanceProfileAggregateFactV2 } from "../v2/types.js";

export function profileAggregateFactFromPersisted(input: {
  dungeonAggregates: readonly PersistedDungeonPerformanceAggregateV1[];
  global: PersistedCharacterPerformanceAggregateV1["global"];
  activeDungeonSlugs?: readonly string[];
}): PerformanceProfileAggregateFactV2 | null {
  const global = input.global;
  if (global == null) return null;

  const active =
    input.activeDungeonSlugs != null
      ? new Set(input.activeDungeonSlugs)
      : null;

  const perDungeon = input.dungeonAggregates
    .filter((d) => (active == null ? true : active.has(d.dungeonSlug)))
    .map((d) => ({
      dungeonSlug: d.dungeonSlug,
      bestParsePercentile: d.bestParsePercentile,
      medianParsePercentile: d.medianParsePercentile,
      loggedRunCount: d.loggedRunCount ?? 0,
    }));

  const best = global.bestDpsPercentileAverage;
  const median = global.medianDpsPercentileAverage;
  const bestOk = best != null && Number.isFinite(best);
  const medianOk = median != null && Number.isFinite(median);
  if (!bestOk && !medianOk && perDungeon.length === 0) {
    return null;
  }

  return {
    bestDpsPercentileAverage: bestOk ? best! : null,
    medianDpsPercentileAverage: medianOk ? median! : null,
    perDungeon,
    partition: global.partition,
    zoneId: global.zoneId,
    totalLoggedRuns: global.totalLoggedRuns,
    latestObservedAt: null,
  };
}
