import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@mplus/database";
import type {
  AbilityBusinessMetadataPatch,
  AbilityCatalogDraftValidationDTO,
  AbilityCatalogExclusionDTO,
  AbilityCatalogReviewBatchDTO,
  AbilityCatalogReviewItemDTO,
  DecideAbilityCatalogReviewItemRequest,
} from "@mplus/contracts";
import {
  BINDING_DECISIONS,
  NEW_ABILITY_DECISIONS,
  REMOVAL_DECISIONS,
  TOPOLOGY_DECISIONS,
  abilityCatalogExclusionMutationSchema,
  decideAbilityCatalogReviewItemRequestSchema,
  designateAbilityCatalogBaselineRequestSchema,
  firstZodIssueMessage,
  updateAbilityCatalogDraftRequestSchema,
  validateAbilityCatalogDraftRequestSchema,
} from "@mplus/contracts";
import type { CatalogRefreshReport } from "@mplus/abilities";
import {
  applyBusinessMetadataToReviewDraft,
  buildReviewImportPlan,
  dimensionTagsForRule,
  filterReviewImportItems,
  getAllRegisteredRules,
  prefillCuratedDraftDefaults,
  projectCurrentRuleBindings,
  resolveMplusRelevance,
  validateCuratedDraftRule,
  wowheadSpellUrl,
  ABILITY_CATALOG_REVIEW_PLAN_SCHEMA_VERSION,
  type AbilityRule,
  type CuratedDraftRuleInput,
  type MplusRelevanceContext,
  type TopologyClassificationLike,
  type ReviewImportPlan,
} from "@mplus/abilities";
import {
  clearAbilityCatalogExclusion,
  loadMplusRelevanceContext,
  toExclusionDto,
  upsertAbilityCatalogExclusion,
} from "./ability-catalog-mplus-context.js";
import { createPostgresArtifactStore } from "@mplus/database";
import type { ZodType } from "zod";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";

function digestReportBytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return v;
  });
}

function digestReviewPlan(plan: ReviewImportPlan): string {
  const items = [...plan.items]
    .map((item) => ({
      kind: item.kind,
      identityKey: item.identityKey,
      primarySpellId: item.primarySpellId,
      name: item.name,
      matchedCanonicalKey: item.matchedCanonicalKey,
      classSlug: item.classSlug,
      specSlugs: item.specSlugs,
      raceSlugs: item.raceSlugs,
      eligibilityState: item.eligibilityState,
      eligibilityReasons: item.eligibilityReasons,
      reviewReason: item.reviewReason,
      evidence: item.evidence,
    }))
    .sort((a, b) => a.identityKey.localeCompare(b.identityKey) || a.kind.localeCompare(b.kind));
  const payload = {
    schemaVersion: plan.schemaVersion ?? ABILITY_CATALOG_REVIEW_PLAN_SCHEMA_VERSION,
    datasetKind: plan.datasetKind,
    wowBuild: plan.wowBuild,
    simcRevision: plan.simcRevision,
    blizzardNamespace: plan.blizzardNamespace,
    blizzardRevision: plan.blizzardRevision,
    summaryCounts: plan.summaryCounts,
    items,
  };
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

/** Normalize full vs short SimC SHAs so a060a35 and a060a356e16f… collapse together. */
function normalizeSimcRevision(revision: string | null | undefined): string {
  const raw = (revision ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw.length >= 7 ? raw.slice(0, 7) : raw;
}

function sourceIdentityKey(simcRevision: string | null | undefined, wowBuild: string | null | undefined): string {
  return `${normalizeSimcRevision(simcRevision)}|${wowBuild ?? ""}`;
}

const OWNER_BATCH = "AbilityCatalogReviewBatch";
const OWNER_BASELINE = "AbilityCatalogSourceBaseline";
const ARTIFACT_CLASS_REPORT = "ability_catalog_review_report";
const ARTIFACT_CLASS_SIMC = "ability_catalog_source_simc";
const ARTIFACT_CLASS_BLIZZARD = "ability_catalog_source_blizzard";

const NEW_SET = new Set<string>(NEW_ABILITY_DECISIONS);
const BINDING_SET = new Set<string>(BINDING_DECISIONS);
const TOPOLOGY_SET = new Set<string>(TOPOLOGY_DECISIONS);
const REMOVAL_SET = new Set<string>(REMOVAL_DECISIONS);

export interface AbilityCatalogReviewAuditContext {
  userId?: string | null;
  actorType: "user" | "admin_key" | "system";
  ip?: string | null;
  userAgent?: string | null;
  sessionSecret: string;
}

export interface ImportPinnedReportInput {
  report: CatalogRefreshReport;
  reportBytes: Buffer;
  topologyClassification?: TopologyClassificationLike;
  simcBytes?: Buffer | null;
  blizzardBytes?: Buffer | null;
  designateBaseline?: boolean;
}

export interface ListReviewItemsQuery {
  kind?: string | null;
  classSlug?: string | null;
  specSlug?: string | null;
  raceSlug?: string | null;
  decisionState?: "pending" | "decided" | "accepted" | "rejected" | "deferred" | null;
  draftStatus?: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW" | null;
  category?: string | null;
  eligibilityState?: string | null;
  spellId?: number | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
}

export class AbilityCatalogReviewService {
  constructor(private readonly prisma: PrismaClient) {}

  async importPinnedReport(
    input: ImportPinnedReportInput,
    audit: AbilityCatalogReviewAuditContext,
  ): Promise<{
    batch: AbilityCatalogReviewBatchDTO;
    created: boolean;
    rebuilt: boolean;
    baselineId: string | null;
  }> {
    const sourceReportDigest = digestReportBytes(input.reportBytes);

    let plan: ReviewImportPlan;
    try {
      plan = buildReviewImportPlan(input.report, {
        reportDigest: sourceReportDigest,
        topologyClassification: input.topologyClassification,
      });
    } catch (error) {
      throw HttpError.badRequest(
        "INVALID_REPORT",
        error instanceof Error ? error.message : "Invalid PINNED report",
      );
    }

    const mplusCtx = await loadMplusRelevanceContext(this.prisma);
    const filteredItems = filterReviewImportItems(plan.items, mplusCtx);
    plan = {
      ...plan,
      items: filteredItems,
      summaryCounts: {
        ...plan.summaryCounts,
        newAbilityCandidates: filteredItems.filter((item) => item.kind === "NEW_ABILITY_CANDIDATE")
          .length,
        removalReviews: filteredItems.filter((item) => item.kind === "REMOVAL_REVIEW").length,
      },
    };

    const reviewPlanDigest = digestReviewPlan(plan);
    const identityKey = sourceIdentityKey(plan.simcRevision, plan.wowBuild);

    const existingByPlan = await this.prisma.abilityCatalogReviewBatch.findUnique({
      where: { reviewPlanDigest },
      include: { items: { select: { decisionAction: true } } },
    });
    if (existingByPlan) {
      return {
        batch: toBatchDto(existingByPlan, existingByPlan.items),
        created: false,
        rebuilt: false,
        baselineId: null,
      };
    }

    const openPeers = await this.prisma.abilityCatalogReviewBatch.findMany({
      where: { status: "OPEN" },
      include: { items: { select: { decisionAction: true } } },
      orderBy: { createdAt: "desc" },
    });
    const sameSourcePeers = openPeers.filter(
      (peer) => sourceIdentityKey(peer.simcRevision, peer.wowBuild) === identityKey,
    );
    const undecidedPeers = sameSourcePeers.filter((peer) =>
      peer.items.every((i) => i.decisionAction == null),
    );

    // Prefer rebuilding an undecided peer that already has this source report digest,
    // else the newest undecided peer for the same SimC+build.
    const rebuildTarget =
      undecidedPeers.find((p) => p.reportDigest === sourceReportDigest) ?? undecidedPeers[0] ?? null;

    let batchId: string;
    let created = false;
    let rebuilt = false;
    let baselineId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      if (rebuildTarget) {
        batchId = rebuildTarget.id;
        rebuilt = true;
        const reportArtifact = await persistInternalBytes(tx, {
          bytes: input.reportBytes,
          artifactClass: ARTIFACT_CLASS_REPORT,
          ownerType: OWNER_BATCH,
          ownerId: batchId,
        });
        await tx.abilityCatalogReviewItem.deleteMany({ where: { batchId } });
        await tx.abilityCatalogReviewBatch.update({
          where: { id: batchId },
          data: {
            reportDigest: sourceReportDigest,
            reviewPlanDigest,
            reportArtifactId: reportArtifact.artifactId,
            datasetKind: plan.datasetKind,
            wowBuild: plan.wowBuild,
            simcRevision: plan.simcRevision,
            blizzardNamespace: plan.blizzardNamespace,
            blizzardRevision: plan.blizzardRevision,
            sourceIdentities: plan.sourceIdentities as Prisma.InputJsonValue,
            status: "OPEN",
            summaryCounts: plan.summaryCounts as Prisma.InputJsonValue,
            importedByUserId: audit.userId ?? null,
            items: {
              create: plan.items.map((item) => ({
                id: randomUUID(),
                kind: item.kind,
                identityKey: item.identityKey,
                primarySpellId: item.primarySpellId,
                name: item.name,
                matchedCanonicalKey: item.matchedCanonicalKey,
                classSlug: item.classSlug,
                specSlugs: item.specSlugs as Prisma.InputJsonValue,
                raceSlugs: item.raceSlugs as Prisma.InputJsonValue,
                eligibilityState: item.eligibilityState,
                eligibilityReasons: item.eligibilityReasons as Prisma.InputJsonValue,
                reviewReason: item.reviewReason,
                evidence: item.evidence as Prisma.InputJsonValue,
                sourceProvenance: item.sourceProvenance as Prisma.InputJsonValue,
              })),
            },
          },
        });
      } else {
        batchId = randomUUID();
        created = true;
        const reportArtifact = await persistInternalBytes(tx, {
          bytes: input.reportBytes,
          artifactClass: ARTIFACT_CLASS_REPORT,
          ownerType: OWNER_BATCH,
          ownerId: batchId,
        });
        await tx.abilityCatalogReviewBatch.create({
          data: {
            id: batchId,
            reportDigest: sourceReportDigest,
            reviewPlanDigest,
            reportArtifactId: reportArtifact.artifactId,
            datasetKind: plan.datasetKind,
            wowBuild: plan.wowBuild,
            simcRevision: plan.simcRevision,
            blizzardNamespace: plan.blizzardNamespace,
            blizzardRevision: plan.blizzardRevision,
            sourceIdentities: plan.sourceIdentities as Prisma.InputJsonValue,
            status: "OPEN",
            summaryCounts: plan.summaryCounts as Prisma.InputJsonValue,
            importedByUserId: audit.userId ?? null,
            items: {
              create: plan.items.map((item) => ({
                id: randomUUID(),
                kind: item.kind,
                identityKey: item.identityKey,
                primarySpellId: item.primarySpellId,
                name: item.name,
                matchedCanonicalKey: item.matchedCanonicalKey,
                classSlug: item.classSlug,
                specSlugs: item.specSlugs as Prisma.InputJsonValue,
                raceSlugs: item.raceSlugs as Prisma.InputJsonValue,
                eligibilityState: item.eligibilityState,
                eligibilityReasons: item.eligibilityReasons as Prisma.InputJsonValue,
                reviewReason: item.reviewReason,
                evidence: item.evidence as Prisma.InputJsonValue,
                sourceProvenance: item.sourceProvenance as Prisma.InputJsonValue,
              })),
            },
          },
        });
      }

      // Supersede other zero-decision OPEN peers for the same source identity.
      const supersedeIds = undecidedPeers
        .filter((peer) => peer.id !== batchId)
        .map((peer) => peer.id);
      if (supersedeIds.length > 0) {
        await tx.abilityCatalogReviewBatch.updateMany({
          where: { id: { in: supersedeIds } },
          data: { status: "SUPERSEDED" },
        });
      }

      let simcArtifactId: string | null = null;
      if (input.simcBytes && input.simcBytes.length > 0) {
        const simcArtifact = await persistInternalBytes(tx, {
          bytes: input.simcBytes,
          artifactClass: ARTIFACT_CLASS_SIMC,
          ownerType: OWNER_BATCH,
          ownerId: batchId,
        });
        simcArtifactId = simcArtifact.artifactId;
      }
      if (input.blizzardBytes && input.blizzardBytes.length > 0) {
        await persistInternalBytes(tx, {
          bytes: input.blizzardBytes,
          artifactClass: ARTIFACT_CLASS_BLIZZARD,
          ownerType: OWNER_BATCH,
          ownerId: batchId,
        });
      }

      if (input.designateBaseline) {
        const simcIdentity = input.report.snapshots.find((s) => s.source === "SIMULATIONCRAFT");
        if (!simcIdentity) {
          throw HttpError.badRequest(
            "BASELINE_SOURCE_MISSING",
            "Cannot designate baseline without a SIMULATIONCRAFT snapshot identity on the report",
          );
        }
        if (!input.simcBytes || input.simcBytes.length === 0 || !simcArtifactId) {
          throw HttpError.badRequest(
            "BASELINE_BYTES_MISSING",
            "designateBaseline requires --simc snapshot bytes for durable RawArtifactPayload storage",
          );
        }
        baselineId = await this.designateBaselineInTx(
          tx,
          {
            source: "SIMULATIONCRAFT",
            sourceRevision: simcIdentity.sourceRevision,
            wowBuild: simcIdentity.validFromBuild ?? plan.wowBuild,
            dataMode: "LIVE",
            retrievedAt: simcIdentity.retrievedAt,
            schemaVersion: input.report.schemaVersion,
            extractorVersion: null,
            contentHash: digestReportBytes(input.simcBytes),
            artifactId: simcArtifactId,
            notes: `Imported with review batch ${batchId}`,
            activate: true,
          },
          audit,
          randomUUID(),
        );
      }
    });

    await this.audit("admin.ability_catalog.review.import", batchId!, audit, {
      reportDigest: sourceReportDigest,
      reviewPlanDigest,
      itemCount: plan.items.length,
      created,
      rebuilt,
      baselineId,
    });

    const batch = await this.getBatch(batchId!);
    return { batch, created, rebuilt, baselineId };
  }

  async listBatches(): Promise<{ batches: AbilityCatalogReviewBatchDTO[] }> {
    // Return real OPEN/REVIEWED batches. Do not dedupe by SimC/build/report hash —
    // lifecycle must ensure at most one current undecided batch per source identity.
    const rows = await this.prisma.abilityCatalogReviewBatch.findMany({
      where: { status: { in: ["OPEN", "REVIEWED"] } },
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          select: {
            decisionAction: true,
            draftRule: { select: { status: true } },
          },
        },
      },
    });
    return { batches: rows.map((row) => toBatchDto(row, row.items)) };
  }

  async getBatch(id: string): Promise<AbilityCatalogReviewBatchDTO> {
    const row = await this.prisma.abilityCatalogReviewBatch.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            decisionAction: true,
            draftRule: { select: { status: true } },
          },
        },
      },
    });
    if (!row) {
      throw HttpError.notFound("REVIEW_BATCH_NOT_FOUND", "Ability catalog review batch was not found");
    }
    return toBatchDto(row, row.items);
  }

  async listItems(
    batchId: string,
    query: ListReviewItemsQuery = {},
  ): Promise<{ items: AbilityCatalogReviewItemDTO[]; total: number; page: number; pageSize: number }> {
    await this.requireBatch(batchId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

    const where: Prisma.AbilityCatalogReviewItemWhereInput = {
      batchId,
      ...(query.kind ? { kind: query.kind as Prisma.EnumAbilityCatalogReviewItemKindFilter } : {}),
      ...(query.classSlug ? { classSlug: query.classSlug } : {}),
      ...(query.eligibilityState ? { eligibilityState: query.eligibilityState } : {}),
      ...(query.spellId != null ? { primarySpellId: query.spellId } : {}),
      ...(query.draftStatus || query.category
        ? {
            draftRule: {
              ...(query.draftStatus
                ? { status: query.draftStatus as Prisma.EnumAbilityCatalogDraftStatusFilter }
                : {}),
              ...(query.category ? { category: query.category } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { identityKey: { contains: query.search, mode: "insensitive" } },
              { matchedCanonicalKey: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    if (query.decisionState === "pending") {
      where.decisionAction = null;
    } else if (query.decisionState === "deferred") {
      where.decisionAction = "DEFER";
    } else if (query.decisionState === "rejected") {
      where.decisionAction = { in: ["REJECT", "EXCLUDE"] };
    } else if (query.decisionState === "accepted") {
      where.decisionAction = {
        in: ["ACCEPT", "ACCEPT_PROPOSED", "KEEP_CURRENT", "CONFIRM_REMOVAL"],
      };
    } else if (query.decisionState === "decided") {
      where.decisionAction = { not: null };
    }

    const rows = await this.prisma.abilityCatalogReviewItem.findMany({
      where,
      orderBy: [{ kind: "asc" }, { identityKey: "asc" }],
      include: {
        draftRule: true,
        draftTopology: true,
        decisionEvents: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });

    let filtered = rows;
    if (query.specSlug) {
      filtered = filtered.filter((row) => asStringArray(row.specSlugs).includes(query.specSlug!));
    }
    if (query.raceSlug) {
      filtered = filtered.filter((row) => asStringArray(row.raceSlugs).includes(query.raceSlug!));
    }

    const total = filtered.length;
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const mplusCtx = await loadMplusRelevanceContext(this.prisma);
    return {
      items: pageRows.map((row) => toItemDto(row, mplusCtx)),
      total,
      page,
      pageSize,
    };
  }

  async getItem(id: string): Promise<AbilityCatalogReviewItemDTO> {
    const row = await this.prisma.abilityCatalogReviewItem.findUnique({
      where: { id },
      include: {
        draftRule: true,
        draftTopology: true,
        decisionEvents: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!row) {
      throw HttpError.notFound("REVIEW_ITEM_NOT_FOUND", "Ability catalog review item was not found");
    }
    const mplusCtx = await loadMplusRelevanceContext(this.prisma);
    return toItemDto(row, mplusCtx);
  }

  async listExclusions(): Promise<AbilityCatalogExclusionDTO[]> {
    const rows = await this.prisma.abilityCatalogExclusion.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(toExclusionDto);
  }

  async createExclusion(
    body: unknown,
    audit: AbilityCatalogReviewAuditContext,
  ): Promise<AbilityCatalogExclusionDTO> {
    const input = parseBody(abilityCatalogExclusionMutationSchema, body);
    const stableId = await this.prisma.$transaction(async (tx) =>
      upsertAbilityCatalogExclusion(tx, {
        canonicalKey: input.canonicalKey,
        primarySpellId: input.primarySpellId,
        userId: audit.userId ?? null,
      }),
    );
    const row = await this.prisma.abilityCatalogExclusion.findUnique({
      where: { stableAbilityIdentity: stableId },
    });
    if (!row) {
      throw HttpError.internal("Failed to load persisted exclusion");
    }
    await this.audit("ability_catalog.exclusion.create", row.id, audit, {
      stableAbilityIdentity: stableId,
      canonicalKey: input.canonicalKey ?? null,
      primarySpellId: input.primarySpellId ?? null,
      note: input.note ?? null,
    });
    return toExclusionDto(row);
  }

  async clearExclusion(
    body: unknown,
    audit: AbilityCatalogReviewAuditContext,
  ): Promise<{ cleared: number }> {
    const input = parseBody(abilityCatalogExclusionMutationSchema, body);
    const cleared = await this.prisma.$transaction(async (tx) =>
      clearAbilityCatalogExclusion(tx, {
        canonicalKey: input.canonicalKey,
        primarySpellId: input.primarySpellId,
      }),
    );
    await this.audit("ability_catalog.exclusion.clear", input.canonicalKey ?? String(input.primarySpellId), audit, {
      canonicalKey: input.canonicalKey ?? null,
      primarySpellId: input.primarySpellId ?? null,
      cleared,
      note: input.note ?? null,
    });
    return { cleared };
  }

  async decideItem(
    id: string,
    body: unknown,
    audit: AbilityCatalogReviewAuditContext,
  ): Promise<AbilityCatalogReviewItemDTO> {
    const input = parseBody(decideAbilityCatalogReviewItemRequestSchema, body);
    const item = await this.prisma.abilityCatalogReviewItem.findUnique({
      where: { id },
      include: { draftRule: true, draftTopology: true },
    });
    if (!item) {
      throw HttpError.notFound("REVIEW_ITEM_NOT_FOUND", "Ability catalog review item was not found");
    }
    if (item.version !== input.expectedVersion) {
      throw HttpError.conflict(
        "REVIEW_ITEM_VERSION_CONFLICT",
        "Review item was updated by another admin; reload and retry",
        { expectedVersion: input.expectedVersion, currentVersion: item.version },
      );
    }

    assertDecisionAllowed(item.kind, input.action);

    const previousState = {
      decisionAction: item.decisionAction,
      decisionNote: item.decisionNote,
      version: item.version,
      draftRuleId: item.draftRule?.id ?? null,
      draftTopologyId: item.draftTopology?.id ?? null,
    };

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.abilityCatalogReviewItem.updateMany({
        where: { id, version: input.expectedVersion },
        data: {
          decisionAction: input.action,
          decisionNote: input.note ?? null,
          decidedAt: new Date(),
          decidedByUserId: audit.userId ?? null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw HttpError.conflict(
          "REVIEW_ITEM_VERSION_CONFLICT",
          "Review item was updated by another admin; reload and retry",
        );
      }

      await this.applyDecisionSideEffects(tx, item, input, audit);

      await tx.abilityCatalogReviewDecisionEvent.create({
        data: {
          id: randomUUID(),
          itemId: id,
          actorUserId: audit.userId ?? null,
          actorType: audit.actorType,
          previousState: previousState as Prisma.InputJsonValue,
          newState: {
            decisionAction: input.action,
            decisionNote: input.note ?? null,
            version: input.expectedVersion + 1,
            businessMetadata: input.businessMetadata ?? null,
          } as Prisma.InputJsonValue,
          note: input.note ?? null,
        },
      });
    });

    await this.audit("admin.ability_catalog.review.decide", id, audit, {
      action: input.action,
      kind: item.kind,
      expectedVersion: input.expectedVersion,
    });

    return this.getItem(id);
  }

  async updateDraft(
    itemId: string,
    body: unknown,
    audit: AbilityCatalogReviewAuditContext,
  ): Promise<AbilityCatalogReviewItemDTO> {
    const input = parseBody(updateAbilityCatalogDraftRequestSchema, body);
    const item = await this.prisma.abilityCatalogReviewItem.findUnique({
      where: { id: itemId },
      include: { draftRule: true, draftTopology: true },
    });
    if (!item) {
      throw HttpError.notFound("REVIEW_ITEM_NOT_FOUND", "Ability catalog review item was not found");
    }
    if (!item.draftRule) {
      throw HttpError.badRequest(
        "DRAFT_NOT_FOUND",
        "No curated draft exists for this item; ACCEPT first",
      );
    }
    if (item.draftRule.version !== input.expectedVersion) {
      throw HttpError.conflict(
        "DRAFT_VERSION_CONFLICT",
        "Draft was updated by another admin; reload and retry",
        { expectedVersion: input.expectedVersion, currentVersion: item.draftRule.version },
      );
    }

    const draftInput = composeReviewDraftInput(item, input.businessMetadata);
    const otherDraftKeys = await loadOtherDraftCanonicalKeys(this.prisma, item.id);
    const validation = validateCuratedDraftRule(draftInput, {
      existingCanonicalKeys: new Set(getAllRegisteredRules().map((r) => r.canonicalKey)),
      otherDraftCanonicalKeys: otherDraftKeys,
    });
    if (validation.errors.length > 0) {
      throw HttpError.badRequest("DRAFT_VALIDATION_FAILED", validation.errors[0]!.message, validation);
    }

    const previousState = {
      decisionAction: item.decisionAction,
      draftRule: item.draftRule,
      version: item.draftRule.version,
      itemVersion: item.version,
    };
    const acceptedActions = new Set([
      "ACCEPT",
      "ACCEPT_PROPOSED",
      "KEEP_CURRENT",
      "CONFIRM_REMOVAL",
    ]);
    const reopenAccepted =
      item.kind === "NEW_ABILITY_CANDIDATE" &&
      item.decisionAction != null &&
      acceptedActions.has(item.decisionAction) &&
      validation.status === "NEEDS_METADATA";

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.abilityCatalogDraftRule.updateMany({
        where: { id: item.draftRule!.id, version: input.expectedVersion },
        data: {
          ...draftPersistData(draftInput, validation.status),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw HttpError.conflict(
          "DRAFT_VERSION_CONFLICT",
          "Draft was updated by another admin; reload and retry",
        );
      }
      if (reopenAccepted) {
        await tx.abilityCatalogReviewItem.update({
          where: { id: itemId },
          data: {
            decisionAction: null,
            decisionNote: input.note ?? "Reopened: curated draft is no longer ready for acceptance",
            decidedAt: null,
            decidedByUserId: null,
            version: { increment: 1 },
          },
        });
      }
      await tx.abilityCatalogReviewDecisionEvent.create({
        data: {
          id: randomUUID(),
          itemId,
          actorUserId: audit.userId ?? null,
          actorType: audit.actorType,
          previousState: previousState as Prisma.InputJsonValue,
          newState: {
            action: reopenAccepted ? "DRAFT_UPDATE_REOPEN" : "DRAFT_UPDATE",
            businessMetadata: input.businessMetadata,
            status: validation.status,
            version: input.expectedVersion + 1,
            decisionAction: reopenAccepted ? null : item.decisionAction,
          } as Prisma.InputJsonValue,
          note: input.note ?? null,
        },
      });
    });

    await this.audit("admin.ability_catalog.review.draft_update", itemId, audit, {
      expectedVersion: input.expectedVersion,
      status: validation.status,
      reasonCodes: validation.reasonCodes,
      reopened: reopenAccepted,
    });

    return this.getItem(itemId);
  }

  /**
   * Create a curated draft for NEW/BINDING review items without accepting.
   * Idempotent when a draft already exists.
   */
  async ensureDraft(
    itemId: string,
    body: unknown,
    audit: AbilityCatalogReviewAuditContext,
  ): Promise<AbilityCatalogReviewItemDTO> {
    const input = parseBody(validateAbilityCatalogDraftRequestSchema, body ?? {});
    const item = await this.prisma.abilityCatalogReviewItem.findUnique({
      where: { id: itemId },
      include: {
        draftRule: true,
        draftTopology: true,
        batch: { select: { wowBuild: true, createdAt: true } },
      },
    });
    if (!item) {
      throw HttpError.notFound("REVIEW_ITEM_NOT_FOUND", "Ability catalog review item was not found");
    }
    if (item.kind !== "NEW_ABILITY_CANDIDATE" && item.kind !== "SPELL_BINDING_REVIEW") {
      throw HttpError.badRequest(
        "DRAFT_ENSURE_UNSUPPORTED",
        `ensureDraft is not supported for kind ${item.kind}`,
      );
    }
    if (item.draftRule) {
      return this.getItem(itemId);
    }

    const draftInput = composeReviewDraftInput(item, input.businessMetadata, {
      wowBuild: item.batch.wowBuild,
      generatedAt: item.batch.createdAt.toISOString(),
    });
    const otherDraftKeys = await loadOtherDraftCanonicalKeys(this.prisma, item.id);
    const validation = validateCuratedDraftRule(draftInput, {
      existingCanonicalKeys: new Set(getAllRegisteredRules().map((r) => r.canonicalKey)),
      otherDraftCanonicalKeys: otherDraftKeys,
    });
    if (validation.errors.length > 0) {
      throw HttpError.badRequest("DRAFT_VALIDATION_FAILED", validation.errors[0]!.message, validation);
    }

    await this.prisma.$transaction(async (tx) => {
      await upsertDraftRule(tx, item, draftInput, validation.status, audit.userId ?? null);
      await tx.abilityCatalogReviewDecisionEvent.create({
        data: {
          id: randomUUID(),
          itemId,
          actorUserId: audit.userId ?? null,
          actorType: audit.actorType,
          previousState: { decisionAction: item.decisionAction, draftRuleId: null },
          newState: {
            action: "DRAFT_ENSURE",
            status: validation.status,
            decisionAction: item.decisionAction,
          } as Prisma.InputJsonValue,
          note: null,
        },
      });
    });

    await this.audit("admin.ability_catalog.review.draft_ensure", itemId, audit, {
      status: validation.status,
      reasonCodes: validation.reasonCodes,
    });

    return this.getItem(itemId);
  }

  async validateDraft(
    itemId: string,
    body: unknown = {},
  ): Promise<{ itemId: string; validation: AbilityCatalogDraftValidationDTO; draft: unknown | null }> {
    const input = parseBody(validateAbilityCatalogDraftRequestSchema, body);
    const item = await this.prisma.abilityCatalogReviewItem.findUnique({
      where: { id: itemId },
      include: {
        draftRule: true,
        batch: { select: { wowBuild: true, createdAt: true } },
      },
    });
    if (!item) {
      throw HttpError.notFound("REVIEW_ITEM_NOT_FOUND", "Ability catalog review item was not found");
    }
    const draftInput = composeReviewDraftInput(
      item,
      input.businessMetadata,
      {
        wowBuild: item.batch.wowBuild,
        generatedAt: item.batch.createdAt.toISOString(),
      },
    );
    const otherDraftKeys = await loadOtherDraftCanonicalKeys(this.prisma, item.id);
    const validation = validateCuratedDraftRule(draftInput, {
      existingCanonicalKeys: new Set(getAllRegisteredRules().map((r) => r.canonicalKey)),
      otherDraftCanonicalKeys: otherDraftKeys,
    });
    return {
      itemId,
      validation: toValidationDto(validation),
      draft: item.draftRule,
    };
  }

  async exportBaselinePayload(baselineId: string): Promise<{
    baselineId: string;
    contentHash: string;
    source: string;
    sourceRevision: string;
    bytes: Buffer;
  }> {
    const baseline = await this.prisma.abilityCatalogSourceBaseline.findUnique({
      where: { id: baselineId },
    });
    if (!baseline) {
      throw HttpError.notFound("BASELINE_NOT_FOUND", "Ability catalog source baseline was not found");
    }
    if (!baseline.artifactId && !baseline.contentHash) {
      throw HttpError.badRequest("BASELINE_ARTIFACT_MISSING", "Baseline has no artifact reference");
    }
    const artifact =
      (baseline.artifactId
        ? await this.prisma.rawArtifact.findUnique({ where: { id: baseline.artifactId } })
        : null) ??
      (await this.prisma.rawArtifact.findUnique({ where: { contentHash: baseline.contentHash } }));
    if (!artifact) {
      throw HttpError.badRequest(
        "BASELINE_ARTIFACT_MISSING",
        "Baseline RawArtifact was not found; cannot export snapshot bytes",
      );
    }
    if (artifact.contentHash.toLowerCase() !== baseline.contentHash.toLowerCase()) {
      throw HttpError.badRequest(
        "BASELINE_DIGEST_MISMATCH",
        "Baseline contentHash does not match RawArtifact contentHash",
      );
    }
    const store = createPostgresArtifactStore(this.prisma);
    const read = await store.readByContentHash(artifact.contentHash);
    const verified = digestReportBytes(read.bytes);
    if (verified !== baseline.contentHash.toLowerCase()) {
      throw HttpError.badRequest(
        "BASELINE_DIGEST_MISMATCH",
        "Exported payload SHA-256 does not match baseline contentHash",
      );
    }
    return {
      baselineId: baseline.id,
      contentHash: baseline.contentHash,
      source: baseline.source,
      sourceRevision: baseline.sourceRevision,
      bytes: read.bytes,
    };
  }

  async designateBaseline(
    body: unknown,
    audit: AbilityCatalogReviewAuditContext,
  ): Promise<{
    id: string;
    source: string;
    sourceRevision: string;
    contentHash: string;
    artifactId: string | null;
    isActive: boolean;
    designatedAt: string;
  }> {
    const input = parseBody(designateAbilityCatalogBaselineRequestSchema, body);
    const id = await this.prisma.$transaction((tx) =>
      this.designateBaselineInTx(tx, input, audit, randomUUID()),
    );
    await this.audit("admin.ability_catalog.baseline.designate", id, audit, {
      source: input.source,
      contentHash: input.contentHash,
      activate: input.activate ?? true,
    });
    const row = await this.prisma.abilityCatalogSourceBaseline.findUniqueOrThrow({ where: { id } });
    return {
      id: row.id,
      source: row.source,
      sourceRevision: row.sourceRevision,
      contentHash: row.contentHash,
      artifactId: row.artifactId,
      isActive: row.isActive,
      designatedAt: row.designatedAt.toISOString(),
    };
  }

  async getActiveBaseline(source = "SIMULATIONCRAFT"): Promise<{
    id: string;
    source: string;
    sourceRevision: string;
    wowBuild: string | null;
    dataMode: string | null;
    retrievedAt: string;
    schemaVersion: string | null;
    extractorVersion: string | null;
    contentHash: string;
    artifactId: string | null;
    isActive: boolean;
    notes: string | null;
    designatedAt: string;
  } | null> {
    const row = await this.prisma.abilityCatalogSourceBaseline.findFirst({
      where: { source, isActive: true },
      orderBy: { designatedAt: "desc" },
    });
    if (!row) return null;
    return {
      id: row.id,
      source: row.source,
      sourceRevision: row.sourceRevision,
      wowBuild: row.wowBuild,
      dataMode: row.dataMode,
      retrievedAt: row.retrievedAt.toISOString(),
      schemaVersion: row.schemaVersion,
      extractorVersion: row.extractorVersion,
      contentHash: row.contentHash,
      artifactId: row.artifactId,
      isActive: row.isActive,
      notes: row.notes,
      designatedAt: row.designatedAt.toISOString(),
    };
  }

  private async designateBaselineInTx(
    tx: Prisma.TransactionClient,
    input: {
      source: "SIMULATIONCRAFT" | "BLIZZARD";
      sourceRevision: string;
      wowBuild?: string | null;
      dataMode?: string | null;
      retrievedAt: string;
      schemaVersion?: string | null;
      extractorVersion?: string | null;
      contentHash: string;
      artifactId?: string | null;
      notes?: string | null;
      activate?: boolean;
    },
    audit: AbilityCatalogReviewAuditContext,
    baselineId: string,
  ): Promise<string> {
    const activate = input.activate ?? true;
    const contentHash = input.contentHash.toLowerCase();

    let artifactId = input.artifactId ?? null;
    if (artifactId) {
      const artifact = await tx.rawArtifact.findUnique({ where: { id: artifactId } });
      if (!artifact) {
        throw HttpError.badRequest("ARTIFACT_NOT_FOUND", "Baseline artifactId was not found");
      }
      if (artifact.contentHash.toLowerCase() !== contentHash) {
        throw HttpError.badRequest(
          "ARTIFACT_HASH_MISMATCH",
          "Baseline artifactId contentHash does not match request contentHash",
        );
      }
    } else {
      const artifact = await tx.rawArtifact.findUnique({ where: { contentHash } });
      if (!artifact) {
        throw HttpError.badRequest(
          "BASELINE_ARTIFACT_REQUIRED",
          "contentHash must already exist as RawArtifact (import snapshot bytes first) or pass artifactId",
        );
      }
      artifactId = artifact.id;
    }

    const existing = await tx.abilityCatalogSourceBaseline.findUnique({
      where: {
        source_contentHash: { source: input.source, contentHash },
      },
    });
    const ownerId = existing?.id ?? baselineId;

    await ensureArtifactReference(tx, {
      artifactId,
      ownerType: OWNER_BASELINE,
      ownerId,
    });

    if (activate) {
      await tx.abilityCatalogSourceBaseline.updateMany({
        where: { source: input.source, isActive: true },
        data: { isActive: false },
      });
    }

    if (existing) {
      await tx.abilityCatalogSourceBaseline.update({
        where: { id: existing.id },
        data: {
          isActive: activate ? true : existing.isActive,
          notes: input.notes ?? existing.notes,
          artifactId,
          designatedByUserId: audit.userId ?? existing.designatedByUserId,
          designatedAt: activate ? new Date() : existing.designatedAt,
        },
      });
      return existing.id;
    }

    await tx.abilityCatalogSourceBaseline.create({
      data: {
        id: baselineId,
        source: input.source,
        sourceRevision: input.sourceRevision,
        wowBuild: input.wowBuild ?? null,
        dataMode: input.dataMode ?? null,
        retrievedAt: new Date(input.retrievedAt),
        schemaVersion: input.schemaVersion ?? null,
        extractorVersion: input.extractorVersion ?? null,
        contentHash,
        artifactId,
        isActive: activate,
        notes: input.notes ?? null,
        designatedByUserId: audit.userId ?? null,
      },
    });
    return baselineId;
  }

  private async applyDecisionSideEffects(
    tx: Prisma.TransactionClient,
    item: {
      id: string;
      kind: string;
      name: string;
      primarySpellId: number | null;
      matchedCanonicalKey: string | null;
      classSlug: string | null;
      specSlugs: Prisma.JsonValue;
      raceSlugs: Prisma.JsonValue;
      evidence: Prisma.JsonValue;
      sourceProvenance: Prisma.JsonValue;
      draftRule: {
        id: string;
        version: number;
        canonicalKey: string | null;
        name: string;
        spellIds: Prisma.JsonValue;
        bindings: Prisma.JsonValue;
        iconName: string | null;
        classSlug: string | null;
        specSlugs: Prisma.JsonValue;
        raceSlugs: Prisma.JsonValue;
        category: string | null;
        dimensionTags: Prisma.JsonValue;
        availability: string | null;
        cooldownSeconds: number | null;
        charges: number | null;
        sourceOwnership: string | null;
        provenance: Prisma.JsonValue;
        validityBuild: string | null;
        notes: string | null;
      } | null;
      draftTopology: { id: string; version: number } | null;
    },
    input: DecideAbilityCatalogReviewItemRequest,
    audit: AbilityCatalogReviewAuditContext,
  ): Promise<void> {
    if (item.kind === "NEW_ABILITY_CANDIDATE" && input.action === "EXCLUDE") {
      await upsertAbilityCatalogExclusion(tx, {
        canonicalKey: item.matchedCanonicalKey,
        primarySpellId: item.primarySpellId,
        userId: audit.userId ?? null,
      });
      return;
    }

    if (item.kind === "NEW_ABILITY_CANDIDATE" && input.action === "ACCEPT") {
      const draftInput = composeReviewDraftInput(item, input.businessMetadata);
      const otherDraftKeys = await loadOtherDraftCanonicalKeys(tx, item.id);
      const validation = validateCuratedDraftRule(draftInput, {
        existingCanonicalKeys: new Set(getAllRegisteredRules().map((r) => r.canonicalKey)),
        otherDraftCanonicalKeys: otherDraftKeys,
      });
      if (validation.errors.length > 0) {
        throw HttpError.badRequest("DRAFT_VALIDATION_FAILED", validation.errors[0]!.message, validation);
      }
      if (!draftInput.category) {
        throw HttpError.badRequest(
          "DRAFT_NOT_READY",
          "Category is required before this ability can be accepted.",
          validation,
        );
      }
      if (!validation.readyForPublishReview) {
        const reason = validation.reasonCodes.join(", ") || "incomplete metadata";
        throw HttpError.badRequest(
          "DRAFT_NOT_READY",
          `Draft is not ready for acceptance (${reason}). Complete required curation first.`,
          validation,
        );
      }
      await upsertDraftRule(tx, item, draftInput, validation.status, audit.userId ?? null);
      return;
    }

    if (item.kind === "SPELL_BINDING_REVIEW") {
      if (input.action === "DEFER") return;

      if (input.action === "KEEP_CURRENT") {
        const catalogRule = resolveCatalogRuleByKey(item.matchedCanonicalKey);
        if (!catalogRule) {
          throw HttpError.badRequest(
            "KEEP_CURRENT_NO_CATALOG_RULE",
            "KEEP_CURRENT requires an existing catalog AbilityRule.",
          );
        }
        const draftInput = catalogRuleToCuratedDraftInput(catalogRule);
        const validation = validateCuratedDraftRule(draftInput, {
          existingCanonicalKeys: new Set(),
          otherDraftCanonicalKeys: new Set(),
        });
        const blocking = validation.errors.filter((e) => e.code !== "CANONICAL_KEY_COLLISION");
        if (blocking.length > 0) {
          throw HttpError.badRequest("DRAFT_VALIDATION_FAILED", blocking[0]!.message, validation);
        }
        await upsertDraftRule(tx, item, draftInput, validation.status, audit.userId ?? null);
        return;
      }

      if (input.action !== "ACCEPT_PROPOSED") return;

      const evidence = asRecord(item.evidence);
      const bindingChanges = Array.isArray(evidence.bindingChanges)
        ? (evidence.bindingChanges as Array<{
            spellId: number;
            currentRoles?: string[];
            candidateRoles?: string[];
          }>)
        : [];
      const bindings: Array<{ spellId: number; role: string }> = [];
      for (const change of bindingChanges) {
        for (const role of change.candidateRoles ?? []) {
          bindings.push({ spellId: change.spellId, role });
        }
      }
      const catalogRule = resolveCatalogRuleByKey(item.matchedCanonicalKey);
      const basePrefill = catalogRule
        ? catalogRuleToCuratedDraftInput(catalogRule)
        : reviewDraftPrefill(item);
      const spellIds = [...new Set(bindings.map((b) => b.spellId))];
      const withBindings: CuratedDraftRuleInput = {
        ...basePrefill,
        canonicalKey: item.matchedCanonicalKey ?? basePrefill.canonicalKey,
        name: item.name,
        spellIds: spellIds.length > 0 ? spellIds : basePrefill.spellIds,
        bindings: bindings as CuratedDraftRuleInput["bindings"],
        notes: input.note ?? basePrefill.notes ?? null,
      };
      const draftInput = input.businessMetadata
        ? applyBusinessMetadataToReviewDraft(withBindings, input.businessMetadata)
        : withBindings;
      const validation = validateCuratedDraftRule(draftInput, {
        existingCanonicalKeys: new Set(), // binding drafts may reuse runtime keys
        otherDraftCanonicalKeys: new Set(),
      });
      const status =
        validation.errors.filter((e) => e.code !== "CANONICAL_KEY_COLLISION").length > 0
          ? "NEEDS_METADATA"
          : validation.status;
      const blocking = validation.errors.filter((e) => e.code !== "CANONICAL_KEY_COLLISION");
      if (blocking.length > 0) {
        throw HttpError.badRequest("DRAFT_VALIDATION_FAILED", blocking[0]!.message, validation);
      }
      await upsertDraftRule(tx, item, draftInput, status, audit.userId ?? null);
      return;
    }

    if (item.kind === "TOPOLOGY_REVIEW" && input.action === "ACCEPT") {
      const evidence = asRecord(item.evidence);
      const kind = typeof evidence.topologyKind === "string" ? evidence.topologyKind : "RACE";
      const slug =
        (typeof evidence.slug === "string" ? evidence.slug : null) ??
        asStringArray(item.raceSlugs)[0] ??
        item.name;
      if (item.draftTopology) {
        await tx.abilityCatalogDraftTopology.update({
          where: { id: item.draftTopology.id },
          data: {
            kind,
            slug,
            displayName: item.name,
            status: "ACCEPTED",
            evidence: item.evidence as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
        });
      } else {
        await tx.abilityCatalogDraftTopology.create({
          data: {
            id: randomUUID(),
            reviewItemId: item.id,
            kind,
            slug,
            displayName: item.name,
            status: "ACCEPTED",
            evidence: item.evidence as Prisma.InputJsonValue,
          },
        });
      }
    }
  }

  private async requireBatch(id: string) {
    const row = await this.prisma.abilityCatalogReviewBatch.findUnique({ where: { id } });
    if (!row) {
      throw HttpError.notFound("REVIEW_BATCH_NOT_FOUND", "Ability catalog review batch was not found");
    }
    return row;
  }

  private async audit(
    action: string,
    resourceId: string,
    ctx: AbilityCatalogReviewAuditContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditEvent(this.prisma, {
      userId: ctx.userId,
      actorType: ctx.actorType,
      action,
      resourceType: "ability_catalog_review",
      resourceId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      sessionSecret: ctx.sessionSecret,
      metadata,
    });
  }
}

/**
 * Persist bytes as RawArtifact (INTERNAL) + RawArtifactPayload + ArtifactReference
 * inside an open Prisma transaction.
 */
export async function persistInternalBytes(
  tx: Prisma.TransactionClient,
  input: {
    bytes: Buffer;
    artifactClass: string;
    ownerType: string;
    ownerId: string;
  },
): Promise<{ artifactId: string; contentHash: string }> {
  const contentHash = sha256Hex(input.bytes);
  const storageUri = `pg://sha256/${contentHash}`;
  const size = BigInt(input.bytes.byteLength);

  const existingPayload = await tx.rawArtifactPayload.findUnique({ where: { contentHash } });
  if (!existingPayload) {
    await tx.rawArtifactPayload.create({
      data: {
        contentHash,
        compression: "NONE",
        payload: new Uint8Array(input.bytes),
        compressedSizeBytes: size,
        uncompressedSizeBytes: size,
      },
    });
  }

  const artifact = await tx.rawArtifact.upsert({
    where: { contentHash },
    create: {
      id: randomUUID(),
      provider: "INTERNAL",
      storageUri,
      compression: "NONE",
      contentHash,
      sizeBytes: size,
      uncompressedSizeBytes: size,
      artifactClass: input.artifactClass,
      refCount: 0,
    },
    update: {
      storageUri,
      artifactClass: input.artifactClass,
      sizeBytes: size,
      uncompressedSizeBytes: size,
    },
  });

  await ensureArtifactReference(tx, {
    artifactId: artifact.id,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
  });

  return { artifactId: artifact.id, contentHash };
}

async function ensureArtifactReference(
  tx: Prisma.TransactionClient,
  input: { artifactId: string; ownerType: string; ownerId: string },
): Promise<void> {
  const existing = await tx.artifactReference.findUnique({
    where: {
      ownerType_ownerId_artifactId: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        artifactId: input.artifactId,
      },
    },
  });
  if (existing) return;
  await tx.artifactReference.create({
    data: {
      id: randomUUID(),
      artifactId: input.artifactId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
    },
  });
  await tx.rawArtifact.update({
    where: { id: input.artifactId },
    data: { refCount: { increment: 1 } },
  });
}

function resolveCatalogRuleByKey(canonicalKey: string | null | undefined): AbilityRule | null {
  if (!canonicalKey) return null;
  return getAllRegisteredRules().find((rule) => rule.canonicalKey === canonicalKey) ?? null;
}

function catalogRuleToCuratedDraftInput(rule: AbilityRule) {
  const bindings = projectCurrentRuleBindings(rule).map((binding) => ({
    spellId: binding.spellId,
    role: binding.role,
  }));
  const spellIdSet = new Set<number>(rule.spellIds);
  for (const binding of bindings) spellIdSet.add(binding.spellId);
  const spellIds = [...spellIdSet].sort((a, b) => a - b);
  return {
    canonicalKey: rule.canonicalKey,
    name: rule.name,
    spellIds,
    bindings,
    iconName: rule.iconName ?? null,
    classSlug: rule.classSlug,
    specSlugs: [...rule.specSlugs],
    raceSlugs: [...(rule.raceSlugs ?? [])],
    category: rule.category,
    dimensionTags: dimensionTagsForRule(rule),
    availability: rule.availability,
    cooldownSeconds: rule.cooldownSeconds ?? null,
    charges: rule.charges ?? null,
    sourceOwnership: rule.sourceOwnership,
    provenance: { ...rule.provenance } as Record<string, unknown>,
    validityBuild: rule.validFromBuild ?? null,
    validFromBuild: rule.validFromBuild ?? null,
    validToBuild: rule.validToBuild ?? null,
    notes: rule.provenance.notes ?? null,
  };
}

async function upsertDraftRule(
  tx: Prisma.TransactionClient,
  item: { id: string; draftRule: { id: string } | null },
  draft: Parameters<typeof draftPersistData>[0],
  status: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW",
  userId: string | null,
): Promise<void> {
  const data = draftPersistData(draft, status);
  if (item.draftRule) {
    await tx.abilityCatalogDraftRule.update({
      where: { id: item.draftRule.id },
      data: { ...data, version: { increment: 1 } },
    });
  } else {
    await tx.abilityCatalogDraftRule.create({
      data: {
        id: randomUUID(),
        reviewItemId: item.id,
        createdByUserId: userId,
        ...data,
      },
    });
  }
}

function draftPersistData(
  draft: {
    canonicalKey?: string | null;
    name: string;
    spellIds: number[];
    bindings: unknown;
    iconName?: string | null;
    classSlug?: string | null;
    specSlugs?: string[];
    raceSlugs?: string[];
    category?: string | null;
    dimensionTags?: string[];
    availability?: string | null;
    cooldownSeconds?: number | null;
    charges?: number | null;
    sourceOwnership?: string | null;
    provenance?: Record<string, unknown> | null;
    validityBuild?: string | null;
    validFromBuild?: string | null;
    validToBuild?: string | null;
    notes?: string | null;
  },
  status: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW",
) {
  const validFrom = draft.validFromBuild ?? draft.validityBuild ?? null;
  const provenance = {
    ...(draft.provenance ?? {}),
    ...(draft.validToBuild ? { validToBuild: draft.validToBuild } : {}),
    ...(validFrom ? { validFromBuild: validFrom } : {}),
  };
  return {
    canonicalKey: draft.canonicalKey ?? null,
    name: draft.name,
    spellIds: draft.spellIds as Prisma.InputJsonValue,
    bindings: draft.bindings as Prisma.InputJsonValue,
    iconName: draft.iconName ?? null,
    classSlug: draft.classSlug ?? null,
    specSlugs: (draft.specSlugs ?? []) as Prisma.InputJsonValue,
    raceSlugs: (draft.raceSlugs ?? []) as Prisma.InputJsonValue,
    category: draft.category ?? null,
    dimensionTags: (draft.dimensionTags ?? []) as Prisma.InputJsonValue,
    availability: draft.availability ?? null,
    cooldownSeconds: draft.cooldownSeconds ?? null,
    charges: draft.charges ?? null,
    sourceOwnership: draft.sourceOwnership ?? null,
    provenance: provenance as Prisma.InputJsonValue,
    validityBuild: validFrom,
    notes: draft.notes ?? null,
    status,
  };
}

function reviewDraftPrefill(
  item: {
    name: string;
    primarySpellId: number | null;
    matchedCanonicalKey: string | null;
    classSlug: string | null;
    specSlugs: Prisma.JsonValue;
    raceSlugs: Prisma.JsonValue;
    evidence?: Prisma.JsonValue;
    sourceProvenance?: Prisma.JsonValue;
    draftRule?: {
      canonicalKey: string | null;
      name: string;
      spellIds: Prisma.JsonValue;
      bindings: Prisma.JsonValue;
      iconName: string | null;
      classSlug: string | null;
      specSlugs: Prisma.JsonValue;
      raceSlugs: Prisma.JsonValue;
      category: string | null;
      dimensionTags: Prisma.JsonValue;
      availability: string | null;
      cooldownSeconds: number | null;
      charges: number | null;
      sourceOwnership: string | null;
      provenance: Prisma.JsonValue;
      validityBuild: string | null;
      notes: string | null;
    } | null;
  },
  context?: { wowBuild?: string | null; generatedAt?: string | null },
): CuratedDraftRuleInput {
  if (item.draftRule) {
    return draftRowToInput(item.draftRule);
  }
  return prefillCuratedDraftDefaults({
    name: item.name,
    primarySpellId: item.primarySpellId,
    matchedCanonicalKey: item.matchedCanonicalKey,
    classSlug: item.classSlug,
    specSlugs: asStringArray(item.specSlugs),
    raceSlugs: asStringArray(item.raceSlugs),
    evidence: asRecord(item.evidence ?? null),
    sourceProvenance: asRecord(item.sourceProvenance ?? null),
    wowBuild: context?.wowBuild ?? null,
    generatedAt: context?.generatedAt ?? null,
  });
}

function composeReviewDraftInput(
  item: {
    name: string;
    primarySpellId: number | null;
    matchedCanonicalKey: string | null;
    classSlug: string | null;
    specSlugs: Prisma.JsonValue;
    raceSlugs: Prisma.JsonValue;
    evidence?: Prisma.JsonValue;
    sourceProvenance?: Prisma.JsonValue;
    draftRule?: {
      canonicalKey: string | null;
      name: string;
      spellIds: Prisma.JsonValue;
      bindings: Prisma.JsonValue;
      iconName: string | null;
      classSlug: string | null;
      specSlugs: Prisma.JsonValue;
      raceSlugs: Prisma.JsonValue;
      category: string | null;
      dimensionTags: Prisma.JsonValue;
      availability: string | null;
      cooldownSeconds: number | null;
      charges: number | null;
      sourceOwnership: string | null;
      provenance: Prisma.JsonValue;
      validityBuild: string | null;
      notes: string | null;
    } | null;
  },
  businessMetadata?: AbilityBusinessMetadataPatch,
  context?: { wowBuild?: string | null; generatedAt?: string | null },
): CuratedDraftRuleInput {
  const prefill = reviewDraftPrefill(item, context);
  if (!businessMetadata) return prefill;
  return applyBusinessMetadataToReviewDraft(prefill, businessMetadata);
}

function draftRowToInput(row: {
  canonicalKey: string | null;
  name: string;
  spellIds: Prisma.JsonValue;
  bindings: Prisma.JsonValue;
  iconName: string | null;
  classSlug: string | null;
  specSlugs: Prisma.JsonValue;
  raceSlugs: Prisma.JsonValue;
  category: string | null;
  dimensionTags: Prisma.JsonValue;
  availability: string | null;
  cooldownSeconds: number | null;
  charges: number | null;
  sourceOwnership: string | null;
  provenance: Prisma.JsonValue;
  validityBuild: string | null;
  notes: string | null;
}) {
  const provenance = asRecord(row.provenance);
  const bindings = Array.isArray(row.bindings)
    ? (row.bindings as Array<{ spellId: number; role: string }>).map((b) => ({
        spellId: b.spellId,
        role: b.role as "PRIMARY_ACTIVATION",
      }))
    : [];
  return {
    canonicalKey: row.canonicalKey,
    name: row.name,
    spellIds: Array.isArray(row.spellIds)
      ? row.spellIds.filter((v): v is number => typeof v === "number")
      : [],
    bindings,
    iconName: row.iconName,
    classSlug: row.classSlug,
    specSlugs: asStringArray(row.specSlugs),
    raceSlugs: asStringArray(row.raceSlugs),
    category: row.category as never,
    dimensionTags: asStringArray(row.dimensionTags) as never,
    availability: row.availability as never,
    cooldownSeconds: row.cooldownSeconds,
    charges: row.charges,
    sourceOwnership: row.sourceOwnership as never,
    provenance,
    validityBuild: row.validityBuild,
    validFromBuild:
      (typeof provenance.validFromBuild === "string" ? provenance.validFromBuild : null) ??
      row.validityBuild,
    validToBuild: typeof provenance.validToBuild === "string" ? provenance.validToBuild : null,
    notes: row.notes,
  };
}

function toValidationDto(
  validation: ReturnType<typeof validateCuratedDraftRule>,
): AbilityCatalogDraftValidationDTO {
  return {
    status: validation.status,
    readyForPublishReview: validation.readyForPublishReview,
    reasonCodes: validation.reasonCodes,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

async function loadOtherDraftCanonicalKeys(
  tx: Prisma.TransactionClient | PrismaClient,
  excludeItemId: string,
): Promise<Set<string>> {
  const rows = await tx.abilityCatalogDraftRule.findMany({
    where: {
      reviewItemId: { not: excludeItemId },
      canonicalKey: { not: null },
    },
    select: { canonicalKey: true },
  });
  return new Set(rows.map((r) => r.canonicalKey!).filter(Boolean));
}

function assertDecisionAllowed(kind: string, action: string): void {
  const ok =
    (kind === "NEW_ABILITY_CANDIDATE" && NEW_SET.has(action)) ||
    (kind === "SPELL_BINDING_REVIEW" && BINDING_SET.has(action)) ||
    (kind === "TOPOLOGY_REVIEW" && TOPOLOGY_SET.has(action)) ||
    (kind === "REMOVAL_REVIEW" && REMOVAL_SET.has(action));
  if (!ok) {
    throw HttpError.badRequest(
      "INVALID_DECISION_ACTION",
      `Action ${action} is not valid for review kind ${kind}`,
    );
  }
}

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw HttpError.badRequest(
      "VALIDATION_ERROR",
      firstZodIssueMessage(parsed.error),
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function asStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function decisionCounts(
  items: Array<{
    decisionAction: string | null;
    draftRule?: { status: string } | null;
  }>,
): AbilityCatalogReviewBatchDTO["decisionCounts"] {
  let pending = 0;
  let decided = 0;
  let accepted = 0;
  let rejected = 0;
  let deferred = 0;
  let draftsNeedsMetadata = 0;
  let draftsReadyForPublishReview = 0;
  for (const item of items) {
    const action = item.decisionAction;
    if (action == null) {
      pending += 1;
    } else {
      decided += 1;
      if (action === "DEFER") deferred += 1;
      else if (action === "REJECT" || action === "EXCLUDE") rejected += 1;
      else accepted += 1;
    }
    if (item.draftRule?.status === "NEEDS_METADATA") draftsNeedsMetadata += 1;
    if (item.draftRule?.status === "READY_FOR_PUBLISH_REVIEW") draftsReadyForPublishReview += 1;
  }
  return {
    total: items.length,
    pending,
    decided,
    accepted,
    rejected,
    deferred,
    draftsNeedsMetadata,
    draftsReadyForPublishReview,
  };
}

function toBatchDto(
  row: {
    id: string;
    reportDigest: string;
    reviewPlanDigest: string;
    datasetKind: string;
    wowBuild: string | null;
    simcRevision: string | null;
    blizzardNamespace: string | null;
    blizzardRevision: string | null;
    status: string;
    summaryCounts: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  },
  items: Array<{ decisionAction: string | null; draftRule?: { status: string } | null }>,
): AbilityCatalogReviewBatchDTO {
  const summary =
    row.summaryCounts && typeof row.summaryCounts === "object" && !Array.isArray(row.summaryCounts)
      ? (row.summaryCounts as Record<string, number>)
      : {};
  return {
    id: row.id,
    reportDigest: row.reportDigest,
    reviewPlanDigest: row.reviewPlanDigest,
    datasetKind: row.datasetKind,
    wowBuild: row.wowBuild,
    simcRevision: row.simcRevision,
    blizzardNamespace: row.blizzardNamespace,
    blizzardRevision: row.blizzardRevision,
    status: row.status,
    summaryCounts: summary,
    decisionCounts: decisionCounts(items),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toItemDto(row: {
  id: string;
  batchId: string;
  kind: AbilityCatalogReviewItemDTO["kind"];
  identityKey: string;
  primarySpellId: number | null;
  name: string;
  matchedCanonicalKey: string | null;
  classSlug: string | null;
  specSlugs: Prisma.JsonValue;
  raceSlugs: Prisma.JsonValue;
  eligibilityState: string | null;
  eligibilityReasons: Prisma.JsonValue;
  reviewReason: string;
  evidence: Prisma.JsonValue;
  sourceProvenance: Prisma.JsonValue;
  decisionAction: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  draftRule: {
    canonicalKey: string | null;
    name: string;
    spellIds: Prisma.JsonValue;
    bindings: Prisma.JsonValue;
    iconName: string | null;
    classSlug: string | null;
    specSlugs: Prisma.JsonValue;
    raceSlugs: Prisma.JsonValue;
    category: string | null;
    dimensionTags: Prisma.JsonValue;
    availability: string | null;
    cooldownSeconds: number | null;
    charges: number | null;
    sourceOwnership: string | null;
    provenance: Prisma.JsonValue;
    validityBuild: string | null;
    notes: string | null;
    status: string;
    version: number;
  } | null;
  draftTopology: unknown | null;
  decisionEvents?: Array<{
    id: string;
    actorUserId: string | null;
    actorType: string;
    previousState: Prisma.JsonValue;
    newState: Prisma.JsonValue;
    note: string | null;
    createdAt: Date;
  }>;
}, mplusCtx: MplusRelevanceContext): AbilityCatalogReviewItemDTO {
  const draftValidation = row.draftRule
    ? toValidationDto(
        validateCuratedDraftRule(draftRowToInput(row.draftRule), {
          existingCanonicalKeys: new Set(getAllRegisteredRules().map((r) => r.canonicalKey)),
        }),
      )
    : null;
  const mplusRelevance = resolveMplusRelevance({
    canonicalKey: row.matchedCanonicalKey,
    primarySpellId: row.primarySpellId,
    ...mplusCtx,
  });
  return {
    id: row.id,
    batchId: row.batchId,
    kind: row.kind,
    identityKey: row.identityKey,
    primarySpellId: row.primarySpellId,
    name: row.name,
    matchedCanonicalKey: row.matchedCanonicalKey,
    classSlug: row.classSlug,
    specSlugs: asStringArray(row.specSlugs),
    raceSlugs: asStringArray(row.raceSlugs),
    eligibilityState: row.eligibilityState,
    eligibilityReasons: asStringArray(row.eligibilityReasons),
    reviewReason: row.reviewReason,
    evidence: row.evidence,
    sourceProvenance: row.sourceProvenance,
    decisionAction: row.decisionAction,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    version: row.version,
    draftRule: row.draftRule ?? null,
    draftTopology: row.draftTopology ?? null,
    draftStatus: row.draftRule?.status ?? null,
    draftValidation,
    mplusRelevance,
    decisionEvents: (row.decisionEvents ?? []).map((ev) => ({
      id: ev.id,
      actorUserId: ev.actorUserId,
      actorType: ev.actorType,
      previousState: ev.previousState,
      newState: ev.newState,
      note: ev.note,
      createdAt: ev.createdAt.toISOString(),
    })),
    wowheadUrl: row.primarySpellId != null ? wowheadSpellUrl(row.primarySpellId) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
