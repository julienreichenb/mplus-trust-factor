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
import { filterReviewImportItems, type AbilityRule } from "@mplus/abilities";
import {
  compileAbilityCatalogRelease,
  type AbilityCatalogReleaseArtifact,
} from "@mplus/abilities/release";
import { HttpError } from "../errors.js";
import {
  AbilityCatalogReleaseService,
  applyTopologyDraft,
  draftRuleRowToAbilityRule,
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

/** True when applying `change` would alter ACTIVE contentDigest. */
export function changeAltersActive(
  active: AbilityCatalogReleaseArtifact,
  change:
    | { op: "ADD_RULE"; rule: AbilityRule }
    | { op: "UPDATE_RULE"; canonicalKey: string; rule: AbilityRule }
    | { op: "TOMBSTONE_RULE"; canonicalKey: string; validToBuild: string }
    | { op: "UPDATE_TOPOLOGY"; topology: AbilityCatalogReleaseArtifact["topology"] },
): boolean {
  const next = compileAbilityCatalogRelease({
    baseRules: active.rules,
    baseTopology: active.topology,
    gameVersion: active.gameVersion,
    wowBuild: active.wowBuild,
    seasonSlug: active.seasonSlug,
    previousReleaseId: active.previousReleaseId,
    manifest: active.manifest,
    changes: [change],
    generatedAt: active.generatedAt,
  });
  return next.contentDigest !== active.contentDigest;
}

/**
 * Whether a READY draft still represents a semantic delta vs ACTIVE.
 * NEW_ABILITY ACCEPT whose key is already live is treated as already applied
 * (draft→rule conversion is lossy; ADD intent is satisfied).
 */
export function isDraftRuleSemanticallyPendingAgainstActive(
  draft: {
    status: string;
    reviewItem: { kind: string; decisionAction: string | null } | null;
  },
  rule: AbilityRule,
  active: AbilityCatalogReleaseArtifact,
): boolean {
  if (draft.status !== "READY_FOR_PUBLISH_REVIEW") return false;
  const activeRule = active.rules.find((r) => r.canonicalKey === rule.canonicalKey);
  if (activeRule && !activeRule.validToBuild) {
    if (
      draft.reviewItem?.kind === "NEW_ABILITY_CANDIDATE" &&
      draft.reviewItem.decisionAction === "ACCEPT"
    ) {
      return false;
    }
    return changeAltersActive(active, {
      op: "UPDATE_RULE",
      canonicalKey: rule.canonicalKey,
      rule,
    });
  }
  return changeAltersActive(active, { op: "ADD_RULE", rule });
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
    const rawDraftRuleRefs = await this.listReadyDraftRuleRefs();
    const rawTopologyRefs = await this.listReadyTopologyRefs();

    let pendingExclusionKeys: string[] = [];
    let draftRuleRefs = rawDraftRuleRefs;
    let topologyRefs = rawTopologyRefs;
    let removalRefs: IncludedRemovalRef[] = [];
    if (activeReleaseId) {
      const loaded = await this.releases.loadReleaseArtifact(activeReleaseId);
      draftRuleRefs = await this.filterSemanticallyPendingDrafts(rawDraftRuleRefs, loaded.artifact);
      topologyRefs = await this.filterSemanticallyPendingTopologies(rawTopologyRefs, loaded.artifact);
      removalRefs = this.filterConfirmedRemovalRefs(
        await this.listConfirmedRemovalRows(),
        loaded.artifact,
      );
      const liveKeys = loaded.artifact.rules
        .filter((rule) => !rule.validToBuild)
        .map((rule) => rule.canonicalKey);
      pendingExclusionKeys = await listCanonicalKeysPendingExclusionTombstone(this.prisma, liveKeys);
      // Exclusion tombstone is pending only when it would change ACTIVE.
      pendingExclusionKeys = pendingExclusionKeys.filter((key) =>
        changeAltersActive(loaded.artifact, {
          op: "TOMBSTONE_RULE",
          canonicalKey: key,
          validToBuild: loaded.artifact.wowBuild || "0",
        }),
      );
    } else if (rawDraftRuleRefs.length > 0) {
      // No ACTIVE → any READY draft is pending publication.
      draftRuleRefs = rawDraftRuleRefs;
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

  /**
   * Drop READY drafts whose curated intent is already represented in ACTIVE
   * (stale historical rows that would be no-ops / contradictory duplicates).
   */
  private async filterSemanticallyPendingDrafts(
    refs: IncludedDraftRuleRef[],
    active: AbilityCatalogReleaseArtifact,
  ): Promise<IncludedDraftRuleRef[]> {
    if (refs.length === 0) return refs;
    const pending: IncludedDraftRuleRef[] = [];
    for (const ref of refs) {
      const draft = await this.prisma.abilityCatalogDraftRule.findUnique({
        where: { id: ref.draftRuleId },
        include: { reviewItem: { select: { kind: true, decisionAction: true } } },
      });
      if (!draft || draft.version !== ref.draftVersion) continue;
      if (draft.status !== "READY_FOR_PUBLISH_REVIEW") continue;
      let rule: AbilityRule;
      try {
        rule = draftRuleRowToAbilityRule(draft);
      } catch {
        // Unconvertible READY draft — keep and let compile surface the error.
        pending.push(ref);
        continue;
      }
      if (
        isDraftRuleSemanticallyPendingAgainstActive(
          {
            status: draft.status,
            reviewItem: draft.reviewItem,
          },
          rule,
          active,
        )
      ) {
        pending.push(ref);
      }
    }
    return pending;
  }

  /** Drop topology drafts that would not change ACTIVE topology content. */
  private async filterSemanticallyPendingTopologies(
    refs: IncludedDraftTopologyRef[],
    active: AbilityCatalogReleaseArtifact,
  ): Promise<IncludedDraftTopologyRef[]> {
    if (refs.length === 0) return refs;
    const pending: IncludedDraftTopologyRef[] = [];
    for (const ref of refs) {
      const draft = await this.prisma.abilityCatalogDraftTopology.findUnique({
        where: { id: ref.draftTopologyId },
      });
      if (!draft || draft.version !== ref.draftVersion) continue;
      if (draft.status !== "ACCEPTED" && draft.status !== "READY_FOR_PUBLISH_REVIEW") continue;
      try {
        const topology = applyTopologyDraft(active.topology, draft);
        if (
          changeAltersActive(active, {
            op: "UPDATE_TOPOLOGY",
            topology,
          })
        ) {
          pending.push(ref);
        }
      } catch {
        // Keep unsupported/invalid topology drafts so compile can surface the error.
        pending.push(ref);
      }
    }
    return pending;
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

  private async listConfirmedRemovalRows(): Promise<
    Array<{ id: string; matchedCanonicalKey: string | null }>
  > {
    return this.prisma.abilityCatalogReviewItem.findMany({
      where: { kind: "REMOVAL_REVIEW", decisionAction: "CONFIRM_REMOVAL" },
      select: { id: true, matchedCanonicalKey: true },
      orderBy: { identityKey: "asc" },
    });
  }

  private filterConfirmedRemovalRefs(
    rows: Array<{ id: string; matchedCanonicalKey: string | null }>,
    active: AbilityCatalogReleaseArtifact,
  ): IncludedRemovalRef[] {
    const validToBuild = active.wowBuild ?? "0";
    return rows
      .filter((row) => {
        if (!row.matchedCanonicalKey) return false;
        const activeRule = active.rules.find(
          (rule) => rule.canonicalKey === row.matchedCanonicalKey,
        );
        if (!activeRule) return false;
        // Already tombstoned in ACTIVE — not a semantic pending change.
        if (activeRule.validToBuild) return false;
        return changeAltersActive(active, {
          op: "TOMBSTONE_RULE",
          canonicalKey: row.matchedCanonicalKey,
          validToBuild,
        });
      })
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
        evidence:
          item.evidence && typeof item.evidence === "object" && !Array.isArray(item.evidence)
            ? (item.evidence as Record<string, unknown>)
            : {},
        sourceProvenance:
          item.sourceProvenance &&
          typeof item.sourceProvenance === "object" &&
          !Array.isArray(item.sourceProvenance)
            ? (item.sourceProvenance as Record<string, unknown>)
            : {},
      })),
      mplusCtx,
    );
    return filtered.length;
  }
}
