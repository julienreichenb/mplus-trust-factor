/**
 * Align canary/replay with scoreCharacter's CharacterPerformanceAggregate V2 path.
 */
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import type { EvidenceRole, RegionCode } from "@mplus/contracts";
import {
  throughputChannelsFromPersistedV2,
  type PerformanceThroughputChannelFact,
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
  role: EvidenceRole;
  specSlug: string | null;
  activeDungeonSlugs: readonly string[];
  liveProviderPermission: LiveProviderPermission;
  now?: Date;
}): Promise<{
  throughputChannels: {
    damage: PerformanceThroughputChannelFact;
    healing: PerformanceThroughputChannelFact | null;
  } | null;
  /** @deprecated Prefer throughputChannels */
  profileAggregate: null;
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
    role: input.role,
    specSlug: input.specSlug,
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

  const throughputChannels =
    result.state === "AVAILABLE" && result.data != null
      ? (() => {
          const mapped = throughputChannelsFromPersistedV2({
            compact: result.data.compact,
            activeDungeonSlugs: input.activeDungeonSlugs,
          });
          return { damage: mapped.damage, healing: mapped.healing };
        })()
      : null;

  return { throughputChannels, profileAggregate: null, ensure: result };
}
