/**
 * Admin Shadow Canary — launch + run through production Scoring V2 acquisition paths.
 * Does not require global SCORING_V2_* flags. Publication remains blocked.
 */
import { createHash, randomUUID } from "node:crypto";
import type { EvidenceRole, EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import { hashRefreshContract } from "@mplus/contracts";
import {
  planCandidateDiscovery,
  toCandidateMetadataV2,
  type DiscoverySourceRow,
} from "@mplus/provider-warcraftlogs";
import { buildEvidenceAcquisitionPlanV2 } from "@mplus/scoring";
import type { PrismaClient } from "@mplus/database";
import type { WorkerContainer } from "../../../container.js";
import { createQueueProducers } from "../../../queues.js";
import { assertPublicationBlocked, resolveEnabledConsumers } from "../acquisition.js";
import { startEvidenceV2ShadowPipeline } from "../orchestrator.js";
import { resolveShadowCanaryIdentity } from "./identity.js";

export function buildShadowCanaryIdempotencyKey(input: {
  regionCode: string;
  realmSlug: string;
  characterName: string;
  seasonId: string;
}): string {
  return createHash("sha256")
    .update(
      [
        "shadow-canary-v1",
        input.regionCode.toUpperCase(),
        input.realmSlug.toLowerCase(),
        input.characterName.trim().toLowerCase(),
        input.seasonId,
      ].join("|"),
      "utf8",
    )
    .digest("hex");
}

export async function createOrReuseShadowCanary(input: {
  prisma: PrismaClient;
  regionCode: string;
  realmSlug: string;
  characterName: string;
  requestedByUserId: string;
  seasonId: string;
}): Promise<{ canaryId: string; reused: boolean; characterId: string }> {
  const identity = await resolveShadowCanaryIdentity({
    prisma: input.prisma,
    regionCode: input.regionCode,
    realmSlug: input.realmSlug,
    characterName: input.characterName,
  });
  if ("error" in identity) {
    throw new Error(`${identity.error}:${identity.detail}`);
  }

  const idempotencyKey = buildShadowCanaryIdempotencyKey({
    regionCode: identity.regionCode,
    realmSlug: identity.realmSlug,
    characterName: identity.characterName,
    seasonId: input.seasonId,
  });

  const existing = await input.prisma.scoringV2ShadowCanary.findUnique({
    where: { idempotencyKey },
  });
  if (existing && (existing.status === "QUEUED" || existing.status === "RUNNING")) {
    return {
      canaryId: existing.id,
      reused: true,
      characterId: existing.characterId,
    };
  }

  const launchKey =
    existing != null ? `${idempotencyKey}:relaunch:${randomUUID()}` : idempotencyKey;

  const row = await input.prisma.scoringV2ShadowCanary.create({
    data: {
      characterId: identity.characterId,
      regionCode: identity.regionCode,
      realmSlug: identity.realmSlug,
      characterName: identity.characterName,
      seasonId: input.seasonId,
      status: "QUEUED",
      lifecycle: "SHADOW",
      classSlug: identity.identity.classSlug,
      specSlug: identity.identity.specSlug,
      role: identity.identity.role,
      specializationId: identity.specializationId,
      catalogVersion: identity.catalogVersion,
      catalogSupportState: identity.catalogSupportState,
      requestedByUserId: input.requestedByUserId,
      idempotencyKey: launchKey,
      progress: {},
      diagnostics: {
        catalogDependentFailClosed: identity.catalogDependentFailClosed,
        identityState: identity.identity.state,
        limitations: identity.identity.limitations,
      },
    },
  });

  return { canaryId: row.id, reused: false, characterId: identity.characterId };
}

/**
 * Execute a Shadow Canary using the production plan → slot → finalize path.
 * Bypasses global SCORING_V2_* enablement gates but still asserts publication blocked.
 */
export async function runShadowCanaryJob(input: {
  container: WorkerContainer;
  canaryId: string;
  candidates?: EvidenceCandidateMetadataV2[];
  discoveryRows?: DiscoverySourceRow[];
  activeDungeonSlugs: string[];
  seasonId: string;
  seasonSlug: string;
  scoreModelId: string;
  highKeyPolicyId: string;
  region: string;
}): Promise<{ analysisBatchId: string | null; enqueuedSlotJobs: number }> {
  assertPublicationBlocked(input.container.env);

  const canary = await input.container.prisma.scoringV2ShadowCanary.findUniqueOrThrow({
    where: { id: input.canaryId },
  });

  await input.container.prisma.scoringV2ShadowCanary.update({
    where: { id: input.canaryId },
    data: { status: "RUNNING", startedAt: new Date(), errorCode: null, errorMessage: null },
  });

  const role = (canary.role as EvidenceRole | null) ?? "UNKNOWN";
  const redis = input.container.createRedisConnection();
  const producers = createQueueProducers(redis, input.container);

  try {
    const envOverride = {
      ...input.container.env,
      SCORING_ENABLED: true,
      SCORING_PUBLICATION_ENABLED: false,
    };
    const container = { ...input.container, env: envOverride };

    const result = await startEvidenceV2ShadowPipeline(
      container,
      {
        characterId: canary.characterId,
        seasonId: input.seasonId,
        seasonSlug: input.seasonSlug,
        role,
        classSlug: canary.classSlug,
        specSlug: canary.specSlug,
        refreshContractHash: hashRefreshContract({
          scoringModelKey: "shadow-canary",
          scoringModelVersion: 0,
          observationSchemaVersion: "observations-v2",
          wclAdapterVersion: "wcl-v2-canary",
          blizzardAdapterVersion: "blizzard-v1",
          raiderIoAdapterVersion: "raiderio-v1",
          runSelectionVersion: "evidence-selector-v2.0.0",
          abilityCatalogVersion: canary.catalogVersion ?? "unknown",
          mechanicCatalogVersion: "none",
          activeSeasonId: input.seasonSlug,
          zoneId: null,
          partition: null,
        }),
        evidenceCutoffAt: new Date().toISOString(),
        highKeyPolicyId: input.highKeyPolicyId,
        activeDungeonSlugs: input.activeDungeonSlugs,
        candidates: input.candidates,
        discoveryRows: input.discoveryRows,
        scoreModelId: input.scoreModelId,
        parentIngestionJobId: null,
        correlationId: `shadow-canary-${input.canaryId}`,
        refreshGeneration: Date.now(),
        region: input.region,
        v2RefreshId: randomUUID(),
        adminShadowCanary: true,
        shadowCanaryId: input.canaryId,
      },
      {
        enqueueAnalyzeEvidenceSlot: (job) => producers.enqueueAnalyzeEvidenceSlot(job),
      },
    );

    await input.container.prisma.scoringV2ShadowCanary.update({
      where: { id: input.canaryId },
      data: {
        analysisBatchId: result.analysisBatchId ?? null,
        progress: {
          skipped: result.skipped,
          deferred: result.deferred ?? false,
          reason: result.reason ?? null,
          enqueuedSlotJobs: result.enqueuedSlotJobs ?? 0,
          acquisitionPlanContentHash: result.acquisitionPlanContentHash ?? null,
          enabledConsumers: resolveEnabledConsumers(envOverride),
        },
        status: result.skipped || result.deferred ? "FAILED" : "RUNNING",
        errorCode: result.skipped || result.deferred ? result.reason ?? "CANARY_SKIPPED" : null,
        completedAt: result.skipped || result.deferred ? new Date() : null,
      },
    });

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
        refreshGeneration: Date.now(),
        correlationId: `shadow-canary-${input.canaryId}`,
      });
    }

    return {
      analysisBatchId: result.analysisBatchId ?? null,
      enqueuedSlotJobs: result.enqueuedSlotJobs ?? 0,
    };
  } catch (error) {
    await input.container.prisma.scoringV2ShadowCanary.update({
      where: { id: input.canaryId },
      data: {
        status: "FAILED",
        errorCode: "CANARY_EXECUTION_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
    throw error;
  } finally {
    await producers.close();
    await redis.quit();
  }
}

/** Plan-only helper for diagnostics (provider-free when candidates supplied). */
export function previewShadowCanaryPlan(input: {
  characterId: string;
  seasonId: string;
  seasonSlug: string;
  role: EvidenceRole;
  classSlug: string | null;
  specSlug: string | null;
  activeDungeonSlugs: string[];
  candidates: EvidenceCandidateMetadataV2[];
  discoveryRows?: DiscoverySourceRow[];
}) {
  let candidates = input.candidates;
  if (candidates.length === 0 && input.discoveryRows?.length) {
    const discovery = planCandidateDiscovery({
      zoneRankingCandidates: input.discoveryRows,
      activeDungeonSlugs: input.activeDungeonSlugs,
    });
    candidates = discovery.candidates.map((c) => toCandidateMetadataV2(c));
  }
  return buildEvidenceAcquisitionPlanV2({
    scope: {
      characterId: input.characterId,
      seasonId: input.seasonId,
      seasonSlug: input.seasonSlug,
      specializationId: null,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      role: input.role,
      refreshContractHash: "shadow-canary-preview",
      evidenceCutoffAt: new Date().toISOString(),
      highKeyPolicyId: "shadow-canary",
      activeDungeonSlugs: input.activeDungeonSlugs,
      selectorVersion: "evidence-selector-v2.0.0",
    },
    candidates,
    plannedAt: new Date().toISOString(),
  });
}
