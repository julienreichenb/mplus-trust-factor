/**
 * Shadow refresh entry: V1 refresh stays authoritative; Scoring V2 digest
 * orchestration runs best-effort when master+child flags allow it.
 *
 * Live WCL on the digest path requires ALLOW_LIVE_PROVIDER_CALLS separately.
 * SCORING_V2_PUBLICATION_ENABLED must remain false — eligibility is diagnostic only.
 */
import type { EvidenceCandidateMetadataV2, EvidenceRole } from "@mplus/contracts";
import { EVIDENCE_SELECTOR_VERSION, hashRefreshContract } from "@mplus/contracts";
import type { WorkerContainer } from "../../container.js";
import { createQueueProducers } from "../../queues.js";
import {
  assertPublicationBlocked,
  isScoringV2ShadowOrchestrationEnabled,
} from "./acquisition.js";
import { startEvidenceV2ShadowPipeline } from "./orchestrator.js";
import {
  orchestrateScoringV2Runs,
  type LiveProviderPermission,
  type RunOrchestrationPorts,
  type RunOrchestrationResult,
} from "./run-orchestration/orchestrator.js";
import { createProductionRunOrchestrationPorts } from "./run-orchestration/production-ports.js";
import {
  evaluatePublicationEligibility,
  type PublicationEligibilityDecision,
} from "./run-orchestration/publication-eligibility.js";

export interface ScoringV2ShadowRefreshDiagnostics {
  skipped: boolean;
  skipReason: string | null;
  liveProviderPermission: LiveProviderPermission;
  legacyShadow: {
    enqueued: boolean;
    analysisBatchId: string | null;
    enqueuedSlotJobs: number | null;
    deferred: boolean;
    skipped: boolean;
  } | null;
  orchestration: RunOrchestrationResult | null;
  publicationEligibility: PublicationEligibilityDecision | null;
  /** Exact providerCalls from the digest orchestrator (never invented). */
  providerCalls: number;
  publicScorePointerMutated: false;
}

function liveProviderPermissionFromEnv(
  env: WorkerContainer["env"],
): LiveProviderPermission {
  return env.ALLOW_LIVE_PROVIDER_CALLS === true ? "ALLOWED" : "FORBIDDEN";
}

export async function maybeStartScoringV2ShadowFromRefresh(input: {
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
  scoreModelId: string;
  scoreModelVersion?: string | null;
  parentIngestionJobId: string | null;
  correlationId: string | null;
  refreshGeneration: number;
  region: string;
  realm: string;
  characterName: string;
  /** Test seam — inject memory ports for provider-free integration tests. */
  portsOverride?: RunOrchestrationPorts;
  /** When true, skip legacy slot fan-out (digest-path unit tests). */
  skipLegacyShadowPipeline?: boolean;
}): Promise<ScoringV2ShadowRefreshDiagnostics> {
  const empty = (
    skipReason: string,
  ): ScoringV2ShadowRefreshDiagnostics => ({
    skipped: true,
    skipReason,
    liveProviderPermission: liveProviderPermissionFromEnv(input.container.env),
    legacyShadow: null,
    orchestration: null,
    publicationEligibility: null,
    providerCalls: 0,
    publicScorePointerMutated: false,
  });

  if (!isScoringV2ShadowOrchestrationEnabled(input.container.env)) {
    return empty("scoring_v2_shadow_flags_disabled");
  }

  try {
    assertPublicationBlocked(input.container.env);
  } catch (error) {
    input.container.logger.warn(
      {
        err: error,
        event: "scoring_v2_publication_flag_refused",
        characterId: input.characterId,
      },
      "SCORING_V2_PUBLICATION_ENABLED must stay false — refusing digest orchestration",
    );
    return empty("scoring_v2_publication_enabled_refused");
  }

  const liveProviderPermission = liveProviderPermissionFromEnv(
    input.container.env,
  );
  let legacyShadow: ScoringV2ShadowRefreshDiagnostics["legacyShadow"] = null;

  // Legacy slot fan-out remains for existing shadow diagnostics (best-effort).
  if (!input.skipLegacyShadowPipeline) {
    const redis = input.container.createRedisConnection();
    const producers = createQueueProducers(redis, input.container);
    try {
      const result = await startEvidenceV2ShadowPipeline(
        input.container,
        {
          characterId: input.characterId,
          seasonId: input.seasonId,
          seasonSlug: input.seasonSlug,
          role: input.role,
          classSlug: input.classSlug,
          specSlug: input.specSlug,
          refreshContractHash: hashRefreshContract(input.refreshContract),
          evidenceCutoffAt: input.evidenceCutoffAt,
          highKeyPolicyId: input.highKeyPolicyId,
          activeDungeonSlugs: input.activeDungeonSlugs,
          candidates: input.candidates,
          scoreModelId: input.scoreModelId,
          parentIngestionJobId: input.parentIngestionJobId,
          correlationId: input.correlationId,
          refreshGeneration: input.refreshGeneration,
          region: input.region,
        },
        {
          enqueueAnalyzeEvidenceSlot: (job) =>
            producers.enqueueAnalyzeEvidenceSlot(job),
        },
      );

      if (
        !result.skipped &&
        !result.deferred &&
        result.analysisBatchId &&
        (result.enqueuedSlotJobs ?? 0) === 0
      ) {
        await producers.enqueueFinalizeEvidenceBatch({
          analysisBatchId: result.analysisBatchId,
          acquisitionPlanContentHash: result.acquisitionPlanContentHash!,
          expectedTerminalSlotCount: 0,
          refreshGeneration: input.refreshGeneration,
          correlationId: input.correlationId,
        });
      }

      legacyShadow = {
        enqueued: !result.skipped && !result.deferred,
        analysisBatchId: result.analysisBatchId ?? null,
        enqueuedSlotJobs: result.enqueuedSlotJobs ?? null,
        deferred: Boolean(result.deferred),
        skipped: Boolean(result.skipped),
      };

      input.container.logger.info(
        {
          event: "scoring_v2_shadow_enqueue",
          ...result,
          characterId: input.characterId,
          publicationBlocked: true,
        },
        "scoring v2 shadow pipeline enqueue result",
      );
    } catch (error) {
      input.container.logger.warn(
        {
          err: error,
          event: "scoring_v2_shadow_enqueue_failed",
          characterId: input.characterId,
        },
        "scoring v2 shadow enqueue failed — V1 refresh continues",
      );
      legacyShadow = {
        enqueued: false,
        analysisBatchId: null,
        enqueuedSlotJobs: null,
        deferred: false,
        skipped: true,
      };
    } finally {
      await producers.close();
      await redis.quit();
    }
  }

  // Digest run orchestration (provider-free unless live permission + live hook).
  let orchestration: RunOrchestrationResult | null = null;
  let publicationEligibility: PublicationEligibilityDecision | null = null;

  try {
    const ports =
      input.portsOverride ??
      createProductionRunOrchestrationPorts({
        prisma: input.container.prisma,
        artifacts: input.container.repositories.artifacts,
        evidence: input.container.repositories.evidence,
        // Live acquire stays unwired here unless ALLOW_LIVE_PROVIDER_CALLS —
        // canary must inject an explicit live hook. Ordinary refreshes never
        // accidentally enable WCL on the digest path.
        liveAcquireCapabilityPackage:
          liveProviderPermission === "ALLOWED"
            ? undefined
            : undefined,
        resolveParticipants: async ({ sourceFight }) => {
          const hit =
            await input.container.repositories.capabilityEvidencePackages.findCompleteBySourceFight(
              sourceFight,
            );
          if (!hit) return [];
          const candidate = input.candidates.find(
            (c) =>
              c.discoveryIdentity.reportCode === sourceFight.reportCode &&
              c.discoveryIdentity.fightId === sourceFight.fightId,
          );
          const targetActorId = candidate?.actorId ?? null;
          return hit.package.friendlyPlayerActorIds.map((id) => ({
            playerActorId: id,
            characterName:
              targetActorId != null && id === targetActorId
                ? input.characterName
                : `Actor${id}`,
            realmSlug: input.realm,
            regionCode: input.region,
            classSlug:
              targetActorId != null && id === targetActorId
                ? input.classSlug
                : null,
            specSlug:
              targetActorId != null && id === targetActorId
                ? input.specSlug
                : null,
            role:
              targetActorId != null && id === targetActorId ? input.role : null,
            ownedPetActorIds: [],
            characterId:
              targetActorId != null && id === targetActorId
                ? input.characterId
                : null,
          }));
        },
      });

    orchestration = await orchestrateScoringV2Runs({
      characterId: input.characterId,
      region: input.region,
      realm: input.realm,
      characterName: input.characterName,
      seasonId: input.seasonId,
      scoringModelId: input.scoreModelId,
      scoringModelVersion: input.scoreModelVersion ?? null,
      liveProviderPermission,
      scope: {
        characterId: input.characterId,
        seasonId: input.seasonId,
        seasonSlug: input.seasonSlug,
        specializationId: null,
        classSlug: input.classSlug,
        specSlug: input.specSlug,
        role: input.role,
        refreshContractHash: hashRefreshContract(input.refreshContract),
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: input.evidenceCutoffAt,
        highKeyPolicyId: input.highKeyPolicyId,
        activeDungeonSlugs: input.activeDungeonSlugs,
      },
      candidates: input.candidates,
      ports,
    });

    publicationEligibility = evaluatePublicationEligibility({
      result: orchestration,
      scoringModelId: input.scoreModelId,
      scoringV2PublicationEnabled:
        input.container.env.SCORING_V2_PUBLICATION_ENABLED === true,
    });

    input.container.logger.info(
      {
        event: "scoring_v2_digest_orchestration",
        characterId: input.characterId,
        incomplete: orchestration.incomplete,
        selectedSlotCount: orchestration.selectedSlotCount,
        uniqueFightCount: orchestration.uniqueSourceFights.length,
        providerCalls: orchestration.accounting.providerCalls,
        packagesCreated: orchestration.accounting.packagesCreated,
        packagesReused: orchestration.accounting.packagesReused,
        digestsCreated: orchestration.accounting.digestsCreated,
        digestsReused: orchestration.accounting.digestsReused,
        cacheMisses: orchestration.cacheMisses.length,
        fightFailures: orchestration.fightFailures.length,
        dimensionBlocked: orchestration.dimensions.blocked,
        publicationEligible: publicationEligibility.eligible,
        publicationEnabled: false,
        publicScorePointerMutated: false,
      },
      "scoring v2 digest orchestration result",
    );
  } catch (error) {
    input.container.logger.warn(
      {
        err: error,
        event: "scoring_v2_digest_orchestration_failed",
        characterId: input.characterId,
      },
      "scoring v2 digest orchestration failed — V1 refresh continues",
    );
  }

  return {
    skipped: false,
    skipReason: null,
    liveProviderPermission,
    legacyShadow,
    orchestration,
    publicationEligibility,
    providerCalls: orchestration?.accounting.providerCalls ?? 0,
    publicScorePointerMutated: false,
  };
}
