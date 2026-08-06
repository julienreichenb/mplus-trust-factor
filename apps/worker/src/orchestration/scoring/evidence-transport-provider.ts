/**
 * Production Scoring V2 evidence transport — persistent DB/CAS before WCL.
 * In-memory L1 is optional; Redis singleflight + permits bound provider work.
 */

import type { ProviderFetchContext } from "@mplus/contracts";
import {
  ingestSharedEvidenceBundle,
  InMemorySharedEvidenceStore,
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  isDurableSharedEvidenceBundle,
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
  ScoringEvidenceTransport,
  ScoringFightDetailsResult,
  ScoringProfilePayloadResult,
  ScoringRankingParseResult,
  ScoringSharedEvidenceResult,
} from "./evidence-transport.js";
import {
  findLatestFightRevision,
  loadPersistedFightDetails,
  persistFightDetailsPage,
} from "./fight-details-persist.js";
import { ScoringRateDeferError } from "./acquisition.js";
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
  fightFriendlyPlayerActorIds: number[];
  targetInFight: boolean;
  ownershipRejectionReason:
    | "TARGET_NOT_IN_REPORT"
    | "TARGET_NOT_IN_FIGHT"
    | "TARGET_AMBIGUOUS"
    | "FIGHT_NOT_MYTHIC_PLUS"
    | "FIGHT_INCOMPLETE"
    | null;
} {
  const payload = asRecord(data);
  const fight = asRecord(payload?.fight);
  const combatFacts = asRecord(payload?.combatFacts);

  // RunCombatFacts uses targetSourceId / attributedSourceIds — not playerActorId.
  const targetSourceId =
    typeof combatFacts?.targetSourceId === "number" ? combatFacts.targetSourceId : null;
  const fightTargetActorId =
    typeof fight?.targetActorId === "number" ? fight.targetActorId : null;
  const legacyPlayerActorId =
    typeof combatFacts?.playerActorId === "number"
      ? combatFacts.playerActorId
      : typeof fight?.playerActorId === "number"
        ? fight.playerActorId
        : null;
  const playerActorId = targetSourceId ?? fightTargetActorId ?? legacyPlayerActorId;

  const attributedSourceIds = Array.isArray(combatFacts?.attributedSourceIds)
    ? (combatFacts.attributedSourceIds.filter(
        (id): id is number => typeof id === "number",
      ) as number[])
    : [];
  const legacyOwnedPets = Array.isArray(combatFacts?.ownedPetActorIds)
    ? (combatFacts.ownedPetActorIds.filter(
        (id): id is number => typeof id === "number",
      ) as number[])
    : [];
  const ownedPetActorIds =
    attributedSourceIds.length > 0 && playerActorId != null
      ? attributedSourceIds.filter((id) => id !== playerActorId)
      : legacyOwnedPets;

  const fightFriendlyPlayerActorIds = Array.isArray(fight?.fightFriendlyPlayerActorIds)
    ? (fight.fightFriendlyPlayerActorIds.filter(
        (id): id is number => typeof id === "number",
      ) as number[])
    : Array.isArray(fight?.friendlyPlayers)
      ? fight.friendlyPlayers
          .map((entry) => {
            if (typeof entry === "number") return entry;
            const row = asRecord(entry);
            return typeof row?.id === "number" ? row.id : null;
          })
          .filter((id): id is number => id != null)
      : [];

  const targetInFight =
    typeof fight?.targetInFight === "boolean"
      ? fight.targetInFight
      : playerActorId != null && fightFriendlyPlayerActorIds.includes(playerActorId);

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
    fightFriendlyPlayerActorIds,
    targetInFight,
    ownershipRejectionReason: targetInFight ? null : "TARGET_NOT_IN_FIGHT",
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
): ScoringEvidenceTransport {
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
        throw new ScoringRateDeferError(
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
    async getReportFightDetails(input): Promise<ScoringFightDetailsResult> {
      const wclSource = container.repositories.wclSource;
      const artifacts = container.repositories.artifacts;
      const revisionHint =
        typeof input.expectedReportRevision === "number"
          ? input.expectedReportRevision
          : await findLatestFightRevision({
              wclSource,
              reportCode: input.reportCode,
              fightId: input.fightId,
            });

      if (revisionHint != null) {
        const cached = await loadPersistedFightDetails({
          wclSource,
          artifacts,
          reportCode: input.reportCode,
          fightId: input.fightId,
          reportRevision: revisionHint,
          targetActorId: input.expectedActorId ?? null,
        });
        if (cached) {
          const meta = actorFromFightDetails(cached.data);
          // Refuse cross-character reuse even if a page was stored under a shared key.
          if (
            input.expectedActorId != null &&
            meta.playerActorId != null &&
            meta.playerActorId !== input.expectedActorId
          ) {
            // Fall through to live fetch / null cache.
          } else {
            return {
              data: cached.data,
              reportRevision: cached.reportRevision,
              playerActorId: meta.playerActorId,
              ownedPetActorIds: meta.ownedPetActorIds,
              startTime: meta.startTime,
              endTime: meta.endTime,
              dungeonSlug: meta.dungeonSlug,
              fightFriendlyPlayerActorIds: meta.fightFriendlyPlayerActorIds,
              targetInFight: meta.targetInFight,
              ownershipRejectionReason: meta.ownershipRejectionReason,
              providerCalls: 0,
            };
          }
        }
      }

      return withGlobalWclHttpPermit(async () => {
        const result = await container.providers.warcraftlogs.getReportFightDetails(
          input.reportCode,
          input.fightId,
          input.ctx,
        );
        const data = result.data;
        const reportRevision = revisionFromFightDetails(data);
        const meta = actorFromFightDetails(data);
        if (data != null && reportRevision >= 0) {
          try {
            await persistFightDetailsPage({
              wclSource,
              artifacts,
              reportCode: input.reportCode,
              fightId: input.fightId,
              reportRevision,
              data,
            });
          } catch {
            // Persistence failure must not block acquisition.
          }
        }
        return {
          data,
          reportRevision,
          playerActorId: meta.playerActorId,
          ownedPetActorIds: meta.ownedPetActorIds,
          startTime: meta.startTime,
          endTime: meta.endTime,
          dungeonSlug: meta.dungeonSlug,
          fightFriendlyPlayerActorIds: meta.fightFriendlyPlayerActorIds,
          targetInFight: meta.targetInFight,
          ownershipRejectionReason: meta.ownershipRejectionReason,
          providerCalls: result.metadata.cacheHit ? 0 : 1,
        };
      });
    },

    async acquireSharedEvidence(input): Promise<ScoringSharedEvidenceResult> {
      const wcl = container.providers.warcraftlogs as {
        getGraphQlClient?: () => unknown;
      };
      if (typeof wcl.getGraphQlClient !== "function") {
        return {
          bundle: null,
          providerCalls: 0,
          cacheHits: 0,
          singleflightReuse: 0,
          pointsConsumed: null,
          pages: 0,
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
            if (
              isDurableSharedEvidenceBundle(
                bundle,
                input.datasetKeys as SharedEvidenceDatasetKey[],
              )
            ) {
              return {
                bundle,
                providerCalls: 0,
                cacheHits: bundle.accounting.cacheHits + bundle.accounting.persistedHits + 1,
                singleflightReuse: 1,
                pointsConsumed: bundle.accounting.pointsConsumed,
                pages: bundle.accounting.pages,
                unavailableReason: null,
              };
            }
            // Incomplete / page-less — fall through to fetch owner path.
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
            if (
              isDurableSharedEvidenceBundle(
                bundle,
                input.datasetKeys as SharedEvidenceDatasetKey[],
              )
            ) {
              return {
                bundle,
                providerCalls: 0,
                cacheHits: bundle.accounting.persistedHits + 1,
                singleflightReuse: 1,
                pointsConsumed: bundle.accounting.pointsConsumed,
                pages: bundle.accounting.pages,
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
              isDurableSharedEvidenceBundle(
                pre,
                input.datasetKeys as SharedEvidenceDatasetKey[],
              )
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
                singleflightReuse: 0,
                pointsConsumed: pre.accounting.pointsConsumed,
                pages: pre.accounting.pages,
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
            singleflightReuse: 0,
            pointsConsumed: bundle.accounting.pointsConsumed,
            pages: bundle.accounting.pages,
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

    async getRankingParse(input): Promise<ScoringRankingParseResult> {
      const wcl = container.providers.warcraftlogs as {
        getRankingParseForFight?: (args: {
          reportCode: string;
          fightId: number;
          reportRevision: number;
          dungeonSlug: string;
          keyLevel: number | null;
          ctx: ProviderFetchContext;
        }) => Promise<{
          evidence: ScoringRankingParseResult["evidence"];
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
    ): Promise<ScoringProfilePayloadResult> {
      return {
        payload: null,
        providerCalls: 0,
        unavailableReason: "points_and_damage_provider_capability_absent",
      };
    },
  };
}
