/**
 * Production port: ensure CharacterPerformanceAggregate for scoring.
 *
 * Live: fresh cache hit → return; else dedicated WCL points_and_damage fetch → persist.
 * Provider-free replay: load compatible persisted aggregate (expired OK); never call provider.
 *
 * Consumed by functional Performance Phase 2 (`performance-phase2-v1`) as the profile stabilizer.
 * Does not change Utility / Survival numerical formulas.
 */
import type { PrismaClient } from "@mplus/database";
import {
  CharacterPerformanceAggregateRepository,
  type CharacterPerformanceAggregateDTO,
} from "@mplus/database";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  type CharacterIdentityInput,
  type RegionCode,
} from "@mplus/contracts";
import {
  toPersistedPerformanceAggregate,
  toPerformanceAggregatePartitionKey,
  type PointsAndDamagePerformanceRecord,
} from "@mplus/provider-warcraftlogs";
import type { LiveProviderPermission } from "./orchestrator.js";

export interface FetchCharacterPerformanceAggregateProvider {
  fetchCharacterPerformanceAggregate(input: {
    character: CharacterIdentityInput;
    zoneId: number;
    partition: number | null;
    ctx: {
      region: RegionCode;
      requestId: string;
      correlationId: string | null;
      forceRefresh: boolean;
      now: string;
      targetCharacter?: CharacterIdentityInput;
    };
  }): Promise<{
    record: PointsAndDamagePerformanceRecord | {
      state: PointsAndDamagePerformanceRecord["state"];
      adapterVersion: string;
      metric: "points_and_damage";
      raw: unknown;
      dungeonAggregates: PointsAndDamagePerformanceRecord["dungeonAggregates"];
      global: PointsAndDamagePerformanceRecord["global"];
      diagnostics: PointsAndDamagePerformanceRecord["diagnostics"];
      normalized?: PointsAndDamagePerformanceRecord["normalized"];
    };
    rawPayload: unknown;
    sourceRequestFingerprint: string;
    providerCalls: number;
  }>;
}

export interface EnsureCharacterPerformanceAggregateInput {
  characterId: string;
  seasonId: string;
  zoneId: number;
  partition: number | null;
  character: {
    name: string;
    realmSlug: string;
    region: RegionCode;
  };
  now: Date;
  liveProviderPermission: LiveProviderPermission;
  ttlSeconds: number;
  requestId?: string;
  correlationId?: string | null;
  provider?: FetchCharacterPerformanceAggregateProvider | null;
}

export type EnsureCharacterPerformanceAggregateResult =
  | {
      state: "AVAILABLE";
      data: CharacterPerformanceAggregateDTO;
      reason: null;
      cache: "HIT" | "MISS" | "REPLAY";
      providerCalls: number;
      created: boolean;
      updated: boolean;
      aggregateRowId: string;
      contentHash: string;
    }
  | {
      state: "UNAVAILABLE";
      data: null;
      reason: string;
      cache: "MISS" | "INCOMPATIBLE";
      providerCalls: number;
      created: false;
      updated: false;
      aggregateRowId: null;
      contentHash: null;
    };

export function createEnsureCharacterPerformanceAggregate(deps: {
  prisma: PrismaClient;
}): (
  input: EnsureCharacterPerformanceAggregateInput,
) => Promise<EnsureCharacterPerformanceAggregateResult> {
  const repo = new CharacterPerformanceAggregateRepository(deps.prisma);

  return async function ensureCharacterPerformanceAggregate(
    input: EnsureCharacterPerformanceAggregateInput,
  ): Promise<EnsureCharacterPerformanceAggregateResult> {
    const rankingVersion = CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION;
    const partitionKey = toPerformanceAggregatePartitionKey(input.partition);
    const identity = {
      characterId: input.characterId,
      seasonId: input.seasonId,
      zoneId: input.zoneId,
      partitionKey,
      rankingVersion,
    };

    if (input.liveProviderPermission === "FORBIDDEN") {
      const replay = await repo.findCompatibleForReplay(identity);
      if (!replay) {
        return {
          state: "UNAVAILABLE",
          data: null,
          reason: "performance_aggregate_unavailable_replay",
          cache: "MISS",
          providerCalls: 0,
          created: false,
          updated: false,
          aggregateRowId: null,
          contentHash: null,
        };
      }
      return {
        state: "AVAILABLE",
        data: replay,
        reason: null,
        cache: "REPLAY",
        providerCalls: 0,
        created: false,
        updated: false,
        aggregateRowId: replay.id,
        contentHash: replay.contentHash,
      };
    }

    const live = await repo.findCompatibleLive({ ...identity, now: input.now });
    if (live) {
      return {
        state: "AVAILABLE",
        data: live,
        reason: null,
        cache: "HIT",
        providerCalls: 0,
        created: false,
        updated: false,
        aggregateRowId: live.id,
        contentHash: live.contentHash,
      };
    }

    if (!input.provider?.fetchCharacterPerformanceAggregate) {
      return {
        state: "UNAVAILABLE",
        data: null,
        reason: "performance_aggregate_provider_absent",
        cache: "MISS",
        providerCalls: 0,
        created: false,
        updated: false,
        aggregateRowId: null,
        contentHash: null,
      };
    }

    const characterIdentity: CharacterIdentityInput = {
      name: input.character.name,
      realmSlug: input.character.realmSlug,
      region: input.character.region,
    };
    const fetched = await input.provider.fetchCharacterPerformanceAggregate({
      character: characterIdentity,
      zoneId: input.zoneId,
      partition: input.partition,
      ctx: {
        region: input.character.region,
        requestId: input.requestId ?? `perf-agg:${input.characterId}`,
        correlationId: input.correlationId ?? null,
        forceRefresh: false,
        now: input.now.toISOString(),
        targetCharacter: characterIdentity,
      },
    });

    if (fetched.record.state !== "OK") {
      return {
        state: "UNAVAILABLE",
        data: null,
        reason: `performance_aggregate_provider_${fetched.record.state.toLowerCase()}`,
        cache: "MISS",
        providerCalls: fetched.providerCalls,
        created: false,
        updated: false,
        aggregateRowId: null,
        contentHash: null,
      };
    }

    let compact;
    try {
      compact = toPersistedPerformanceAggregate({
        record: fetched.record as PointsAndDamagePerformanceRecord,
        zoneId: input.zoneId,
        partition: input.partition,
      });
    } catch (error) {
      return {
        state: "UNAVAILABLE",
        data: null,
        reason:
          error instanceof Error
            ? error.message
            : "performance_aggregate_normalize_failed",
        cache: "INCOMPATIBLE",
        providerCalls: fetched.providerCalls,
        created: false,
        updated: false,
        aggregateRowId: null,
        contentHash: null,
      };
    }

    const expiresAt = new Date(
      input.now.getTime() + Math.max(1, input.ttlSeconds) * 1000,
    );
    const upserted = await repo.upsert({
      characterId: input.characterId,
      seasonId: input.seasonId,
      zoneId: input.zoneId,
      partition: input.partition,
      rankingVersion,
      rawPayload: fetched.rawPayload,
      compact,
      sourceRequestFingerprint: fetched.sourceRequestFingerprint,
      fetchedAt: input.now,
      expiresAt,
    });

    return {
      state: "AVAILABLE",
      data: upserted.row,
      reason: null,
      cache: "MISS",
      providerCalls: fetched.providerCalls,
      created: upserted.created,
      updated: upserted.updated,
      aggregateRowId: upserted.row.id,
      contentHash: upserted.row.contentHash,
    };
  };
}
