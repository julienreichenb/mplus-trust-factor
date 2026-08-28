/**
 * High-level Ability Catalog publish orchestration.
 * Chains compile → validation → replay → atomic activation using existing services.
 */

import type { PrismaClient } from "@mplus/database";
import type {
  AbilityCatalogPublishBlockingIssue,
  AbilityCatalogPublishResultDTO,
  AbilityCatalogPublishStatusDTO,
  PublishAbilityCatalogRequest,
} from "@mplus/contracts";
import { filterReviewImportItems } from "@mplus/abilities";
import { HttpError } from "../errors.js";
import {
  AbilityCatalogReleaseService,
  type AbilityCatalogReleaseAuditContext,
  type IncludedDraftRuleRef,
  type IncludedDraftTopologyRef,
  type IncludedRemovalRef,
} from "./ability-catalog-release-service.js";
import { AbilityCatalogReplayService } from "./ability-catalog-replay-service.js";
import { AbilityCatalogReleaseActivationService } from "./ability-catalog-release-activation-service.js";
import { AbilityCatalogReviewService } from "./ability-catalog-review-service.js";
import {
  loadMplusRelevanceContext,
  listCanonicalKeysPendingExclusionTombstone,
} from "./ability-catalog-mplus-context.js";

function digestShort(digest: string): string {
  return digest.length >= 12 ? digest.slice(0, 12) : digest;
}

export class AbilityCatalogPublishService {
  private readonly releases: AbilityCatalogReleaseService;
  private readonly replays: AbilityCatalogReplayService;
  private readonly activation: AbilityCatalogReleaseActivationService;
  private readonly review: AbilityCatalogReviewService;

  constructor(private readonly prisma: PrismaClient) {
    this.releases = new AbilityCatalogReleaseService(prisma);
    this.replays = new AbilityCatalogReplayService(prisma);
    this.activation = new AbilityCatalogReleaseActivationService(prisma);
    this.review = new AbilityCatalogReviewService(prisma);
  }

  async getPublishStatus(): Promise<AbilityCatalogPublishStatusDTO> {
    const active = await this.activation.getActiveRelease();
    const pending = await this.collectPendingChanges(active?.id ?? null);
    const { batches } = await this.review.listBatches();
    const latestBatch = batches[0] ?? null;

    let status: AbilityCatalogPublishStatusDTO["status"] = "NO_CHANGES";
    if (pending.blockingIssues.length > 0) {
      status = "BLOCKED";
    } else if (pending.hasPublishableChanges) {
      status = "READY";
    } else if (pending.unclassifiedCandidateCount > 0) {
      status = "NEEDS_CLASSIFICATION";
    }

    return {
      status,
      activeReleaseId: active?.id ?? null,
      activeReleaseKey: active?.releaseKey ?? null,
      activeContentDigestShort: active ? digestShort(active.contentDigest) : null,
      pending: {
        readyDraftCount: pending.draftRuleRefs.length,
        pendingExclusionCount: pending.pendingExclusionKeys.length,
        confirmedRemovalCount: pending.removalRefs.length,
        readyTopologyCount: pending.topologyRefs.length,
        incompleteAcceptedCount: pending.blockingIssues.length,
        unclassifiedCandidateCount: pending.unclassifiedCandidateCount,
        hasPublishableChanges: pending.hasPublishableChanges,
      },
      blockingIssues: pending.blockingIssues,
      lastSyncAt: latestBatch?.createdAt ?? null,
      lastSyncSimcRevision: latestBatch?.simcRevision ?? null,
      lastSyncWowBuild: latestBatch?.wowBuild ?? null,
    };
  }

  async publishChanges(
    audit: AbilityCatalogReleaseAuditContext,
    input: PublishAbilityCatalogRequest = {},
  ): Promise<AbilityCatalogPublishResultDTO> {
    const active = await this.activation.getActiveRelease();
    if (!active) {
      throw HttpError.conflict("NO_ACTIVE_RELEASE", "No ACTIVE ability catalog release to publish from");
    }

    const pending = await this.collectPendingChanges(active.id);
    if (pending.blockingIssues.length > 0) {
      throw HttpError.badRequest("PUBLISH_BLOCKED", "Resolve blocking classification issues before publishing", {
        blockingIssues: pending.blockingIssues,
      });
    }
    if (!pending.hasPublishableChanges) {
      throw HttpError.badRequest("NO_PENDING_CHANGES", "No unpublished catalog changes are ready to publish");
    }

    const previousActive = {
      id: active.id,
      releaseKey: active.releaseKey,
      contentDigest: active.contentDigest,
    };

    let candidate;
    try {
      const compiled = await this.releases.createReleaseCandidate(
        {
          baseReleaseId: active.id,
          includedDraftRuleIds: pending.draftRuleRefs,
          includedDraftTopologyIds: pending.topologyRefs,
          includedRemovalItemIds: pending.removalRefs,
          wowBuild: active.wowBuild ?? undefined,
          notes: input.notes ?? "Admin publish orchestration",
        },
        audit,
      );
      candidate = compiled.release;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return this.failureResult({
        stage: "COMPILE",
        previousActive,
        message: error instanceof Error ? error.message : "Release compilation failed",
      });
    }

    const candidateSummary = {
      id: candidate.id,
      releaseKey: candidate.releaseKey,
      contentDigest: candidate.contentDigest,
      validationStatus: candidate.validationStatus,
      status: candidate.status,
    };

    if (candidate.status === "REJECTED" || candidate.validationStatus !== "PASS") {
      return this.failureResult({
        stage: "VALIDATION",
        previousActive,
        candidate: candidateSummary,
        message: "Compiled release failed validation",
        errors: [candidate.validationStatus ?? candidate.status],
      });
    }

    let replayDto: AbilityCatalogPublishResultDTO["replay"] = null;
    try {
      const replay = await this.replays.runReplay(
        {
          candidateReleaseId: candidate.id,
          baseReleaseId: active.id,
          baseKind: "RELEASE",
          expectZeroImpact: false,
        },
        audit,
      );
      replayDto = { id: replay.replay.id, status: replay.replay.status };
      if (replay.replay.status !== "PASSED") {
        return this.failureResult({
          stage: "REPLAY",
          previousActive,
          candidate: candidateSummary,
          replay: replayDto,
          message: "Replay safety gate failed",
          errors: [replay.replay.status],
        });
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return this.failureResult({
        stage: "REPLAY",
        previousActive,
        candidate: candidateSummary,
        message: error instanceof Error ? error.message : "Replay failed",
      });
    }

    try {
      const activated = await this.activation.activate(
        {
          releaseId: candidate.id,
          confirmationDigest: candidate.contentDigest,
          confirm: true,
          expectedPreviousActiveId: input.expectedPreviousActiveId ?? active.id,
          notes: input.notes,
        },
        audit,
        { type: "PUBLISH" },
      );
      return {
        success: true,
        stage: "COMPLETE",
        previousActive,
        candidateRelease: candidateSummary,
        newActive: {
          id: activated.release.id,
          releaseKey: activated.release.releaseKey,
          contentDigest: activated.release.contentDigest,
          activatedAt: activated.activation.activatedAt,
        },
        replay: replayDto,
        message: activated.notice,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return this.failureResult({
        stage: "ACTIVATION",
        previousActive,
        candidate: candidateSummary,
        replay: replayDto,
        message: error instanceof Error ? error.message : "Activation failed",
      });
    }
  }

  private failureResult(input: {
    stage: AbilityCatalogPublishResultDTO["stage"];
    previousActive: NonNullable<AbilityCatalogPublishResultDTO["previousActive"]>;
    candidate?: AbilityCatalogPublishResultDTO["candidateRelease"];
    replay?: AbilityCatalogPublishResultDTO["replay"];
    message: string;
    errors?: string[];
  }): AbilityCatalogPublishResultDTO {
    return {
      success: false,
      stage: input.stage,
      previousActive: input.previousActive,
      candidateRelease: input.candidate ?? null,
      newActive: null,
      replay: input.replay ?? null,
      message: input.message,
      errors: input.errors,
    };
  }

  private async collectPendingChanges(activeReleaseId: string | null): Promise<{
    draftRuleRefs: IncludedDraftRuleRef[];
    topologyRefs: IncludedDraftTopologyRef[];
    removalRefs: IncludedRemovalRef[];
    pendingExclusionKeys: string[];
    unclassifiedCandidateCount: number;
    blockingIssues: AbilityCatalogPublishBlockingIssue[];
    hasPublishableChanges: boolean;
  }> {
    const draftRuleRefs = await this.listReadyDraftRuleRefs();
    const topologyRefs = await this.listReadyTopologyRefs();
    const removalRefs = activeReleaseId
      ? await this.listConfirmedRemovalRefs(activeReleaseId)
      : [];

    let pendingExclusionKeys: string[] = [];
    if (activeReleaseId) {
      const loaded = await this.releases.loadReleaseArtifact(activeReleaseId);
      pendingExclusionKeys = await listCanonicalKeysPendingExclusionTombstone(
        this.prisma,
        loaded.artifact.rules.map((rule) => rule.canonicalKey),
      );
    }

    const blockingIssues = await this.listBlockingIssues();
    const unclassifiedCandidateCount = await this.countUnclassifiedCandidates();

    const hasPublishableChanges =
      draftRuleRefs.length > 0 ||
      topologyRefs.length > 0 ||
      removalRefs.length > 0 ||
      pendingExclusionKeys.length > 0;

    return {
      draftRuleRefs,
      topologyRefs,
      removalRefs,
      pendingExclusionKeys,
      unclassifiedCandidateCount,
      blockingIssues,
      hasPublishableChanges,
    };
  }

  private async listReadyDraftRuleRefs(): Promise<IncludedDraftRuleRef[]> {
    const rows = await this.prisma.abilityCatalogDraftRule.findMany({
      where: { status: "READY_FOR_PUBLISH_REVIEW" },
      select: { id: true, version: true },
      orderBy: { canonicalKey: "asc" },
    });
    return rows.map((row) => ({ draftRuleId: row.id, draftVersion: row.version }));
  }

  private async listReadyTopologyRefs(): Promise<IncludedDraftTopologyRef[]> {
    const rows = await this.prisma.abilityCatalogDraftTopology.findMany({
      where: { status: { in: ["ACCEPTED", "READY_FOR_PUBLISH_REVIEW"] } },
      select: { id: true, version: true },
      orderBy: { slug: "asc" },
    });
    return rows.map((row) => ({ draftTopologyId: row.id, draftVersion: row.version }));
  }

  private async listConfirmedRemovalRefs(activeReleaseId: string): Promise<IncludedRemovalRef[]> {
    const loaded = await this.releases.loadReleaseArtifact(activeReleaseId);
    const validToBuild = loaded.artifact.wowBuild ?? "0";
    const rows = await this.prisma.abilityCatalogReviewItem.findMany({
      where: { kind: "REMOVAL_REVIEW", decisionAction: "CONFIRM_REMOVAL" },
      select: { id: true, matchedCanonicalKey: true },
      orderBy: { identityKey: "asc" },
    });
    return rows
      .filter((row) =>
        row.matchedCanonicalKey
          ? loaded.artifact.rules.some((rule) => rule.canonicalKey === row.matchedCanonicalKey)
          : false,
      )
      .map((row) => ({
        reviewItemId: row.id,
        validToBuild,
      }));
  }

  private async listBlockingIssues(): Promise<AbilityCatalogPublishBlockingIssue[]> {
    const rows = await this.prisma.abilityCatalogReviewItem.findMany({
      where: {
        decisionAction: { in: ["ACCEPT", "ACCEPT_PROPOSED"] },
        draftRule: { status: "NEEDS_METADATA" },
      },
      select: {
        id: true,
        name: true,
        matchedCanonicalKey: true,
        draftRule: { select: { canonicalKey: true } },
      },
      take: 50,
    });
    return rows.map((row) => ({
      code: "INCOMPLETE_ACCEPTED_DRAFT",
      message: `${row.name} was accepted but still needs category and availability`,
      reviewItemId: row.id,
      canonicalKey: row.draftRule?.canonicalKey ?? row.matchedCanonicalKey ?? undefined,
    }));
  }

  private async countUnclassifiedCandidates(): Promise<number> {
    const batch = await this.prisma.abilityCatalogReviewBatch.findFirst({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          where: { kind: "NEW_ABILITY_CANDIDATE", decisionAction: null },
        },
      },
    });
    if (!batch) return 0;
    const mplusCtx = await loadMplusRelevanceContext(this.prisma);
    const filtered = filterReviewImportItems(
      batch.items.map((item) => ({
        kind: "NEW_ABILITY_CANDIDATE" as const,
        identityKey: item.identityKey,
        primarySpellId: item.primarySpellId,
        name: item.name,
        matchedCanonicalKey: item.matchedCanonicalKey,
        classSlug: item.classSlug,
        specSlugs: Array.isArray(item.specSlugs)
          ? item.specSlugs.filter((v): v is string => typeof v === "string")
          : [],
        raceSlugs: Array.isArray(item.raceSlugs)
          ? item.raceSlugs.filter((v): v is string => typeof v === "string")
          : [],
        eligibilityState: item.eligibilityState,
        eligibilityReasons: Array.isArray(item.eligibilityReasons)
          ? item.eligibilityReasons.filter((v): v is string => typeof v === "string")
          : [],
        reviewReason: item.reviewReason,
        evidence: item.evidence,
        sourceProvenance: item.sourceProvenance,
      })),
      mplusCtx,
    );
    return filtered.length;
  }
}
