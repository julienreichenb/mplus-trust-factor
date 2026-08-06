/**
 * Product refresh → scoreCharacter(). Single authoritative scoring path.
 * No legacy calculateScore, no V1/V2 branching, no supersession.
 */
import type { EvidenceCandidateMetadataV2, EvidenceRole } from "@mplus/contracts";
import type { ScoreSnapshotDTO } from "@mplus/contracts";
import { hashRefreshContract } from "@mplus/contracts";
import type { WorkerContainer } from "../../container.js";
import { scoreCharacter, type ScoreCharacterResult } from "./score-character.js";
import {
  scoreCharacterResultToSnapshotDto,
  scoringDisabledSnapshotDto,
} from "./snapshot-from-character-score.js";
import { createLiveCapabilityAcquireHook } from "./run-orchestration/live-capability-adapter.js";
import { createRedisSourceFightLock } from "./run-orchestration/source-fight-lease.js";
import { createProductionRunOrchestrationPorts } from "./run-orchestration/production-ports.js";
import type { RunOrchestrationPorts } from "./run-orchestration/orchestrator.js";

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
  /** Test seam. */
  portsOverride?: RunOrchestrationPorts;
}

export interface AuthoritativeScoringResult {
  disabled: boolean;
  snapshot: ScoreSnapshotDTO;
  scoreResult: ScoreCharacterResult | null;
  providerCalls: number;
}

/**
 * Sole product scoring entry used by character refresh and recalculate jobs.
 */
export async function runAuthoritativeScoring(
  input: AuthoritativeScoringInput,
): Promise<AuthoritativeScoringResult> {
  const fingerprint = `scoring:${input.characterId}:${input.seasonId}:${hashRefreshContract(input.refreshContract)}`;

  if (!input.container.env.SCORING_ENABLED) {
    return {
      disabled: true,
      snapshot: scoringDisabledSnapshotDto({
        characterId: input.characterId,
        seasonSlug: input.seasonSlug,
        scoreModelKey: input.scoreModelKey,
        scoreModelVersion: input.scoreModelVersion,
        calculatedAt: input.calculatedAt,
        inputFingerprint: fingerprint,
      }),
      scoreResult: null,
      providerCalls: 0,
    };
  }

  const allowProviderCalls =
    input.container.env.ALLOW_LIVE_PROVIDER_CALLS === true &&
    input.container.env.PROVIDER_MODE === "live" &&
    input.container.env.WCL_ENABLED === true;

  let liveAcquire:
    | Parameters<typeof scoreCharacter>[0]["liveAcquire"]
    | undefined;
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
    };
  }

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
    ports,
    prisma: input.container.prisma,
    artifacts: input.container.repositories.artifacts,
    evidence: input.container.repositories.evidence,
    liveAcquire,
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
