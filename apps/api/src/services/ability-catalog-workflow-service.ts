/**
 * Ability catalog admin workflow — derives control-center state from persisted entities.
 */

import type { PrismaClient } from "@mplus/database";
import { AbilityCatalogReleaseActivationService } from "./ability-catalog-release-activation-service.js";
import { AbilityCatalogReviewService } from "./ability-catalog-review-service.js";

export type AbilityCatalogWorkflowState =
  | "IDLE"
  | "REFRESHING"
  | "REVIEW_REQUIRED"
  | "READY_TO_ACTIVATE"
  | "ACTIVE"
  | "FAILED";

export interface AbilityCatalogWorkflowStatus {
  state: AbilityCatalogWorkflowState;
  active: {
    id: string;
    releaseKey: string;
    wowBuild: string | null;
    contentDigest: string;
    contentDigestShort: string;
    ruleCount: number;
    activatedAt: string | null;
    latestReplayStatus: string | null;
  } | null;
  refresh: {
    lastBatchId: string | null;
    lastBatchCreatedAt: string | null;
    simcRevision: string | null;
    simcApplicationVersion: string | null;
    simcDataMode: string | null;
    simcRevisionPrecision: string | null;
    wowBuild: string | null;
    changesDetected: number;
    reviewRequiredCount: number;
    pendingReviewCount: number;
    status: string | null;
  };
  review: {
    pendingItems: number;
    readyForPublishReview: number;
    openBatchId: string | null;
    reviewUrl: string;
  };
  release: {
    candidateId: string | null;
    candidateReleaseKey: string | null;
    validationStatus: string | null;
    replayStatus: string | null;
    canActivate: boolean;
  };
  notice: string;
}

function digestShort(digest: string): string {
  return digest.length >= 12 ? digest.slice(0, 12) : digest;
}

export class AbilityCatalogWorkflowService {
  private readonly activation: AbilityCatalogReleaseActivationService;
  private readonly review: AbilityCatalogReviewService;

  constructor(private readonly prisma: PrismaClient) {
    this.activation = new AbilityCatalogReleaseActivationService(prisma);
    this.review = new AbilityCatalogReviewService(prisma);
  }

  async getStatus(refreshInProgress = false): Promise<AbilityCatalogWorkflowStatus> {
    const active = await this.activation.getActiveRelease();
    const { batches } = await this.review.listBatches();
    const latestBatch = batches[0] ?? null;
    const latestBatchRow = latestBatch
      ? await this.prisma.abilityCatalogReviewBatch.findUnique({
          where: { id: latestBatch.id },
          select: { sourceIdentities: true },
        })
      : null;

    const pendingItems = latestBatch?.decisionCounts.pending ?? 0;
    const readyForPublishReview = latestBatch?.decisionCounts.draftsReadyForPublishReview ?? 0;
    const reviewRequiredCount = latestBatch?.decisionCounts.pending ?? 0;

    const candidate = await this.prisma.abilityCatalogRelease.findFirst({
      where: { status: "VALIDATED" },
      orderBy: { validatedAt: "desc" },
      select: {
        id: true,
        releaseKey: true,
        validationStatus: true,
        contentDigest: true,
      },
    });

    let replayStatus: string | null = null;
    let canActivate = false;
    if (candidate) {
      const replay = await this.prisma.abilityCatalogReleaseReplay.findFirst({
        where: { candidateReleaseId: candidate.id },
        orderBy: { startedAt: "desc" },
        select: { status: true },
      });
      replayStatus = replay?.status ?? null;
      canActivate =
        candidate.validationStatus === "PASS" &&
        replayStatus === "PASSED" &&
        active?.id !== candidate.id;
    }

    let latestReplayStatus: string | null = null;
    if (active) {
      const replay = await this.prisma.abilityCatalogReleaseReplay.findFirst({
        where: { candidateReleaseId: active.id },
        orderBy: { startedAt: "desc" },
        select: { status: true },
      });
      latestReplayStatus = replay?.status ?? null;
    }

    const activationRow = active
      ? await this.prisma.abilityCatalogReleaseActivation.findFirst({
          where: { releaseId: active.id },
          orderBy: { activatedAt: "desc" },
          select: { activatedAt: true },
        })
      : null;

    let state: AbilityCatalogWorkflowState = "IDLE";
    if (refreshInProgress) {
      state = "REFRESHING";
    } else if (!active) {
      state = "FAILED";
    } else if (canActivate) {
      state = "READY_TO_ACTIVATE";
    } else if (pendingItems > 0 || reviewRequiredCount > 0) {
      state = "REVIEW_REQUIRED";
    } else if (active) {
      state = "ACTIVE";
    }

    const simcIdentity = Array.isArray(latestBatchRow?.sourceIdentities)
      ? (latestBatchRow!.sourceIdentities as Array<Record<string, unknown>>).find(
          (s) => s.source === "SIMULATIONCRAFT",
        )
      : null;

    return {
      state,
      active: active
        ? {
            id: active.id,
            releaseKey: active.releaseKey,
            wowBuild: active.wowBuild,
            contentDigest: active.contentDigest,
            contentDigestShort: digestShort(active.contentDigest),
            ruleCount: active.ruleCount,
            activatedAt: activationRow?.activatedAt.toISOString() ?? active.publishedAt,
            latestReplayStatus,
          }
        : null,
      refresh: {
        lastBatchId: latestBatch?.id ?? null,
        lastBatchCreatedAt: latestBatch?.createdAt ?? null,
        simcRevision: latestBatch?.simcRevision ?? null,
        simcApplicationVersion:
          typeof simcIdentity?.applicationVersion === "string"
            ? simcIdentity.applicationVersion
            : null,
        simcDataMode: typeof simcIdentity?.dataMode === "string" ? simcIdentity.dataMode : null,
        simcRevisionPrecision:
          typeof simcIdentity?.revisionPrecision === "string"
            ? simcIdentity.revisionPrecision
            : null,
        wowBuild: latestBatch?.wowBuild ?? null,
        changesDetected: latestBatch?.summaryCounts?.totalChanges ?? 0,
        reviewRequiredCount,
        pendingReviewCount: pendingItems,
        status: latestBatch?.status ?? null,
      },
      review: {
        pendingItems,
        readyForPublishReview,
        openBatchId: latestBatch?.id ?? null,
        reviewUrl: "/admin/ability-catalog/review",
      },
      release: {
        candidateId: candidate?.id ?? null,
        candidateReleaseKey: candidate?.releaseKey ?? null,
        validationStatus: candidate?.validationStatus ?? null,
        replayStatus,
        canActivate,
      },
      notice:
        "New analyses always pin the ACTIVE release. Activation affects future jobs immediately — no env change or restart.",
    };
  }
}
