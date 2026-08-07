import type { Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  assertPersistedCharacterPerformanceAggregateV1,
  hashPerformanceAggregateContent,
  toPerformanceAggregatePartitionKey,
  type PersistedCharacterPerformanceAggregateV1,
  type PersistedDungeonPerformanceAggregateV1,
  type PersistedPerformanceAggregateDiagnosticsV1,
  type PersistedPerformanceAggregateGlobalV1,
} from "@mplus/contracts";

export interface CharacterPerformanceAggregateIdentity {
  characterId: string;
  seasonId: string;
  zoneId: number;
  partitionKey: string;
  rankingVersion: string;
}

export interface CharacterPerformanceAggregateDTO {
  id: string;
  characterId: string;
  seasonId: string;
  zoneId: number;
  partitionKey: string;
  rankingVersion: string;
  metric: string;
  state: "OK";
  rawPayload: unknown;
  dungeonAggregates: PersistedDungeonPerformanceAggregateV1[];
  globalSummary: PersistedPerformanceAggregateGlobalV1 | null;
  diagnostics: PersistedPerformanceAggregateDiagnosticsV1;
  contentHash: string;
  sourceRequestFingerprint: string;
  fetchedAt: Date;
  expiresAt: Date;
  compact: PersistedCharacterPerformanceAggregateV1;
}

export interface UpsertCharacterPerformanceAggregateInput {
  characterId: string;
  seasonId: string;
  zoneId: number;
  partition: number | null;
  rankingVersion?: string;
  rawPayload: unknown;
  compact: PersistedCharacterPerformanceAggregateV1;
  sourceRequestFingerprint: string;
  fetchedAt: Date;
  expiresAt: Date;
}

export interface UpsertCharacterPerformanceAggregateResult {
  row: CharacterPerformanceAggregateDTO;
  created: boolean;
  updated: boolean;
  /** True when an older fetch lost to a newer persisted row. */
  rejectedStale: boolean;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function partitionFromKey(partitionKey: string): number | null {
  if (partitionKey === "current") return null;
  const match = /^partition:(\d+)$/.exec(partitionKey);
  if (!match) {
    throw new Error(
      `performance_aggregate_incompatible: partitionKey=${partitionKey}`,
    );
  }
  return Number(match[1]);
}

function contentHashForRow(row: {
  rankingVersion: string;
  metric: string;
  zoneId: number;
  partitionKey: string;
  dungeonAggregates: unknown;
  globalSummary: unknown;
  diagnostics: unknown;
  sourceRequestFingerprint: string;
}): string {
  const compact = assertPersistedCharacterPerformanceAggregateV1({
    state: "OK",
    adapterVersion: row.rankingVersion,
    metric: row.metric,
    zoneId: row.zoneId,
    partition: partitionFromKey(row.partitionKey),
    dungeonAggregates: row.dungeonAggregates,
    global: row.globalSummary,
    diagnostics: row.diagnostics,
  });
  return hashPerformanceAggregateContent({
    rankingVersion: row.rankingVersion,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    zoneId: row.zoneId,
    partitionKey: row.partitionKey,
    dungeonAggregates: compact.dungeonAggregates,
    global: compact.global,
    diagnostics: compact.diagnostics,
    sourceRequestFingerprint: row.sourceRequestFingerprint,
  });
}

function toDto(row: {
  id: string;
  characterId: string;
  seasonId: string;
  zoneId: number;
  partitionKey: string;
  rankingVersion: string;
  metric: string;
  state: string;
  rawPayload: unknown;
  dungeonAggregates: unknown;
  globalSummary: unknown;
  diagnostics: unknown;
  contentHash: string;
  sourceRequestFingerprint: string;
  fetchedAt: Date;
  expiresAt: Date;
}): CharacterPerformanceAggregateDTO {
  if (row.state !== "OK") {
    throw new Error(
      `performance_aggregate_incompatible: stored state=${row.state}`,
    );
  }
  if (row.rankingVersion !== CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION) {
    throw new Error(
      `performance_aggregate_incompatible: rankingVersion=${row.rankingVersion}`,
    );
  }
  const compact = assertPersistedCharacterPerformanceAggregateV1({
    state: "OK",
    adapterVersion: row.rankingVersion,
    metric: row.metric,
    zoneId: row.zoneId,
    partition: partitionFromKey(row.partitionKey),
    dungeonAggregates: row.dungeonAggregates,
    global: row.globalSummary,
    diagnostics: row.diagnostics,
  });

  const expectedHash = contentHashForRow(row);
  if (expectedHash !== row.contentHash) {
    throw new Error(
      "performance_aggregate_incompatible: content_hash_mismatch",
    );
  }

  return {
    id: row.id,
    characterId: row.characterId,
    seasonId: row.seasonId,
    zoneId: row.zoneId,
    partitionKey: row.partitionKey,
    rankingVersion: row.rankingVersion,
    metric: row.metric,
    state: "OK",
    rawPayload: row.rawPayload,
    dungeonAggregates: compact.dungeonAggregates,
    globalSummary: compact.global,
    diagnostics: compact.diagnostics,
    contentHash: row.contentHash,
    sourceRequestFingerprint: row.sourceRequestFingerprint,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
    compact,
  };
}

type AggregateTx = Pick<PrismaClient, "characterPerformanceAggregate" | "$queryRaw">;

export class CharacterPerformanceAggregateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Live cache lookup: identity + version + valid contract + non-expired.
   */
  async findCompatibleLive(input: {
    characterId: string;
    seasonId: string;
    zoneId: number;
    partitionKey: string;
    rankingVersion: string;
    now: Date;
  }): Promise<CharacterPerformanceAggregateDTO | null> {
    const row = await this.prisma.characterPerformanceAggregate.findUnique({
      where: {
        characterId_seasonId_zoneId_partitionKey_rankingVersion: {
          characterId: input.characterId,
          seasonId: input.seasonId,
          zoneId: input.zoneId,
          partitionKey: input.partitionKey,
          rankingVersion: input.rankingVersion,
        },
      },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= input.now.getTime()) return null;
    try {
      return toDto(row);
    } catch {
      return null;
    }
  }

  /**
   * Provider-free replay: same identity/version validation, expired rows allowed.
   */
  async findCompatibleForReplay(input: {
    characterId: string;
    seasonId: string;
    zoneId: number;
    partitionKey: string;
    rankingVersion: string;
  }): Promise<CharacterPerformanceAggregateDTO | null> {
    const row = await this.prisma.characterPerformanceAggregate.findUnique({
      where: {
        characterId_seasonId_zoneId_partitionKey_rankingVersion: {
          characterId: input.characterId,
          seasonId: input.seasonId,
          zoneId: input.zoneId,
          partitionKey: input.partitionKey,
          rankingVersion: input.rankingVersion,
        },
      },
    });
    if (!row) return null;
    try {
      return toDto(row);
    } catch {
      return null;
    }
  }

  /**
   * Upsert by unique identity. Never overwrites a newer fetchedAt with an older one.
   * Rejects malformed compact aggregates before persistence.
   */
  async upsert(
    input: UpsertCharacterPerformanceAggregateInput,
  ): Promise<UpsertCharacterPerformanceAggregateResult> {
    const rankingVersion =
      input.rankingVersion ?? CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION;
    const compact = assertPersistedCharacterPerformanceAggregateV1(input.compact);
    if (compact.state !== "OK") {
      throw new Error("cannot_persist_non_ok_performance_aggregate");
    }
    const partitionKey = toPerformanceAggregatePartitionKey(input.partition);
    // Provisional hash from in-memory compact. Postgres jsonb may rewrite IEEE
    // floats (e.g. bestDps); finalize contentHash from the RETURNING row below.
    const provisionalHash = hashPerformanceAggregateContent({
      rankingVersion,
      metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      zoneId: input.zoneId,
      partitionKey,
      dungeonAggregates: compact.dungeonAggregates,
      global: compact.global,
      diagnostics: compact.diagnostics,
      sourceRequestFingerprint: input.sourceRequestFingerprint,
    });

    const runOnce = async (
      tx: AggregateTx,
    ): Promise<UpsertCharacterPerformanceAggregateResult> => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; fetched_at: Date }>
      >`
        SELECT id, fetched_at
        FROM character_performance_aggregates
        WHERE character_id = ${input.characterId}::uuid
          AND season_id = ${input.seasonId}::uuid
          AND zone_id = ${input.zoneId}
          AND partition_key = ${partitionKey}
          AND ranking_version = ${rankingVersion}
        FOR UPDATE
      `;
      const existing = locked[0];

      const finalize = async (row: {
        id: string;
        characterId: string;
        seasonId: string;
        zoneId: number;
        partitionKey: string;
        rankingVersion: string;
        metric: string;
        state: string;
        rawPayload: unknown;
        dungeonAggregates: unknown;
        globalSummary: unknown;
        diagnostics: unknown;
        contentHash: string;
        sourceRequestFingerprint: string;
        fetchedAt: Date;
        expiresAt: Date;
      }) => {
        const contentHash = contentHashForRow(row);
        if (contentHash === row.contentHash) return row;
        return tx.characterPerformanceAggregate.update({
          where: { id: row.id },
          data: { contentHash },
        });
      };

      if (!existing) {
        const created = await tx.characterPerformanceAggregate.create({
          data: {
            characterId: input.characterId,
            seasonId: input.seasonId,
            zoneId: input.zoneId,
            partitionKey,
            rankingVersion,
            metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
            state: "OK",
            rawPayload: input.rawPayload as Prisma.InputJsonValue,
            dungeonAggregates:
              compact.dungeonAggregates as unknown as Prisma.InputJsonValue,
            globalSummary:
              (compact.global as unknown as Prisma.InputJsonValue) ?? undefined,
            diagnostics:
              compact.diagnostics as unknown as Prisma.InputJsonValue,
            contentHash: provisionalHash,
            sourceRequestFingerprint: input.sourceRequestFingerprint,
            fetchedAt: input.fetchedAt,
            expiresAt: input.expiresAt,
          },
        });
        const finalized = await finalize(created);
        return {
          row: toDto(finalized),
          created: true,
          updated: false,
          rejectedStale: false,
        };
      }

      if (existing.fetched_at.getTime() > input.fetchedAt.getTime()) {
        const kept = await tx.characterPerformanceAggregate.findUniqueOrThrow({
          where: { id: existing.id },
        });
        return {
          row: toDto(kept),
          created: false,
          updated: false,
          rejectedStale: true,
        };
      }

      const updated = await tx.characterPerformanceAggregate.update({
        where: { id: existing.id },
        data: {
          metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
          state: "OK",
          rawPayload: input.rawPayload as Prisma.InputJsonValue,
          dungeonAggregates:
            compact.dungeonAggregates as unknown as Prisma.InputJsonValue,
          globalSummary:
            (compact.global as unknown as Prisma.InputJsonValue) ?? undefined,
          diagnostics: compact.diagnostics as unknown as Prisma.InputJsonValue,
          contentHash: provisionalHash,
          sourceRequestFingerprint: input.sourceRequestFingerprint,
          fetchedAt: input.fetchedAt,
          expiresAt: input.expiresAt,
        },
      });
      const finalized = await finalize(updated);
      return {
        row: toDto(finalized),
        created: false,
        updated: true,
        rejectedStale: false,
      };
    };

    try {
      return await this.prisma.$transaction((tx) => runOnce(tx));
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return this.prisma.$transaction((tx) => runOnce(tx));
    }
  }
}

export function createCharacterPerformanceAggregateRepository(
  prisma: PrismaClient,
): CharacterPerformanceAggregateRepository {
  return new CharacterPerformanceAggregateRepository(prisma);
}
