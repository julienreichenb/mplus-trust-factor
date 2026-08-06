/**
 * Shadow refresh entry: V1 refresh stays authoritative; Scoring V2 digest
 * orchestration runs best-effort when master+child flags allow it.
 *
 * Provider ownership: when digest orchestration is active, the digest path owns
 * live capability acquisition. Legacy slot fan-out is skipped by default to
 * prevent duplicate WCL calls for the same fights.
 *
 * Live WCL on the digest path requires ALLOW_LIVE_PROVIDER_CALLS + PROVIDER_MODE=live
 * + an explicit live acquire hook. SCORING_PUBLICATION_ENABLED must remain false.
 */
import type { EvidenceCandidateMetadataV2, EvidenceRole } from "@mplus/contracts";
import { EVIDENCE_SELECTOR_VERSION, expectedEvidenceSlotCount, hashRefreshContract } from "@mplus/contracts";
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
  createLiveCapabilityAcquireHook,
  evaluateLiveCapabilityPermission,
} from "./run-orchestration/live-capability-adapter.js";
import { createRedisSourceFightLock } from "./run-orchestration/source-fight-lease.js";
import {
  evaluatePublicationEligibility,
  type PublicationEligibilityDecision,
} from "./run-orchestration/publication-eligibility.js";
import { LiveWarcraftLogsProvider } from "@mplus/provider-warcraftlogs";
import {
  resolveActiveMythicPlusSeason,
  resolveWclMplusZoneMode,
  parseOptionalPositiveIntEnv,
} from "../active-mplus-season/index.js";
import { canonicalDungeonKey } from "../run-fusion.js";

export type ShadowProviderOwner =
  | "DIGEST_ORCHESTRATOR"
  | "LEGACY_SLOT_PIPELINE"
  | "NONE";

export interface ScoringV2ShadowRefreshDiagnostics {
  skipped: boolean;
  skipReason: string | null;
  liveProviderPermission: LiveProviderPermission;
  /** Which component is allowed to perform live WCL acquisition. */
  providerOwner: ShadowProviderOwner;
  legacyShadow: {
    enqueued: boolean;
    analysisBatchId: string | null;
    enqueuedSlotJobs: number | null;
    deferred: boolean;
    skipped: boolean;
    providerCallsAllowed: boolean;
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
  /**
   * When true (default while digest path is active), skip legacy slot fan-out
   * so only the digest orchestrator may own live acquisition.
   * Set false only for explicit legacy-diagnostics runs (still should not
   * double-fetch when digest also runs live — prefer one owner).
   */
  skipLegacyShadowPipeline?: boolean;
  /**
   * Force legacy path as provider owner (digest skipped). Used to preserve
   * legacy-only behavior when digest orchestration is intentionally off.
   */
  forceLegacyProviderOwner?: boolean;
}): Promise<ScoringV2ShadowRefreshDiagnostics> {
  const empty = (
    skipReason: string,
  ): ScoringV2ShadowRefreshDiagnostics => ({
    skipped: true,
    skipReason,
    liveProviderPermission: liveProviderPermissionFromEnv(input.container.env),
    providerOwner: "NONE",
    legacyShadow: null,
    orchestration: null,
    publicationEligibility: null,
    providerCalls: 0,
    publicScorePointerMutated: false,
  });

  if (!isScoringV2ShadowOrchestrationEnabled(input.container.env)) {
    return empty("scoring_v2_shadow_flags_disabled");
  }

  // Production path: assert refresh + shadow share ActiveMythicPlusSeasonAuthority lineage.
  // Test seam (portsOverride) may use synthetic seasons without a validated catalog.
  if (!input.portsOverride) {
    try {
      const region = await input.container.prisma.region.findFirst({
        where: { code: input.region.toUpperCase() },
      });
      if (!region) {
        return empty("active_season_region_missing");
      }
      const mode = resolveWclMplusZoneMode({
        WCL_MPLUS_ZONE_MODE: input.container.env.WCL_MPLUS_ZONE_MODE,
        WCL_MPLUS_ZONE_ID: input.container.env.WCL_MPLUS_ZONE_ID || undefined,
      });
      const zoneFromEnv = (() => {
        try {
          return parseOptionalPositiveIntEnv(
            input.container.env.WCL_MPLUS_ZONE_ID || undefined,
          );
        } catch {
          return null;
        }
      })();
      const authority = await resolveActiveMythicPlusSeason({
        prisma: input.container.prisma,
        regionCode: input.region,
        regionId: region.id,
        resolutionMode: mode === "pinned" ? "PINNED" : "AUTO",
        pinnedWclZoneId: mode === "pinned" ? zoneFromEnv : null,
        diagnosticExpectedZoneId: mode === "auto" ? zoneFromEnv : null,
      });
      if (authority.applicationSeasonId !== input.seasonId) {
        input.container.logger.warn(
          {
            event: "scoring_v2_season_lineage_mismatch",
            refreshSeasonId: input.seasonId,
            authoritySeasonId: authority.applicationSeasonId,
            dungeonPoolHash: authority.dungeonPoolHash,
          },
          "shadow refused: season lineage mismatch before provider acquisition",
        );
        return empty("active_season_lineage_mismatch");
      }
      const authSlugs = new Set(
        authority.activeDungeonSlugs.map((s) => canonicalDungeonKey(s)),
      );
      const refreshSlugs = new Set(
        input.activeDungeonSlugs.map((s) => canonicalDungeonKey(s)),
      );
      if (
        authSlugs.size !== refreshSlugs.size ||
        [...authSlugs].some((s) => !refreshSlugs.has(s))
      ) {
        return empty("active_season_dungeon_pool_mismatch");
      }
    } catch (error) {
      input.container.logger.warn(
        {
          err: error,
          event: "scoring_v2_season_authority_unresolved",
          characterId: input.characterId,
          seasonId: input.seasonId,
        },
        "shadow refused: active season authority unresolved",
      );
      return empty("active_season_authority_unresolved");
    }
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
      "SCORING_PUBLICATION_ENABLED must stay false — refusing digest orchestration",
    );
    return empty("SCORING_PUBLICATION_ENABLED_refused");
  }

  const liveProviderPermission = liveProviderPermissionFromEnv(
    input.container.env,
  );

  // Digest path owns live acquisition whenever shadow orchestration is on.
  // Legacy slot fan-out is skipped by default to prevent duplicate WCL calls.
  const skipLegacy =
    input.skipLegacyShadowPipeline !== false && !input.forceLegacyProviderOwner;
  const providerOwner: ShadowProviderOwner = input.forceLegacyProviderOwner
    ? "LEGACY_SLOT_PIPELINE"
    : "DIGEST_ORCHESTRATOR";

  let legacyShadow: ScoringV2ShadowRefreshDiagnostics["legacyShadow"] = null;

  if (!skipLegacy) {
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
        // When digest owns providers, legacy must not perform live acquisition.
        providerCallsAllowed: providerOwner === "LEGACY_SLOT_PIPELINE",
      };

      input.container.logger.info(
        {
          event: "scoring_v2_shadow_enqueue",
          ...result,
          characterId: input.characterId,
          providerOwner,
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
        providerCallsAllowed: false,
      };
    } finally {
      await producers.close();
      await redis.quit();
    }
  } else {
    legacyShadow = {
      enqueued: false,
      analysisBatchId: null,
      enqueuedSlotJobs: null,
      deferred: false,
      skipped: true,
      providerCallsAllowed: false,
    };
  }

  if (input.forceLegacyProviderOwner) {
    return {
      skipped: false,
      skipReason: null,
      liveProviderPermission,
      providerOwner,
      legacyShadow,
      orchestration: null,
      publicationEligibility: null,
      providerCalls: 0,
      publicScorePointerMutated: false,
    };
  }

  let orchestration: RunOrchestrationResult | null = null;
  let publicationEligibility: PublicationEligibilityDecision | null = null;
  let redisForLock: ReturnType<WorkerContainer["createRedisConnection"]> | null =
    null;

  try {
    let ports = input.portsOverride;
    if (!ports) {
      const env = input.container.env;
      const permission = {
        providerMode: env.PROVIDER_MODE,
        wclEnabled: env.WCL_ENABLED === true,
        allowLiveProviderCalls: env.ALLOW_LIVE_PROVIDER_CALLS === true,
        liveProviderPermissionGranted: liveProviderPermission === "ALLOWED",
        scoringV2PublicationEnabled: env.SCORING_PUBLICATION_ENABLED === true,
        hasWclCredentials: Boolean(env.WCL_CLIENT_ID && env.WCL_CLIENT_SECRET),
      };
      const gate = evaluateLiveCapabilityPermission(permission);

      let liveHook:
        | ReturnType<typeof createLiveCapabilityAcquireHook>
        | undefined;
      if (gate.allowed && liveProviderPermission === "ALLOWED") {
        const client = new LiveWarcraftLogsProvider({
          env,
        }).getGraphQlClient();
        liveHook = createLiveCapabilityAcquireHook({
          env,
          prisma: input.container.prisma,
          artifacts: input.container.repositories.artifacts,
          wclSource: input.container.repositories.wclSource,
          client,
          region: input.region,
          permission,
        });
      }

      redisForLock = input.container.createRedisConnection();
      const packageFinder = async (args: {
        sourceFight: {
          reportCode: string;
          fightId: number;
          reportRevision: number;
        };
      }) => {
        const hit =
          await input.container.repositories.capabilityEvidencePackages.findCompleteBySourceFight(
            args.sourceFight,
          );
        if (!hit) return null;
        return {
          package: hit.package,
          packageArtifactId: hit.packageArtifactId,
          contentHash: hit.contentHash,
          providerCalls: 0 as const,
        };
      };

      const withSourceFightLock = createRedisSourceFightLock({
        redis: redisForLock,
        appEnv: env.APP_ENV ?? env.NODE_ENV ?? "development",
        findCompatiblePackage: packageFinder,
      });

      ports = createProductionRunOrchestrationPorts({
        prisma: input.container.prisma,
        artifacts: input.container.repositories.artifacts,
        evidence: input.container.repositories.evidence,
        liveAcquireCapabilityPackage: liveHook,
        withSourceFightLock,
        resolveParticipants: async ({ sourceFight }) => {
          const rosterRow =
            await input.container.prisma.wclRunSourceDigest.findFirst({
              where: {
                reportCode: sourceFight.reportCode,
                fightId: sourceFight.fightId,
                reportRevision: sourceFight.reportRevision,
              },
            });
          const rosterParticipants =
            (
              rosterRow?.digest as {
                participants?: Array<{
                  wclActorId: number;
                  characterName: string;
                  realmSlug: string;
                  regionCode: string;
                  classSlug?: string | null;
                  specSlug?: string | null;
                  role?: string | null;
                  ownedPetActorIds?: number[];
                }>;
              } | null
            )?.participants ?? [];

          const hit =
            await input.container.repositories.capabilityEvidencePackages.findCompleteBySourceFight(
              sourceFight,
            );
          if (!hit) {
            if (rosterParticipants.length === 0) return [];
            return rosterParticipants.map((p) => {
              const isTarget =
                p.characterName
                  .normalize("NFKC")
                  .trim()
                  .toLocaleLowerCase("en-US") ===
                input.characterName
                  .normalize("NFKC")
                  .trim()
                  .toLocaleLowerCase("en-US");
              return {
                playerActorId: p.wclActorId,
                characterName: isTarget ? input.characterName : p.characterName,
                realmSlug: p.realmSlug ?? input.realm,
                regionCode: p.regionCode ?? input.region,
                classSlug: isTarget ? input.classSlug : (p.classSlug ?? null),
                specSlug: isTarget ? input.specSlug : (p.specSlug ?? null),
                role: isTarget ? input.role : (p.role ?? null),
                ownedPetActorIds: p.ownedPetActorIds ?? [],
                characterId: isTarget ? input.characterId : null,
              };
            });
          }

          const targetFromRoster = rosterParticipants.find(
            (p) =>
              p.characterName
                .normalize("NFKC")
                .trim()
                .toLocaleLowerCase("en-US") ===
              input.characterName
                .normalize("NFKC")
                .trim()
                .toLocaleLowerCase("en-US"),
          );
          const targetActorId = targetFromRoster?.wclActorId ?? null;
          return hit.package.friendlyPlayerActorIds.map((id) => {
            const rosterP = rosterParticipants.find((p) => p.wclActorId === id);
            const isTarget = targetActorId != null && id === targetActorId;
            return {
              playerActorId: id,
              characterName: isTarget
                ? input.characterName
                : (rosterP?.characterName ?? `Actor${id}`),
              realmSlug: rosterP?.realmSlug ?? input.realm,
              regionCode: rosterP?.regionCode ?? input.region,
              classSlug: isTarget
                ? input.classSlug
                : (rosterP?.classSlug ?? null),
              specSlug: isTarget ? input.specSlug : (rosterP?.specSlug ?? null),
              role: isTarget ? input.role : (rosterP?.role ?? null),
              ownedPetActorIds: rosterP?.ownedPetActorIds ?? [],
              characterId: isTarget ? input.characterId : null,
            };
          });
        },
        resolveFightRoster: async ({ sourceFight }) => {
          const row = await input.container.prisma.wclRunSourceDigest.findFirst({
            where: {
              reportCode: sourceFight.reportCode,
              fightId: sourceFight.fightId,
              reportRevision: sourceFight.reportRevision,
            },
          });
          const participants =
            (
              row?.digest as {
                participants?: Array<{
                  wclActorId: number;
                  characterName: string;
                  realmSlug: string;
                  regionCode: string;
                }>;
              } | null
            )?.participants ?? [];
          return participants.map((p) => ({
            wclActorId: p.wclActorId,
            characterName: p.characterName,
            realmSlug: p.realmSlug,
            regionCode: p.regionCode,
          }));
        },
      });
    }

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
        input.container.env.SCORING_PUBLICATION_ENABLED === true,
      expectedSlotCountFromSeason: expectedEvidenceSlotCount(
        input.activeDungeonSlugs.length,
      ),
    });

    input.container.logger.info(
      {
        event: "scoring_v2_digest_orchestration",
        characterId: input.characterId,
        providerOwner,
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
  } finally {
    if (redisForLock) {
      await redisForLock.quit().catch(() => undefined);
    }
  }

  return {
    skipped: false,
    skipReason: null,
    liveProviderPermission,
    providerOwner,
    legacyShadow,
    orchestration,
    publicationEligibility,
    providerCalls: orchestration?.accounting.providerCalls ?? 0,
    publicScorePointerMutated: false,
  };
}
