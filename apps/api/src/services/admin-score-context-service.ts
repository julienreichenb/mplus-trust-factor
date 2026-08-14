import { randomUUID } from "node:crypto";
import { getRetailClassMatrix } from "@mplus/abilities";
import {
  formatPercentileBpsLabel,
  type SeasonScoreContextRevisionDoc,
} from "@mplus/contracts";
import {
  SeasonScoreContextRepository,
  type PrismaClient,
} from "@mplus/database";
import { resolveAnchorsAgainstDistribution } from "@mplus/scoring";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { writeAuditEvent, type AuditInput } from "../iam/audit.js";
import { BulkCharacterProcessingService } from "./bulk-character-processing-service.js";

export type ScoreContextAuditCtx = Pick<
  AuditInput,
  "userId" | "actorType" | "ip" | "userAgent"
>;

function mapRepoError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : null;
  const issues =
    error && typeof error === "object" && "issues" in error
      ? (error as { issues: unknown }).issues
      : undefined;
  if (code === "CONTEXT_REVISION_NOT_FOUND") {
    throw HttpError.notFound(code, "Context revision was not found");
  }
  if (code === "CONTEXT_REVISION_NOT_DRAFT") {
    throw HttpError.conflict(code, "Only DRAFT revisions can be mutated or published");
  }
  if (code === "DISTRIBUTION_SNAPSHOT_NOT_FOUND") {
    throw HttpError.notFound(code, "Distribution snapshot was not found");
  }
  if (code === "DISTRIBUTION_SNAPSHOT_SEASON_MISMATCH") {
    throw HttpError.badRequest(code, "Distribution snapshot belongs to a different season");
  }
  if (
    code === "INVALID_TIER_FACTORS" ||
    code === "INVALID_PERCENTILE_ANCHORS" ||
    code === "INVALID_SPEC_ASSIGNMENTS" ||
    code === "INVALID_MEDIAN_KEY_DISTRIBUTION"
  ) {
    throw HttpError.badRequest(code, "Invalid score context configuration", issues);
  }
  throw error;
}

function assertAnchorsCompatibleWithDistribution(revision: SeasonScoreContextRevisionDoc): void {
  if (!revision.distribution || revision.percentileAnchors.length === 0) return;
  const resolved = resolveAnchorsAgainstDistribution({
    anchors: revision.percentileAnchors,
    points: revision.distribution.points,
  });
  if (resolved.length !== revision.percentileAnchors.length) {
    throw HttpError.badRequest(
      "ANCHORS_INCOMPATIBLE_WITH_SNAPSHOT",
      "Every percentile anchor must exist on the selected distribution snapshot",
    );
  }
}

export function toAdminRevisionView(revision: SeasonScoreContextRevisionDoc) {
  const resolvedAnchors = revision.distribution
    ? resolveAnchorsAgainstDistribution({
        anchors: revision.percentileAnchors,
        points: revision.distribution.points,
      }).map((a) => ({
        percentileBps: a.percentileBps,
        percentileLabel: formatPercentileBpsLabel(a.percentileBps),
        medianKeyThreshold: a.keyThreshold,
        factor: a.factor,
      }))
    : revision.percentileAnchors.map((a) => ({
        percentileBps: a.percentileBps,
        percentileLabel: formatPercentileBpsLabel(a.percentileBps),
        medianKeyThreshold: null as number | null,
        factor: a.factor,
      }));
  return {
    id: revision.id,
    seasonId: revision.seasonId,
    version: revision.version,
    status: revision.status,
    publishedAt: revision.publishedAt,
    tierFactors: revision.tierFactors,
    specAssignments: revision.specAssignments,
    percentileAnchors: revision.percentileAnchors,
    distribution: revision.distribution,
    resolvedAnchors,
    distributionMissing: revision.distribution == null,
  };
}

export class AdminScoreContextService {
  constructor(private readonly container: ApiContainer) {}

  private get prisma(): PrismaClient {
    return this.container.worker.prisma;
  }

  private repo(): SeasonScoreContextRepository {
    return new SeasonScoreContextRepository(this.prisma);
  }

  private async audit(ctx: ScoreContextAuditCtx, input: Omit<AuditInput, "sessionSecret" | "userId" | "actorType" | "ip" | "userAgent">) {
    await writeAuditEvent(this.prisma, {
      ...ctx,
      ...input,
      sessionSecret: this.container.env.SESSION_SECRET,
    });
  }

  async listSeasons() {
    const rows = await this.prisma.season.findMany({
      orderBy: [{ isCurrent: "desc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        blizzardSeasonId: true,
        isCurrent: true,
        region: { select: { code: true } },
      },
      take: 200,
    });
    return {
      seasons: rows.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        blizzardSeasonId: s.blizzardSeasonId,
        isCurrent: s.isCurrent,
        regionCode: s.region?.code ?? null,
      })),
    };
  }

  canonicalSpecializations() {
    return {
      classes: getRetailClassMatrix().map((cls) => ({
        slug: cls.slug,
        name: cls.name,
        specs: cls.specs.map((spec) => ({
          slug: spec.slug,
          name: spec.name,
          role: spec.role,
        })),
      })),
      tierSemantics: {
        1: "niche / weak",
        2: "below-meta",
        3: "average",
        4: "strong",
        5: "top-tier meta",
      },
      stepBandHelp:
        "Players use the factor from the highest median-key threshold they meet. Duplicate concrete thresholds: greatest percentile wins.",
    };
  }

  async getSeasonState(seasonId: string) {
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      select: {
        id: true,
        slug: true,
        name: true,
        blizzardSeasonId: true,
        isCurrent: true,
        region: { select: { code: true } },
      },
    });
    if (!season) throw HttpError.notFound("SEASON_NOT_FOUND", `Season ${seasonId} was not found`);
    const repo = this.repo();
    const [published, draft, history, distributions] = await Promise.all([
      repo.findPublishedForSeason(seasonId),
      repo.findDraftForSeason(seasonId),
      repo.listRevisionsForSeason(seasonId),
      repo.listDistributionsForSeason(seasonId),
    ]);
    return {
      season: {
        id: season.id,
        slug: season.slug,
        name: season.name,
        blizzardSeasonId: season.blizzardSeasonId,
        isCurrent: season.isCurrent,
        regionCode: season.region?.code ?? null,
      },
      published: published ? toAdminRevisionView(published) : null,
      draft: draft ? toAdminRevisionView(draft) : null,
      history: history.map((row) => ({
        id: row.id,
        version: row.version,
        status: row.status,
        publishedAt: row.publishedAt,
        distributionSource: row.distribution?.source ?? null,
        distributionVersion: row.distribution?.sourceVersion ?? null,
      })),
      distributions: distributions.map((d) => ({
        id: d.id,
        source: d.source,
        sourceVersion: d.sourceVersion,
        collectedAt: d.collectedAt.toISOString(),
        effectiveAt: d.effectiveAt?.toISOString() ?? null,
        contentHash: d.contentHash,
        pointCount: Array.isArray(d.points) ? d.points.length : 0,
      })),
      distributionMissing: distributions.length === 0,
      canonicalSpecializations: this.canonicalSpecializations(),
    };
  }

  async createOrGetDraft(seasonId: string, ctx: ScoreContextAuditCtx, createdByUserId: string | null) {
    await this.getSeasonState(seasonId);
    const repo = this.repo();
    const existing = await repo.findDraftForSeason(seasonId);
    if (existing) return toAdminRevisionView(existing);
    const published = await repo.findPublishedForSeason(seasonId);
    const defaultV1Anchors = [
      { percentileBps: 9000, factor: 1 },
      { percentileBps: 9900, factor: 1 },
      { percentileBps: 9990, factor: 1 },
    ];
    try {
      const created = await repo.createDraft({
        seasonId,
        createdByUserId,
        distributionSnapshotId: published?.distribution?.id ?? null,
        tierFactors: published?.tierFactors,
        specAssignments: published?.specAssignments ?? [],
        percentileAnchors:
          published?.percentileAnchors && published.percentileAnchors.length > 0
            ? published.percentileAnchors
            : defaultV1Anchors,
      });
      const doc = await repo.findById(created.id);
      if (!doc) {
        throw HttpError.internal("Draft was created but could not be reloaded");
      }
      await this.audit(ctx, {
        action: "admin.score_context.draft.create",
        resourceType: "season_score_context_revision",
        resourceId: created.id,
        metadata: { seasonId, version: created.version },
      });
      return toAdminRevisionView(doc);
    } catch (error) {
      mapRepoError(error);
    }
  }

  async updateDraft(
    revisionId: string,
    patch: {
      distributionSnapshotId?: string | null;
      tierFactors?: unknown;
      specAssignments?: unknown;
      percentileAnchors?: unknown;
    },
    ctx: ScoreContextAuditCtx,
  ) {
    const repo = this.repo();
    try {
      const before = await repo.findById(revisionId);
      if (!before) throw HttpError.notFound("CONTEXT_REVISION_NOT_FOUND", "Context revision was not found");
      const updated = await repo.updateDraft(revisionId, patch);
      assertAnchorsCompatibleWithDistribution(updated);
      const changed: string[] = [];
      if (patch.tierFactors !== undefined) changed.push("tierFactors");
      if (patch.specAssignments !== undefined) changed.push("specAssignments");
      if (patch.percentileAnchors !== undefined) changed.push("percentileAnchors");
      if (patch.distributionSnapshotId !== undefined) changed.push("distributionSnapshotId");
      await this.audit(ctx, {
        action: "admin.score_context.draft.update",
        resourceType: "season_score_context_revision",
        resourceId: revisionId,
        metadata: {
          seasonId: updated.seasonId,
          version: updated.version,
          changedFields: changed,
        },
      });
      return toAdminRevisionView(updated);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      mapRepoError(error);
    }
  }

  async importDistribution(
    input: {
      seasonId: string;
      source: string;
      provenance?: Record<string, unknown>;
      sourceVersion?: string | null;
      collectedAt: string;
      effectiveAt?: string | null;
      points: unknown;
    },
    ctx: ScoreContextAuditCtx,
  ) {
    const season = await this.prisma.season.findUnique({ where: { id: input.seasonId }, select: { id: true } });
    if (!season) throw HttpError.notFound("SEASON_NOT_FOUND", `Season ${input.seasonId} was not found`);
    const collectedAt = new Date(input.collectedAt);
    if (Number.isNaN(collectedAt.getTime())) {
      throw HttpError.badRequest("INVALID_COLLECTED_AT", "collectedAt must be an ISO timestamp");
    }
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : null;
    if (effectiveAt && Number.isNaN(effectiveAt.getTime())) {
      throw HttpError.badRequest("INVALID_EFFECTIVE_AT", "effectiveAt must be an ISO timestamp");
    }
    try {
      const snapshot = await this.repo().importDistribution({
        seasonId: input.seasonId,
        source: input.source,
        provenance: input.provenance,
        sourceVersion: input.sourceVersion ?? null,
        collectedAt,
        effectiveAt,
        points: input.points,
      });
      await this.audit(ctx, {
        action: "admin.score_context.distribution.import",
        resourceType: "season_median_key_distribution_snapshot",
        resourceId: snapshot.id,
        metadata: {
          seasonId: input.seasonId,
          source: input.source,
          sourceVersion: input.sourceVersion ?? null,
          contentHash: snapshot.contentHash,
          pointCount: Array.isArray(snapshot.points) ? snapshot.points.length : 0,
        },
      });
      return {
        id: snapshot.id,
        seasonId: snapshot.seasonId,
        source: snapshot.source,
        sourceVersion: snapshot.sourceVersion,
        collectedAt: snapshot.collectedAt.toISOString(),
        effectiveAt: snapshot.effectiveAt?.toISOString() ?? null,
        contentHash: snapshot.contentHash,
        immutable: true,
      };
    } catch (error) {
      mapRepoError(error);
    }
  }

  async publish(revisionId: string, ctx: ScoreContextAuditCtx, createdByUserId: string | null) {
    const repo = this.repo();
    let published: SeasonScoreContextRevisionDoc;
    try {
      const draft = await repo.findById(revisionId);
      if (!draft) throw HttpError.notFound("CONTEXT_REVISION_NOT_FOUND", "Context revision was not found");
      assertAnchorsCompatibleWithDistribution(draft);
      published = await repo.publish(revisionId);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      mapRepoError(error);
    }

    await this.audit(ctx, {
      action: "admin.score_context.publish",
      resourceType: "season_score_context_revision",
      resourceId: published.id,
      metadata: {
        seasonId: published.seasonId,
        version: published.version,
        contextRevisionId: published.id,
      },
    });

    const recalc = await this.enqueueRecalc(published.seasonId, ctx, createdByUserId, published);
    return {
      revision: toAdminRevisionView(published),
      recalc,
    };
  }

  async retryRecalculate(seasonId: string, ctx: ScoreContextAuditCtx, createdByUserId: string | null) {
    const published = await this.repo().findPublishedForSeason(seasonId);
    if (!published) {
      throw HttpError.conflict("NO_PUBLISHED_CONTEXT_REVISION", "Publish a draft before recalculating");
    }
    const recalc = await this.enqueueRecalc(seasonId, ctx, createdByUserId, published);
    return { revision: toAdminRevisionView(published), recalc };
  }

  private async enqueueRecalc(
    seasonId: string,
    ctx: ScoreContextAuditCtx,
    createdByUserId: string | null,
    published: SeasonScoreContextRevisionDoc,
  ) {
    const characterIds = await this.repo().listCharacterIdsWithScoresForSeason(seasonId);
    if (characterIds.length === 0) {
      await this.audit(ctx, {
        action: "admin.score_context.recalculate",
        resourceType: "season_score_context_revision",
        resourceId: published.id,
        metadata: { seasonId, version: published.version, characterCount: 0, status: "NO_SCORES" },
      });
      return {
        status: "NO_SCORES" as const,
        pinnedSeasonId: seasonId,
        bulkOperationId: null,
        characterCount: 0,
        error: null,
        retryAvailable: false,
      };
    }
    try {
      const bulk = new BulkCharacterProcessingService(this.container);
      const operation = await bulk.enqueueRecalculateForSeasonScores({
        seasonId,
        scoreModelId: null,
        characterIds,
        createdByUserId,
        logicalKeyPrefix: `season-context:${seasonId}:v${published.version}:${randomUUID().slice(0, 8)}`,
      });
      await this.audit(ctx, {
        action: "admin.score_context.recalculate",
        resourceType: "bulk_operation",
        resourceId: operation?.id ?? published.id,
        metadata: {
          seasonId,
          pinnedSeasonId: seasonId,
          contextRevisionId: published.id,
          version: published.version,
          bulkOperationId: operation?.id ?? null,
          characterCount: characterIds.length,
          status: "QUEUED",
        },
      });
      return {
        status: "QUEUED" as const,
        pinnedSeasonId: seasonId,
        bulkOperationId: operation?.id ?? null,
        characterCount: characterIds.length,
        error: null,
        retryAvailable: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.audit(ctx, {
        action: "admin.score_context.recalculate",
        resourceType: "season_score_context_revision",
        resourceId: published.id,
        outcome: "FAILURE",
        metadata: {
          seasonId,
          pinnedSeasonId: seasonId,
          contextRevisionId: published.id,
          version: published.version,
          status: "ENQUEUE_FAILED",
          error: message.slice(0, 300),
        },
      });
      return {
        status: "ENQUEUE_FAILED" as const,
        pinnedSeasonId: seasonId,
        bulkOperationId: null,
        characterCount: characterIds.length,
        error: message,
        retryAvailable: true,
      };
    }
  }
}
