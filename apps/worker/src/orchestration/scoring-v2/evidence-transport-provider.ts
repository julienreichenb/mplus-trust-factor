/**
 * Production Scoring V2 evidence transport — uses the WCL provider abstraction.
 * Never called from calculators or provider-free finalization paths.
 */

import type { ProviderFetchContext } from "@mplus/contracts";
import {
  InMemorySharedEvidenceStore,
  ingestSharedEvidenceBundle,
  type SharedEvidenceDatasetKey,
  type WclRunEvidenceBundle,
} from "@mplus/provider-warcraftlogs";
import type { WorkerContainer } from "../../container.js";
import type {
  ScoringV2EvidenceTransport,
  ScoringV2FightDetailsResult,
  ScoringV2ProfilePayloadResult,
  ScoringV2RankingParseResult,
  ScoringV2SharedEvidenceResult,
} from "./evidence-transport.js";

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

/**
 * Provider-backed transport. Shared evidence uses LiveWarcraftLogsProvider GraphQL
 * when available; otherwise returns UNAVAILABLE (no invented work).
 */
export function createProviderBackedEvidenceTransport(
  container: WorkerContainer,
): ScoringV2EvidenceTransport {
  const store = new InMemorySharedEvidenceStore();

  return {
    async getReportFightDetails(input): Promise<ScoringV2FightDetailsResult> {
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
    },

    async acquireSharedEvidence(input): Promise<ScoringV2SharedEvidenceResult> {
      const wcl = container.providers.warcraftlogs as {
        getGraphQlClient?: () => unknown;
      };
      if (typeof wcl.getGraphQlClient !== "function") {
        // Fixture provider / stub — shared event acquisition not available via contract.
        return {
          bundle: null,
          providerCalls: 0,
          cacheHits: 0,
          unavailableReason: "shared_evidence_provider_capability_absent",
        };
      }

      const client = wcl.getGraphQlClient();
      const before = store.providerFetchCount;
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
      const providerCalls = Math.max(0, store.providerFetchCount - before);
      return {
        bundle,
        providerCalls: providerCalls > 0 ? providerCalls : bundle.accounting.providerCalls,
        cacheHits: bundle.accounting.cacheHits + bundle.accounting.persistedHits,
        unavailableReason: null,
      };
    },

    async getRankingParse(input): Promise<ScoringV2RankingParseResult> {
      // RANKING_PARSE is not yet a first-class WarcraftLogsProvider method.
      // Acquisition records UNAVAILABLE rather than inventing an unplanned fetch.
      void input;
      return {
        evidence: null,
        providerCalls: 0,
        unavailableReason: "ranking_parse_provider_capability_absent",
      };
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
