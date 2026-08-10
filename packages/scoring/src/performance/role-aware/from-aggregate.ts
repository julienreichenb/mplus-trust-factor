/**
 * Map persisted role-aware aggregate → scoring channel facts.
 */

import type {
  PersistedCharacterPerformanceAggregateV2,
  PersistedThroughputChannelV2,
} from "@mplus/contracts";
import type { PerformanceThroughputChannelFact } from "./types.js";

function channelFactFromPersisted(
  channel: PersistedThroughputChannelV2,
  kind: "damage" | "healing",
  activeDungeonSlugs?: readonly string[],
): PerformanceThroughputChannelFact {
  const active = activeDungeonSlugs != null ? new Set(activeDungeonSlugs) : null;
  const perDungeon = channel.dungeonAggregates
    .filter((d) => (active == null ? true : active.has(d.dungeonSlug)))
    .map((d) => ({
      dungeonSlug: d.dungeonSlug,
      bestParsePercentile: d.bestParsePercentile,
      medianParsePercentile: d.medianParsePercentile,
      specialization: d.specialization,
      bestThroughputAmount: d.bestDps,
    }));

  return {
    kind,
    metric: channel.metric,
    perDungeon,
    bestPercentileAverage: channel.bestPercentileAverage,
    medianPercentileAverage: channel.medianPercentileAverage,
    partition: channel.partition,
    zoneId: channel.zoneId,
    totalLoggedRuns: channel.totalLoggedRuns,
    observedSpecs: channel.observedSpecs,
    specBinding: channel.specBinding,
  };
}

export function throughputChannelsFromPersistedV2(input: {
  compact: PersistedCharacterPerformanceAggregateV2;
  activeDungeonSlugs?: readonly string[];
}): {
  damage: PerformanceThroughputChannelFact;
  healing: PerformanceThroughputChannelFact | null;
  role: PersistedCharacterPerformanceAggregateV2["role"];
  targetSpecSlug: string | null;
} {
  return {
    damage: channelFactFromPersisted(
      input.compact.damage,
      "damage",
      input.activeDungeonSlugs,
    ),
    healing: input.compact.healing
      ? channelFactFromPersisted(
          input.compact.healing,
          "healing",
          input.activeDungeonSlugs,
        )
      : null,
    role: input.compact.role,
    targetSpecSlug: input.compact.targetSpecSlug,
  };
}
