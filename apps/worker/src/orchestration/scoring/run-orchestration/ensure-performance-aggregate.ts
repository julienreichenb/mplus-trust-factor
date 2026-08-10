/**
 * Production port: ensure CharacterPerformanceAggregate V2 for scoring.
 *
 * Live: fresh cache hit → return; else dedicated WCL role-aware fetch → persist.
 * Provider-free replay: load compatible persisted aggregate (expired OK); never call provider.
 *
 * DPS/Tank: one GraphQL op (damage). Healer: one aliased GraphQL op (healing+damage).
 */
import type { PrismaClient } from "@mplus/database";
import {
  CharacterPerformanceAggregateRepository,
  type CharacterPerformanceAggregateDTO,
} from "@mplus/database";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  type CharacterIdentityInput,
  type EvidenceRole,
  type PersistedCharacterPerformanceAggregateV2,
  type RegionCode,
  toPerformanceAggregatePartitionKey,
} from "@mplus/contracts";
import type { LiveProviderPermission } from "./orchestrator.js";

export interface FetchCharacterPerformanceAggregateProvider {
  fetchCharacterPerformanceAggregate(input: {
    character: CharacterIdentityInput;
    zoneId: number;
    partition: number | null;
    role: "DPS" | "TANK" | "HEALER";
    specSlug: string | null;
    ctx: {
      region: RegionCode;
      requestId: string;
      correlationId: string | null;
      forceRefresh: boolean;
      now: string;
      targetCharacter?: CharacterIdentityInput;
    };
  }): Promise<{
    record: {
      state: "OK" | "ERROR" | "SCHEMA_UNSUPPORTED" | "SKIPPED" | "EMPTY";
      adapterVersion: string;
      metric: string;
      compact: PersistedCharacterPerformanceAggregateV2 | null | unknown;
      raw: unknown;
      errorMessage?: string;
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
  role: EvidenceRole;
  specSlug: string | null;
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

function toScoringRole(
  role: EvidenceRole,
): "DPS" | "TANK" | "HEALER" | null {
  if (role === "DPS" || role === "TANK" || role === "HEALER") return role;
  return null;
}

export function createEnsureCharacterPerformanceAggregate(deps: {
  prisma: PrismaClient;
}): (
  input: EnsureCharacterPerformanceAggregateInput,
) => Promise<EnsureCharacterPerformanceAggregateResult> {
  const repo = new CharacterPerformanceAggregateRepository(deps.prisma);

  return async function ensureCharacterPerformanceAggregate(
    input: EnsureCharacterPerformanceAggregateInput,
  ): Promise<EnsureCharacterPerformanceAggregateResult> {
    const scoringRole = toScoringRole(input.role);
    if (scoringRole == null) {
      return {
        state: "UNAVAILABLE",
        data: null,
        reason: "performance_aggregate_role_unknown",
        cache: "INCOMPATIBLE",
        providerCalls: 0,
        created: false,
        updated: false,
        aggregateRowId: null,
        contentHash: null,
      };
    }

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
      role: scoringRole,
      specSlug: input.specSlug,
      ctx: {
        region: input.character.region,
        requestId: input.requestId ?? `perf-agg:${input.characterId}`,
        correlationId: input.correlationId ?? null,
        forceRefresh: false,
        now: input.now.toISOString(),
        targetCharacter: characterIdentity,
      },
    });

    if (fetched.record.state !== "OK" || fetched.record.compact == null) {
      return {
        state: "UNAVAILABLE",
        data: null,
        reason:
          fetched.record.errorMessage ??
          `performance_aggregate_provider_${fetched.record.state.toLowerCase()}`,
        cache: "MISS",
        providerCalls: fetched.providerCalls,
        created: false,
        updated: false,
        aggregateRowId: null,
        contentHash: null,
      };
    }

    const compact = fetched.record.compact as PersistedCharacterPerformanceAggregateV2;

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
