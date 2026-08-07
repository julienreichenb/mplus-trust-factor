/**
 * Product refresh → scoreCharacter(). Single authoritative scoring path.
 * No legacy calculateScore, no V1/V2 branching, no supersession.
 */
import type { EvidenceCandidateMetadataV2, EvidenceRole } from "@mplus/contracts";
import type { ScoreSnapshotDTO } from "@mplus/contracts";
import { hashRefreshContract } from "@mplus/contracts";
import type { WorkerContainer } from "../../container.js";
import { scoreCharacter, type ScoreCharacterResult } from "./score-character.js";
import { scoreCharacterResultToSnapshotDto } from "./snapshot-from-character-score.js";
import { createLiveCapabilityAcquireHook, observeAuthoritativeReportRevision } from "./run-orchestration/live-capability-adapter.js";
import { createRedisSourceFightLock } from "./run-orchestration/source-fight-lease.js";
import { createProductionRunOrchestrationPorts } from "./run-orchestration/production-ports.js";
import type { RunOrchestrationPorts } from "./run-orchestration/orchestrator.js";
import type { FetchCharacterPerformanceAggregateProvider } from "./run-orchestration/ensure-performance-aggregate.js";
import {
  requirePositivePerformanceAggregateTtlSeconds,
  requireScoringZoneId,
} from "./scoring-zone.js";
import { findLatestFightRevision } from "./fight-details-persist.js";

export interface AuthoritativeScoringInput {
  container: WorkerContainer;
  characterId: string;
  seasonId: string;
  seasonSlug: string;
  role: EvidenceRole;
  classSlug: string | null;
  specSlug: string | null;
  refreshContract: Parameters<typeof hashRefreshContract>[0];
  evidenceCutoffAt: string;
  highKeyPolicyId: string;
  activeDungeonSlugs: string[];
  candidates: EvidenceCandidateMetadataV2[];
  scoreModelKey: string;
  scoreModelVersion: number;
  scoreModelId: string;
  calculatedAt: string;
  region: string;
  realm: string;
  characterName: string;
  /**
   * When false, scoreCharacter evaluates without writing CharacterScore.
   * Default true (operational refresh / recalculate).
   */
  persistCharacterScore?: boolean;
  /** Optional frozen ScoreModel.config override for evaluation. */
  scoreModelConfig?: Record<string, unknown> | null;
  /** Test seam. */
  portsOverride?: RunOrchestrationPorts;
  /** Test seam for aggregate provider. */
  performanceAggregateProviderOverride?: FetchCharacterPerformanceAggregateProvider | null;
}

export interface AuthoritativeScoringResult {
  disabled: boolean;
  snapshot: ScoreSnapshotDTO;
  scoreResult: ScoreCharacterResult | null;
  providerCalls: number;
}

function resolvePerformanceAggregateProvider(
  container: WorkerContainer,
): FetchCharacterPerformanceAggregateProvider | null {
  const wcl = container.providers.warcraftlogs as unknown as {
    fetchCharacterPerformanceAggregate?: FetchCharacterPerformanceAggregateProvider["fetchCharacterPerformanceAggregate"];
  } | null;
  if (wcl && typeof wcl.fetchCharacterPerformanceAggregate === "function") {
    return {
      fetchCharacterPerformanceAggregate: wcl.fetchCharacterPerformanceAggregate.bind(wcl),
    };
  }
  return null;
}

/**
 * Sole product scoring entry used by character refresh and recalculate jobs.
 *
 * Always runs scoreCharacter (canonical acquisition + evaluation). Do not gate
 * product refresh on SCORING_ENABLED — that historically returned grade U and
 * left refresh on the legacy pre-selection WCL path. Publication remains gated
 * by SCORING_PUBLICATION_ENABLED inside scoreCharacter / snapshot mapping.
 */
export async function runAuthoritativeScoring(
  input: AuthoritativeScoringInput,
): Promise<AuthoritativeScoringResult> {
  const fingerprint = `scoring:${input.characterId}:${input.seasonId}:${hashRefreshContract(input.refreshContract)}`;

  input.container.logger.info(
    {
      event: "REFRESH_PHASE",
      phase: "SCORING",
      characterId: input.characterId,
      seasonId: input.seasonId,
      persistCharacterScore: input.persistCharacterScore !== false,
      scoringEnabledFlag: input.container.env.SCORING_ENABLED,
    },
    "REFRESH_PHASE",
  );

  const zoneId = requireScoringZoneId(input.refreshContract.zoneId);
  const partition =
    input.refreshContract.partition === undefined
      ? null
      : input.refreshContract.partition;
  const ttlSeconds = requirePositivePerformanceAggregateTtlSeconds(
    input.container.env.WCL_CHARACTER_TTL_SECONDS ?? 43_200,
  );

  const allowProviderCalls =
    input.container.env.ALLOW_LIVE_PROVIDER_CALLS === true &&
    input.container.env.PROVIDER_MODE === "live" &&
    input.container.env.WCL_ENABLED === true;

  let liveAcquire:
    | Parameters<typeof scoreCharacter>[0]["liveAcquire"]
    | undefined;
  let resolveReportRevision: RunOrchestrationPorts["resolveReportRevision"];
  if (allowProviderCalls && !input.portsOverride) {
    const wcl = input.container.providers.warcraftlogs as
      | { getGraphQlClient?: () => Parameters<typeof createLiveCapabilityAcquireHook>[0]["client"] }
      | null
      | undefined;
    if (wcl && typeof wcl.getGraphQlClient === "function") {
      const client = wcl.getGraphQlClient();
      liveAcquire = createLiveCapabilityAcquireHook({
        env: input.container.env,
        prisma: input.container.prisma,
        artifacts: input.container.repositories.artifacts,
        wclSource: input.container.repositories.wclSource,
        client,
        region: input.region,
        permission: {
          providerMode: input.container.env.PROVIDER_MODE,
          wclEnabled: input.container.env.WCL_ENABLED,
          allowLiveProviderCalls: true,
          liveProviderPermissionGranted: true,
          scoringPublicationEnabled:
            input.container.env.SCORING_PUBLICATION_ENABLED,
          hasWclCredentials: Boolean(
            input.container.env.WCL_CLIENT_ID &&
              input.container.env.WCL_CLIENT_SECRET,
          ),
        },
      });
      resolveReportRevision = async ({ reportCode, fightId }) => {
        const persisted = await findLatestFightRevision({
          wclSource: input.container.repositories.wclSource,
          reportCode,
          fightId,
        });
        if (persisted != null && Number.isFinite(persisted) && persisted >= 0) {
          return { reportRevision: persisted, providerCalls: 0 };
        }
        return observeAuthoritativeReportRevision({
          client,
          reportCode,
          fightId,
          region: input.region,
        });
      };
    }
  }

  let ports = input.portsOverride;
  if (!ports) {
    const basePorts = createProductionRunOrchestrationPorts({
      prisma: input.container.prisma,
      artifacts: input.container.repositories.artifacts,
      evidence: input.container.repositories.evidence,
      liveAcquireCapabilityPackage: liveAcquire,
      targetCharacter: {
        characterId: input.characterId,
        characterName: input.characterName,
        realmSlug: input.realm,
        regionCode: input.region,
        classSlug: input.classSlug,
        specSlug: input.specSlug,
        role: input.role,
      },
    });
    const redis = input.container.createRedisConnection();
    const withSourceFightLock = createRedisSourceFightLock({
      redis,
      appEnv:
        input.container.env.APP_ENV ??
        input.container.env.NODE_ENV ??
        "development",
      findCompatiblePackage: (args) =>
        basePorts.findCompatibleCapabilityPackage(args),
    });
    ports = {
      ...basePorts,
      withSourceFightLock,
      ...(resolveReportRevision ? { resolveReportRevision } : {}),
    };
  }

  const performanceAggregateProvider =
    input.performanceAggregateProviderOverride !== undefined
      ? input.performanceAggregateProviderOverride
      : allowProviderCalls
        ? resolvePerformanceAggregateProvider(input.container)
        : null;

  const scoreResult = await scoreCharacter({
    identity: {
      characterId: input.characterId,
      region: input.region,
      realm: input.realm,
      characterName: input.characterName,
    },
    seasonId: input.seasonId,
    seasonSlug: input.seasonSlug,
    role: input.role,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    activeDungeonSlugs: input.activeDungeonSlugs,
    candidates: input.candidates,
    evidenceCutoffAt: input.evidenceCutoffAt,
    highKeyPolicyId: input.highKeyPolicyId,
    scoringModelId: input.scoreModelId,
    scoringModelVersion: String(input.scoreModelVersion),
    allowProviderCalls,
    publicationEnabled: input.container.env.SCORING_PUBLICATION_ENABLED,
    persistCharacterScore: input.persistCharacterScore,
    scoreModelConfig: input.scoreModelConfig,
    ports,
    prisma: input.container.prisma,
    artifacts: input.container.repositories.artifacts,
    evidence: input.container.repositories.evidence,
    liveAcquire,
    zoneId,
    partition,
    performanceAggregateTtlSeconds: ttlSeconds,
    performanceAggregateProvider,
  });

  return {
    disabled: false,
    snapshot: scoreCharacterResultToSnapshotDto({
      result: scoreResult,
      characterId: input.characterId,
      seasonSlug: input.seasonSlug,
      scoreModelKey: input.scoreModelKey,
      scoreModelVersion: input.scoreModelVersion,
      calculatedAt: input.calculatedAt,
      inputFingerprint: fingerprint,
      publicationEnabled: input.container.env.SCORING_PUBLICATION_ENABLED,
    }),
    scoreResult,
    providerCalls: scoreResult.providerCalls,
  };
}
