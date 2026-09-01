import { randomUUID } from "node:crypto";
import { getRetailClassMatrix } from "@mplus/abilities";
import {
  formatPercentileBpsLabel,
  KEY_CONTEXT_PERCENTILE_BPS,
  KEY_CONTEXT_REGION_CODES,
  type KeyContextRegionCode,
  type SeasonScoreContextRevisionDoc,
} from "@mplus/contracts";
import {
  SeasonScoreContextRepository,
  type PrismaClient,
} from "@mplus/database";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { writeAuditEvent, type AuditInput } from "../iam/audit.js";
import { BulkCharacterProcessingService } from "./bulk-character-processing-service.js";

export type ScoreContextAuditCtx = Pick<
  AuditInput,
  "userId" | "actorType" | "ip" | "userAgent"
>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

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
  if (code === "CROSS_REGION_SNAPSHOT_BINDING") {
    throw HttpError.badRequest(code, "Snapshot region does not match the policy region binding");
  }
  if (code === "CROSS_BLIZZARD_SEASON_SNAPSHOT_BINDING") {
    throw HttpError.badRequest(code, "Snapshot Blizzard season does not match the policy season");
  }
  if (code === "INVALID_REGION_CODE" || code === "DUPLICATE_REGION_SNAPSHOT_BINDING") {
    throw HttpError.badRequest(code, "Invalid regional snapshot binding");
  }
  if (
    code === "INVALID_TIER_FACTORS" ||
    code === "INVALID_PERCENTILE_ANCHORS" ||
    code === "INVALID_SPEC_ASSIGNMENTS" ||
    code === "INVALID_MEDIAN_KEY_DISTRIBUTION" ||
    code === "KEY_FIELD_SATURATION"
  ) {
    throw HttpError.badRequest(code, "Invalid score context configuration", issues);
  }
  throw error;
}

function assertAnchorsCompatibleWithDistribution(_revision: SeasonScoreContextRevisionDoc): void {
  // Factors are percentile-identity; regional thresholds are not policy identity.
}

export function toAdminRevisionView(revision: SeasonScoreContextRevisionDoc) {
  return {
    id: revision.id,
    blizzardSeasonId: revision.blizzardSeasonId,
    seasonId: revision.seasonId,
    version: revision.version,
    status: revision.status,
    publishedAt: revision.publishedAt,
    tierFactors: revision.tierFactors,
    specAssignments: revision.specAssignments,
    percentileAnchors: revision.percentileAnchors,
    regionSnapshots: revision.regionSnapshots,
    distribution: null,
    resolvedAnchors: revision.percentileAnchors.map((a) => ({
      percentileBps: a.percentileBps,
      percentileLabel: formatPercentileBpsLabel(a.percentileBps),
      medianKeyThreshold: null as number | null,
      factor: a.factor,
    })),
    distributionMissing: false,
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
    const blizzardSeasonId = season.blizzardSeasonId;
    const repo = this.repo();
    const [published, draft, history] =
      blizzardSeasonId != null
        ? await Promise.all([
            repo.findPublishedForBlizzardSeason(blizzardSeasonId),
            repo.findDraftForBlizzardSeason(blizzardSeasonId),
            repo.listRevisionsForBlizzardSeason(blizzardSeasonId),
          ])
        : await Promise.all([
            repo.findPublishedForSeason(seasonId),
            repo.findDraftForSeason(seasonId),
            repo.listRevisionsForSeason(seasonId),
          ]);
    const regionalSeasons =
      blizzardSeasonId != null
        ? await this.prisma.season.findMany({
            where: { blizzardSeasonId },
            select: {
              id: true,
              region: { select: { code: true } },
            },
          })
        : [{ id: season.id, region: season.region }];
    type DistView = {
      id: string;
      source: string;
      sourceVersion: string | null;
      collectedAt: string;
      points: Array<{ percentileBps: number; medianKeyThreshold: number }>;
      provenance: Record<string, unknown>;
    };
    const toDistViewFromMapped = (
      mapped: Awaited<ReturnType<SeasonScoreContextRepository["findLatestValidRegionalDistribution"]>>,
    ): DistView | null => {
      if (!mapped) return null;
      return {
        id: mapped.id,
        source: mapped.source,
        sourceVersion: mapped.sourceVersion,
        collectedAt: mapped.collectedAt,
        points: mapped.points,
        provenance: mapped.provenance,
      };
    };
    const policyDoc = draft ?? published;
    const boundByRegion: Record<string, DistView | null> = {
      EU: null,
      US: null,
      KR: null,
      TW: null,
    };
    if (policyDoc) {
      for (const binding of policyDoc.regionSnapshots) {
        const code = binding.regionCode.toUpperCase();
        const dist = await repo.findFrozenRegionalSnapshot({
          revisionId: policyDoc.id,
          regionCode: code,
        });
        boundByRegion[code] = dist
          ? {
              id: dist.id,
              source: dist.source,
              sourceVersion: dist.sourceVersion,
              collectedAt: dist.collectedAt,
              points: dist.points,
              provenance: asRecord(dist.provenance),
            }
          : null;
      }
    }
    const regions: Record<
      string,
      {
        seasonId: string | null;
        catalogReady: boolean;
        latestDistribution: DistView | null;
        hasNewerDistribution: boolean;
        boundSnapshotId: string | null;
        refreshStatus: Awaited<ReturnType<AdminScoreContextService["getKeyDistributionStatus"]>>;
        provenance: Record<string, unknown> | null;
      }
    > = {};
    for (const code of KEY_CONTEXT_REGION_CODES) {
      const row = regionalSeasons.find((s) => s.region?.code?.toUpperCase() === code);
      if (!row) {
        regions[code] = {
          seasonId: null,
          catalogReady: false,
          latestDistribution: null,
          hasNewerDistribution: false,
          boundSnapshotId: boundByRegion[code]?.id ?? null,
          refreshStatus: { status: "Idle", refreshId: null, errorMessage: null, snapshotId: null },
          provenance: null,
        };
        continue;
      }
      const [latestValid, dungeonCount, refreshStatus] = await Promise.all([
        repo.findLatestValidRegionalDistribution(row.id),
        this.prisma.seasonDungeon.count({ where: { seasonId: row.id } }),
        this.getKeyDistributionStatus(row.id),
      ]);
      const latestDistribution = toDistViewFromMapped(latestValid);
      const boundId = boundByRegion[code]?.id ?? null;
      regions[code] = {
        seasonId: row.id,
        catalogReady: dungeonCount === 8,
        latestDistribution,
        hasNewerDistribution: Boolean(latestDistribution && latestDistribution.id !== boundId),
        boundSnapshotId: boundId,
        refreshStatus,
        provenance: latestDistribution?.provenance ?? null,
      };
    }
    const keyRows = KEY_CONTEXT_PERCENTILE_BPS.map((percentileBps) => {
      const factor =
        policyDoc?.percentileAnchors.find((a) => a.percentileBps === percentileBps)?.factor ?? 1;
      const threshold = (code: KeyContextRegionCode) =>
        regions[code]?.latestDistribution?.points.find((p) => p.percentileBps === percentileBps)
          ?.medianKeyThreshold ?? null;
      return {
        percentileBps,
        percentileLabel: formatPercentileBpsLabel(percentileBps),
        factor,
        thresholds: {
          EU: threshold("EU"),
          US: threshold("US"),
          KR: threshold("KR"),
          TW: threshold("TW"),
        },
      };
    });
    const publishedView = published ? toAdminRevisionView(published) : null;
    const draftView = draft ? toAdminRevisionView(draft) : null;
    const missingRegionCoverage = KEY_CONTEXT_REGION_CODES.filter((code) => !boundByRegion[code]);
    return {
      blizzardSeasonId,
      season: {
        id: season.id,
        slug: season.slug,
        name: season.name,
        blizzardSeasonId: season.blizzardSeasonId,
        isCurrent: season.isCurrent,
        regionCode: season.region?.code ?? null,
      },
      policy: {
        displayedRevision: draftView ?? publishedView,
        regionalSnapshots: {
          EU: boundByRegion.EU,
          US: boundByRegion.US,
          KR: boundByRegion.KR,
          TW: boundByRegion.TW,
        },
        missingRegionCoverage,
        published: publishedView,
        draft: draftView,
        history: history.map((row) => ({
          id: row.id,
          version: row.version,
          status: row.status,
          publishedAt: row.publishedAt,
        })),
      },
      regions,
      keyRows,
      published: publishedView,
      draft: draftView,
      history: history.map((row) => ({
        id: row.id,
        version: row.version,
        status: row.status,
        publishedAt: row.publishedAt,
        distributionSource: null,
        distributionVersion: null,
      })),
      distributions: [],
      latestDistribution:
        regions[season.region?.code?.toUpperCase() ?? "EU"]?.latestDistribution ??
        KEY_CONTEXT_REGION_CODES.map((code) => regions[code]?.latestDistribution).find(Boolean) ??
        null,
      distributionMissing: KEY_CONTEXT_REGION_CODES.every(
        (code) => !regions[code]?.latestDistribution,
      ),
      keyDistributionRefresh: regions.EU?.refreshStatus,
      canonicalSpecializations: this.canonicalSpecializations(),
    };
  }

  async createOrGetDraft(seasonId: string, ctx: ScoreContextAuditCtx, createdByUserId: string | null) {
    const state = await this.getSeasonState(seasonId);
    const repo = this.repo();
    const blizzardSeasonId = state.blizzardSeasonId;
    if (blizzardSeasonId == null) {
      throw HttpError.badRequest("SEASON_NOT_BLIZZARD_BACKED", "Season is not a Blizzard scoring season");
    }
    const existing = await repo.findDraftForBlizzardSeason(blizzardSeasonId);
    if (existing) return toAdminRevisionView(existing);
    const published = await repo.findPublishedForBlizzardSeason(blizzardSeasonId);
    const isFirstPolicy = published == null;
    const defaultNeutralAnchors = KEY_CONTEXT_PERCENTILE_BPS.map((percentileBps) => ({
      percentileBps,
      factor: 1,
    }));
    try {
      const created = await repo.createDraft({
        blizzardSeasonId,
        seasonId,
        createdByUserId,
        bindLatestValidRegionalSnapshots: isFirstPolicy,
        tierFactors: isFirstPolicy ? undefined : published.tierFactors,
        specAssignments: isFirstPolicy ? [] : (published.specAssignments ?? []),
        percentileAnchors:
          !isFirstPolicy && published.percentileAnchors.length > 0
            ? published.percentileAnchors
            : defaultNeutralAnchors,
      });
      const doc = await repo.findById(created.id);
      if (!doc) {
        throw HttpError.internal("Draft was created but could not be reloaded");
      }
      await this.audit(ctx, {
        action: "admin.score_context.draft.create",
        resourceType: "season_score_context_revision",
        resourceId: created.id,
        metadata: {
          seasonId,
          version: created.version,
          firstPolicy: isFirstPolicy,
          boundSnapshotCount: doc.regionSnapshots.length,
        },
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
      contentHash?: string;
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
        contentHash: input.contentHash,
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

    const recalc = await this.enqueueRecalc(published.blizzardSeasonId, ctx, createdByUserId, published);
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
    const recalc = await this.enqueueRecalc(published.blizzardSeasonId, ctx, createdByUserId, published);
    return { revision: toAdminRevisionView(published), recalc };
  }

  private async enqueueRecalc(
    blizzardSeasonId: number,
    ctx: ScoreContextAuditCtx,
    createdByUserId: string | null,
    published: SeasonScoreContextRevisionDoc,
  ) {
    const regionalSeasons = await this.repo().listRegionalSeasonsForBlizzardSeason(blizzardSeasonId);
    const bulk = new BulkCharacterProcessingService(this.container);
    let characterCount = 0;
    let lastOperationId: string | null = null;
    try {
    for (const regional of regionalSeasons) {
      const characterIds = await this.repo().listCharacterIdsWithScoresForSeason(regional.id);
      characterCount += characterIds.length;
      if (characterIds.length === 0) continue;
      const operation = await bulk.enqueueRecalculateForSeasonScores({
        seasonId: regional.id,
        scoreModelId: null,
        characterIds,
        createdByUserId,
        logicalKeyPrefix: `season-context:${blizzardSeasonId}:${regional.region?.code ?? regional.id}:v${published.version}:${randomUUID().slice(0, 8)}`,
      });
      lastOperationId = operation?.id ?? lastOperationId;
    }
    if (characterCount === 0) {
      await this.audit(ctx, {
        action: "admin.score_context.recalculate",
        resourceType: "season_score_context_revision",
        resourceId: published.id,
        metadata: { blizzardSeasonId, version: published.version, characterCount: 0, status: "NO_SCORES" },
      });
      return {
        status: "NO_SCORES" as const,
        pinnedSeasonId: published.seasonId,
        bulkOperationId: null,
        characterCount: 0,
        error: null,
        retryAvailable: false,
      };
    }
    await this.audit(ctx, {
      action: "admin.score_context.recalculate",
      resourceType: "bulk_operation",
      resourceId: lastOperationId ?? published.id,
      metadata: {
        blizzardSeasonId,
        contextRevisionId: published.id,
        version: published.version,
        bulkOperationId: lastOperationId,
        characterCount,
        status: "QUEUED",
      },
    });
    return {
      status: "QUEUED" as const,
      pinnedSeasonId: published.seasonId,
      bulkOperationId: lastOperationId,
      characterCount,
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
          blizzardSeasonId,
          version: published.version,
          status: "ENQUEUE_FAILED",
          error: message.slice(0, 300),
        },
      });
      return {
        status: "ENQUEUE_FAILED" as const,
        pinnedSeasonId: published.seasonId,
        bulkOperationId: null,
        characterCount,
        error: message,
        retryAvailable: true,
      };
    }
  }

  async getKeyDistributionStatus(seasonId: string) {
    const latest = await this.prisma.scoreContextKeyDistributionRefresh.findFirst({
      where: { seasonId },
      orderBy: { createdAt: "desc" },
    });
    const latestValid = await this.repo().findLatestValidRegionalDistribution(seasonId);
    const hasSnapshot = latestValid != null;
    if (!latest) {
      return {
        status: hasSnapshot ? ("Available" as const) : ("Idle" as const),
        refreshId: null,
        errorMessage: null,
        snapshotId: latestValid?.id ?? null,
      };
    }
    const status =
      latest.status === "QUEUED"
        ? ("Queued" as const)
        : latest.status === "RUNNING"
          ? ("Refreshing" as const)
          : latest.status === "FAILED"
            ? ("Failed" as const)
            : latest.status === "SKIPPED"
              ? ("Unavailable" as const)
              : hasSnapshot
              ? ("Available" as const)
              : ("Idle" as const);
    return {
      status,
      refreshId: latest.id,
      errorMessage: latest.errorMessage,
      snapshotId: latest.snapshotId ?? latestValid?.id ?? null,
    };
  }

  async enqueueKeyDistributionRefresh(seasonId: string, ctx: ScoreContextAuditCtx, userId: string | null) {
    const state = await this.getSeasonState(seasonId);
    const queued = await this.container.producers.enqueueScoringSeasonDataSync({
      trigger: "admin",
      blizzardSeasonId: state.blizzardSeasonId ?? undefined,
    });
    await this.audit(ctx, {
      action: "admin.score_context.key_distribution.refresh.requested",
      resourceType: "season_score_context_revision",
      resourceId: seasonId,
      metadata: {
        blizzardSeasonId: state.blizzardSeasonId,
        jobId: queued.jobId,
        requestedByUserId: userId,
      },
    });
    return { refreshId: queued.jobId, status: "Queued" as const, regions: [] };
  }

  async useLatestDistribution(revisionId: string, ctx: ScoreContextAuditCtx) {
    const repo = this.repo();
    try {
      const result = await repo.adoptLatestRegionalDistributions(revisionId);
      await this.audit(ctx, {
        action: "admin.score_context.distribution.adopted",
        resourceType: "season_score_context_revision",
        resourceId: revisionId,
        metadata: {
          blizzardSeasonId: result.revision.blizzardSeasonId,
          adopted: result.adopted,
          unchanged: result.unchanged,
        },
      });
      return toAdminRevisionView(result.revision);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      mapRepoError(error);
    }
  }
}
