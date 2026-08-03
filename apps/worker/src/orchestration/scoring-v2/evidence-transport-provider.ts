/**
 * Production Scoring V2 evidence transport — persistent DB/CAS before WCL.
 * In-memory L1 is optional; Redis singleflight + permits bound provider work.
 */

import type { ProviderFetchContext } from "@mplus/contracts";
import {
  InMemorySharedEvidenceStore,
  ingestSharedEvidenceBundle,
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  type SharedEvidenceDatasetKey,
  type WclRunEvidenceBundle,
} from "@mplus/provider-warcraftlogs";
import type { WorkerContainer } from "../../container.js";
import {
  acquireGlobalWclHttpPermit,
  acquireSourceSingleflight,
  completeSourceSingleflight,
  releaseGlobalWclHttpPermit,
  releaseSourceSingleflight,
  wclSingleflightKey,
  type WclConcurrencyRedis,
} from "./wcl-concurrency/permits.js";
import { createPersistentSharedEvidenceStore } from "./persistent-shared-evidence-store.js";
import type {
  ScoringV2EvidenceTransport,
  ScoringV2FightDetailsResult,
  ScoringV2ProfilePayloadResult,
  ScoringV2RankingParseResult,
  ScoringV2SharedEvidenceResult,
} from "./evidence-transport.js";
import { ScoringV2RateDeferError } from "./acquisition.js";
import { randomUUID } from "node:crypto";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function revisionFromFightDetails(data: unknown): number {
  const payload = asRecord(data);
  if (!payload) return 0;
  if (typeof payload.reportRevision === "number") return payload.reportRevision;
  if (typeof payload.revision === "number") return payload.revision;
  const report = asRecord(payload.report);
  if (report && typeof report.revision === "number") return report.revision;
  return 0;
}

function actorFromFightDetails(data: unknown): {
  playerActorId: number | null;
  ownedPetActorIds: number[];
  startTime: number | null;
  endTime: number | null;
  dungeonSlug: string | null;
} {
  const payload = asRecord(data);
  const fight = asRecord(payload?.fight);
  const combatFacts = asRecord(payload?.combatFacts);
  const playerActorId =
    typeof combatFacts?.playerActorId === "number"
      ? combatFacts.playerActorId
      : typeof fight?.playerActorId === "number"
        ? fight.playerActorId
        : null;
  const ownedPetActorIds = Array.isArray(combatFacts?.ownedPetActorIds)
    ? (combatFacts.ownedPetActorIds.filter(
        (id): id is number => typeof id === "number",
      ) as number[])
    : [];
  return {
    playerActorId,
    ownedPetActorIds,
    startTime:
      typeof fight?.startTime === "number"
        ? fight.startTime
        : typeof fight?.startTimeMs === "number"
          ? fight.startTimeMs
          : null,
    endTime:
      typeof fight?.endTime === "number"
        ? fight.endTime
        : typeof fight?.endTimeMs === "number"
          ? fight.endTimeMs
          : null,
    dungeonSlug: typeof fight?.name === "string" ? null : null,
  };
}

export interface ProviderBackedTransportOptions {
  characterId?: string | null;
  /** When false, skip Redis permits (tests). Default true when redis available. */
  useDistributedPermits?: boolean;
}

/**
 * Provider-backed transport with persistent cache → singleflight → WCL.
 */
export function createProviderBackedEvidenceTransport(
  container: WorkerContainer,
  options: ProviderBackedTransportOptions = {},
): ScoringV2EvidenceTransport {
  const l1 = new InMemorySharedEvidenceStore();
  const store = createPersistentSharedEvidenceStore({
    wclSource: container.repositories.wclSource,
    artifacts: container.repositories.artifacts,
    l1,
  });
  const usePermits = options.useDistributedPermits !== false;
  void options.characterId;

  async function withGlobalWclHttpPermit<T>(work: () => Promise<T>): Promise<T> {
    if (!usePermits) return work();
    const redisConn = container.createRedisConnection();
    const redis = redisConn as unknown as WclConcurrencyRedis;
    const ownerId = randomUUID();
    let globalToken: string | null = null;
    try {
      const global = await acquireGlobalWclHttpPermit({
        redis,
        appEnv: container.env.APP_ENV,
        ownerId: `http:${ownerId}`,
      });
      if (!global.ok) {
        throw new ScoringV2RateDeferError(
          `global_wcl_permit_unavailable:${global.reason}`,
          5_000,
        );
      }
      globalToken = global.token;
      return await work();
    } finally {
      if (globalToken) {
        await releaseGlobalWclHttpPermit({
          redis,
          appEnv: container.env.APP_ENV,
          ownerId: `http:${ownerId}`,
          token: globalToken,
        }).catch(() => undefined);
      }
      await redisConn.quit().catch(() => undefined);
    }
  }

  return {
    async getReportFightDetails(input): Promise<ScoringV2FightDetailsResult> {
      return withGlobalWclHttpPermit(async () => {
        const result = await container.providers.warcraftlogs.getReportFightDetails(
          input.reportCode,
          input.fightId,
          input.ctx,
        );
        const data = result.data;
        const meta = actorFromFightDetails(data);
        return {
          data,
          reportRevision: revisionFromFightDetails(data),
          playerActorId: meta.playerActorId,
          ownedPetActorIds: meta.ownedPetActorIds,
          startTime: meta.startTime,
          endTime: meta.endTime,
          dungeonSlug: meta.dungeonSlug,
          providerCalls: result.metadata.cacheHit ? 0 : 1,
        };
      });
    },

    async acquireSharedEvidence(input): Promise<ScoringV2SharedEvidenceResult> {
      const wcl = container.providers.warcraftlogs as {
        getGraphQlClient?: () => unknown;
      };
      if (typeof wcl.getGraphQlClient !== "function") {
        return {
          bundle: null,
          providerCalls: 0,
          cacheHits: 0,
          unavailableReason: "shared_evidence_provider_capability_absent",
        };
      }

      // Persistent cache probe before any WCL / permit acquisition.
      const existing = await store.loadBundleSummary?.(
        input.reportCode,
        input.fightId,
        input.reportRevision,
      );
      // Even without a full bundle summary, ingest will load per-dataset pages.
      // Singleflight per primary dataset identity for the run.
      const redisConn = usePermits ? container.createRedisConnection() : null;
      const redis = redisConn as unknown as WclConcurrencyRedis | null;
      const sfKey = redis
        ? wclSingleflightKey(
            container.env.APP_ENV,
            input.reportCode,
            input.fightId,
            input.reportRevision,
            "shared-bundle",
          )
        : null;
      let sfToken: string | null = null;

      try {
        if (redis && sfKey) {
          const sf = await acquireSourceSingleflight({ redis, key: sfKey });
          if (sf.role === "ready") {
            // Winner already persisted — re-load from persistent store (provider-free).
            const bundle = await ingestSharedEvidenceBundle({
              client: null,
              store,
              reportCode: input.reportCode,
              reportRevision: input.reportRevision,
              fightId: input.fightId,
              playerActorId: input.playerActorId,
              ownedPetActorIds: input.ownedPetActorIds,
              dungeonSlug: input.dungeonSlug,
              startTime: input.startTime,
              endTime: input.endTime,
              consumers: ["survival", "utility"],
              datasets: input.datasetKeys as SharedEvidenceDatasetKey[],
              region: input.ctx.region,
              localOnly: true,
            });
            return {
              bundle,
              providerCalls: 0,
              cacheHits: bundle.accounting.cacheHits + bundle.accounting.persistedHits + 1,
              unavailableReason: null,
            };
          }
          if (sf.role === "waiter") {
            // Bounded wait then reload persistence (no busy-loop).
            await new Promise((r) => setTimeout(r, 250));
            const bundle = await ingestSharedEvidenceBundle({
              client: null,
              store,
              reportCode: input.reportCode,
              reportRevision: input.reportRevision,
              fightId: input.fightId,
              playerActorId: input.playerActorId,
              ownedPetActorIds: input.ownedPetActorIds,
              dungeonSlug: input.dungeonSlug,
              startTime: input.startTime,
              endTime: input.endTime,
              consumers: ["survival", "utility"],
              datasets: input.datasetKeys as SharedEvidenceDatasetKey[],
              region: input.ctx.region,
              localOnly: true,
            });
            const complete =
              bundle.completeness.missing.length === 0 &&
              Object.keys(bundle.eventDatasets).length > 0;
            if (complete) {
              return {
                bundle,
                providerCalls: 0,
                cacheHits: bundle.accounting.persistedHits + 1,
                unavailableReason: null,
              };
            }
            // Fall through: become owner after release, or fetch remaining.
          }
          if (sf.role === "owner") {
            sfToken = sf.token;
            // Re-check persistence after acquiring ownership.
            const pre = await ingestSharedEvidenceBundle({
              client: null,
              store,
              reportCode: input.reportCode,
              reportRevision: input.reportRevision,
              fightId: input.fightId,
              playerActorId: input.playerActorId,
              ownedPetActorIds: input.ownedPetActorIds,
              dungeonSlug: input.dungeonSlug,
              startTime: input.startTime,
              endTime: input.endTime,
              consumers: ["survival", "utility"],
              datasets: input.datasetKeys as SharedEvidenceDatasetKey[],
              region: input.ctx.region,
              localOnly: true,
            });
            if (
              pre.completeness.missing.length === 0 &&
              Object.keys(pre.eventDatasets).length > 0
            ) {
              await completeSourceSingleflight({
                redis,
                key: sfKey,
                token: sfToken,
                value: "persisted",
              });
              sfToken = null;
              return {
                bundle: pre,
                providerCalls: 0,
                cacheHits: pre.accounting.persistedHits + 1,
                unavailableReason: null,
              };
            }
          }
        }

        void existing;
        void WCL_RUN_EVIDENCE_PROVIDER_CONTRACT;

        return await withGlobalWclHttpPermit(async () => {
          const client = wcl.getGraphQlClient!();
          const before = l1.providerFetchCount;
          const bundle: WclRunEvidenceBundle = await ingestSharedEvidenceBundle({
            client: client as never,
            store,
            reportCode: input.reportCode,
            reportRevision: input.reportRevision,
            fightId: input.fightId,
            playerActorId: input.playerActorId,
            ownedPetActorIds: input.ownedPetActorIds,
            dungeonSlug: input.dungeonSlug,
            startTime: input.startTime,
            endTime: input.endTime,
            consumers: ["survival", "utility"],
            datasets: input.datasetKeys as SharedEvidenceDatasetKey[],
            region: input.ctx.region,
          });
          const providerCalls = Math.max(0, l1.providerFetchCount - before);
          if (redis && sfKey && sfToken) {
            await completeSourceSingleflight({
              redis,
              key: sfKey,
              token: sfToken,
              value: "persisted",
            });
            sfToken = null;
          }
          return {
            bundle,
            providerCalls:
              providerCalls > 0 ? providerCalls : bundle.accounting.providerCalls,
            cacheHits: bundle.accounting.cacheHits + bundle.accounting.persistedHits,
            unavailableReason: null,
          };
        });
      } finally {
        if (redis && sfKey && sfToken) {
          await releaseSourceSingleflight({ redis, key: sfKey, token: sfToken }).catch(
            () => undefined,
          );
        }
        if (redisConn) await redisConn.quit().catch(() => undefined);
      }
    },

    async getRankingParse(input): Promise<ScoringV2RankingParseResult> {
      const wcl = container.providers.warcraftlogs as {
        getRankingParseForFight?: (args: {
          reportCode: string;
          fightId: number;
          reportRevision: number;
          dungeonSlug: string;
          keyLevel: number | null;
          ctx: ProviderFetchContext;
        }) => Promise<{
          evidence: ScoringV2RankingParseResult["evidence"];
          providerCalls: number;
          unavailableReason: string | null;
        }>;
      };
      if (typeof wcl.getRankingParseForFight !== "function") {
        return {
          evidence: null,
          providerCalls: 0,
          unavailableReason: "ranking_parse_provider_capability_absent",
        };
      }
      return withGlobalWclHttpPermit(async () => {
        const result = await wcl.getRankingParseForFight!({
          reportCode: input.reportCode,
          fightId: input.fightId,
          reportRevision: input.reportRevision,
          dungeonSlug: input.dungeonSlug,
          keyLevel: input.keyLevel,
          ctx: input.ctx,
        });
        return {
          evidence: result.evidence,
          providerCalls: result.providerCalls,
          unavailableReason: result.unavailableReason,
        };
      });
    },

    async getPointsAndDamageProfile(
      _input: { ctx: ProviderFetchContext },
    ): Promise<ScoringV2ProfilePayloadResult> {
      return {
        payload: null,
        providerCalls: 0,
        unavailableReason: "points_and_damage_provider_capability_absent",
      };
    },
  };
}
