/**
 * Align canary/replay with scoreCharacter's CharacterPerformanceAggregate path.
 */
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import type { RegionCode } from "@mplus/contracts";
import {
  profileAggregateFactFromPersisted,
  type PerformanceProfileAggregateFactV2,
} from "@mplus/scoring";
import { LiveWarcraftLogsProvider } from "@mplus/provider-warcraftlogs";
import {
  createEnsureCharacterPerformanceAggregate,
  type EnsureCharacterPerformanceAggregateResult,
} from "../run-orchestration/ensure-performance-aggregate.js";
import type { LiveProviderPermission } from "../run-orchestration/orchestrator.js";

const DEFAULT_TTL_SECONDS = 43_200;

export async function ensureCanaryProfileAggregate(input: {
  prisma: PrismaClient;
  env: AppEnv;
  characterId: string;
  characterName: string;
  region: string;
  realm: string;
  seasonId: string;
  zoneId: number;
  activeDungeonSlugs: readonly string[];
  liveProviderPermission: LiveProviderPermission;
  now?: Date;
}): Promise<{
  profileAggregate: PerformanceProfileAggregateFactV2 | null;
  ensure: EnsureCharacterPerformanceAggregateResult;
}> {
  const ensure = createEnsureCharacterPerformanceAggregate({ prisma: input.prisma });
  const region = input.region.toUpperCase() as RegionCode;
  const allowLive = input.liveProviderPermission === "ALLOWED";
  const provider = allowLive
    ? (() => {
        const wcl = new LiveWarcraftLogsProvider({
          env: input.env,
          zoneId: input.zoneId,
        });
        return {
          fetchCharacterPerformanceAggregate: (
            args: Parameters<
              LiveWarcraftLogsProvider["fetchCharacterPerformanceAggregate"]
            >[0],
          ) => wcl.fetchCharacterPerformanceAggregate(args),
        };
      })()
    : null;

  const result = await ensure({
    characterId: input.characterId,
    seasonId: input.seasonId,
    zoneId: input.zoneId,
    partition: null,
    character: {
      name: input.characterName,
      realmSlug: input.realm,
      region,
    },
    now: input.now ?? new Date(),
    liveProviderPermission: input.liveProviderPermission,
    ttlSeconds:
      typeof input.env.WCL_CHARACTER_TTL_SECONDS === "number" &&
      input.env.WCL_CHARACTER_TTL_SECONDS > 0
        ? input.env.WCL_CHARACTER_TTL_SECONDS
        : DEFAULT_TTL_SECONDS,
    provider,
  });

  const profileAggregate =
    result.state === "AVAILABLE" && result.data != null
      ? profileAggregateFactFromPersisted({
          dungeonAggregates: result.data.dungeonAggregates,
          global:
            result.data.globalSummary ?? result.data.compact.global,
          activeDungeonSlugs: input.activeDungeonSlugs,
        })
      : null;

  return { profileAggregate, ensure: result };
}
