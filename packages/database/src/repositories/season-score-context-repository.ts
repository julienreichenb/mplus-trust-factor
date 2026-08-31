import type { Prisma, PrismaClient } from "@prisma/client";
import {
  KEY_CONTEXT_REGION_CODES,
  RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
  type SeasonScoreContextRevisionDoc,
} from "@mplus/contracts";
import {
  defaultNeutralTierFactors,
  validateMedianKeyDistributionPoints,
  validatePackedDungeonKeyDistribution,
  validatePercentileAnchors,
  validateSpecAssignments,
  validateTierFactors,
} from "@mplus/scoring";

export const NONE_CONTEXT_REVISION_KEY = "none";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type SnapshotRow = {
  id: string;
  seasonId: string;
  source: string;
  provenance: unknown;
  sourceVersion: string | null;
  collectedAt: Date;
  effectiveAt: Date | null;
  contentHash: string;
  points: unknown;
};

function mapDistribution(dist: SnapshotRow | null) {
  if (!dist) return null;
  const distPoints = validateMedianKeyDistributionPoints(dist.points);
  if (!distPoints?.ok) return null;
  return {
    id: dist.id,
    seasonId: dist.seasonId,
    source: dist.source,
    provenance: asRecord(dist.provenance),
    sourceVersion: dist.sourceVersion,
    collectedAt: dist.collectedAt.toISOString(),
    effectiveAt: dist.effectiveAt?.toISOString() ?? null,
    contentHash: dist.contentHash,
    points: distPoints.value.points,
  };
}

function mapRevisionDoc(row: {
  id: string;
  blizzardSeasonId?: number | null;
  seasonId: string | null;
  version: number;
  status: string;
  publishedAt: Date | null;
  tierFactors: unknown;
  specAssignments: unknown;
  percentileAnchors: unknown;
  regionSnapshots?: Array<{ regionCode: string; distributionSnapshotId: string }>;
  distributionSnapshot?: SnapshotRow | null;
}): SeasonScoreContextRevisionDoc {
  const factors = validateTierFactors(row.tierFactors);
  const anchors = validatePercentileAnchors(row.percentileAnchors);
  const assignments = validateSpecAssignments(row.specAssignments);

  return {
    id: row.id,
    blizzardSeasonId: row.blizzardSeasonId ?? 0,
    seasonId: row.seasonId,
    version: row.version,
    status: row.status as SeasonScoreContextRevisionDoc["status"],
    publishedAt: row.publishedAt?.toISOString() ?? null,
    tierFactors: factors.ok ? factors.factors : defaultNeutralTierFactors(),
    specAssignments: assignments.ok ? assignments.assignments : [],
    percentileAnchors: anchors.ok ? anchors.anchors : [],
    regionSnapshots: (row.regionSnapshots ?? []).map((b) => ({
      regionCode: b.regionCode,
      distributionSnapshotId: b.distributionSnapshotId,
    })),
    distribution: mapDistribution(row.distributionSnapshot ?? null),
  };
}

const revisionInclude = {
  regionSnapshots: true,
} as const;

export class SeasonScoreContextRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPublishedForBlizzardSeason(
    blizzardSeasonId: number,
  ): Promise<SeasonScoreContextRevisionDoc | null> {
    const delegate = this.prisma.seasonScoreContextRevision;
    if (!delegate || typeof delegate.findFirst !== "function") return null;
    const row = await delegate.findFirst({
      where: { blizzardSeasonId, status: "PUBLISHED" },
      orderBy: { version: "desc" },
      include: revisionInclude,
    });
    return row ? mapRevisionDoc(row) : null;
  }

  async findPublishedForSeason(seasonId: string): Promise<SeasonScoreContextRevisionDoc | null> {
    const blizzardSeasonId = await this.resolveBlizzardSeasonId(seasonId);
    if (blizzardSeasonId != null) {
      return this.findPublishedForBlizzardSeason(blizzardSeasonId);
    }
    return this.findPublishedByOriginSeasonId(seasonId);
  }

  private async resolveBlizzardSeasonId(seasonId: string): Promise<number | null> {
    if (typeof this.prisma.season?.findUnique !== "function") return null;
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      select: { blizzardSeasonId: true },
    });
    return season?.blizzardSeasonId ?? null;
  }

  private async findPublishedByOriginSeasonId(
    seasonId: string,
  ): Promise<SeasonScoreContextRevisionDoc | null> {
    const delegate = this.prisma.seasonScoreContextRevision;
    if (!delegate || typeof delegate.findFirst !== "function") return null;
    const row = await delegate.findFirst({
      where: { seasonId, status: "PUBLISHED" },
      orderBy: { version: "desc" },
      include: revisionInclude,
    });
    return row ? mapRevisionDoc(row) : null;
  }

  async findById(id: string): Promise<SeasonScoreContextRevisionDoc | null> {
    const row = await this.prisma.seasonScoreContextRevision.findUnique({
      where: { id },
      include: revisionInclude,
    });
    return row ? mapRevisionDoc(row) : null;
  }

  async findFrozenRegionalSnapshot(input: {
    revisionId: string;
    regionCode: string;
  }): Promise<ReturnType<typeof mapDistribution>> {
    const binding = await this.prisma.scoreContextRevisionRegionSnapshot.findUnique({
      where: {
        revisionId_regionCode: {
          revisionId: input.revisionId,
          regionCode: input.regionCode.toUpperCase(),
        },
      },
      include: { distributionSnapshot: true },
    });
    return mapDistribution(binding?.distributionSnapshot ?? null);
  }

  /**
   * Latest valid median-key distribution for a regional season.
   * Skips rows that fail structural / packed-field validation (last-known-good).
   */
  async findLatestValidRegionalDistribution(
    seasonId: string,
  ): Promise<ReturnType<typeof mapDistribution>> {
    const rows = await this.prisma.seasonMedianKeyDistributionSnapshot.findMany({
      where: { seasonId },
      orderBy: { collectedAt: "desc" },
    });
    for (const row of rows) {
      const mapped = mapDistribution(row);
      if (!mapped) continue;
      if (row.source === RAIDER_IO_ADDON_DISTRIBUTION_SOURCE) {
        const packed = validatePackedDungeonKeyDistribution(mapped.points);
        if (!packed.ok) continue;
      }
      return mapped;
    }
    return null;
  }

  async importDistribution(input: {
    seasonId: string;
    source: string;
    provenance?: Record<string, unknown>;
    sourceVersion?: string | null;
    collectedAt: Date;
    effectiveAt?: Date | null;
    points: unknown;
    contentHash?: string;
  }) {
    const validated = validateMedianKeyDistributionPoints(input.points);
    if (!validated.ok) {
      throw Object.assign(new Error("INVALID_MEDIAN_KEY_DISTRIBUTION"), {
        code: "INVALID_MEDIAN_KEY_DISTRIBUTION",
        issues: validated.issues,
      });
    }
    if (input.source === RAIDER_IO_ADDON_DISTRIBUTION_SOURCE) {
      const packed = validatePackedDungeonKeyDistribution(validated.value.points);
      if (!packed.ok) {
        throw Object.assign(new Error("INVALID_MEDIAN_KEY_DISTRIBUTION"), {
          code: "KEY_FIELD_SATURATION",
          issues: packed.issues,
        });
      }
    }
    return this.prisma.seasonMedianKeyDistributionSnapshot.upsert({
      where: {
        seasonId_contentHash: {
          seasonId: input.seasonId,
          contentHash: input.contentHash ?? validated.value.contentHash,
        },
      },
      create: {
        seasonId: input.seasonId,
        source: input.source,
        provenance: (input.provenance ?? {}) as Prisma.InputJsonValue,
        sourceVersion: input.sourceVersion ?? null,
        collectedAt: input.collectedAt,
        effectiveAt: input.effectiveAt ?? null,
        contentHash: input.contentHash ?? validated.value.contentHash,
        points: validated.value.points as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  async createDraft(input: {
    blizzardSeasonId: number;
    seasonId?: string | null;
    createdByUserId?: string | null;
    tierFactors?: unknown;
    specAssignments?: unknown;
    percentileAnchors?: unknown;
    /** First-ever policy for this Blizzard season: bind latest valid regional snapshots. */
    bindLatestValidRegionalSnapshots?: boolean;
  }) {
    const factors = validateTierFactors(input.tierFactors ?? defaultNeutralTierFactors());
    if (!factors.ok) {
      throw Object.assign(new Error("INVALID_TIER_FACTORS"), {
        code: "INVALID_TIER_FACTORS",
        issues: factors.issues,
      });
    }
    const anchors = validatePercentileAnchors(input.percentileAnchors ?? []);
    if (!anchors.ok) {
      throw Object.assign(new Error("INVALID_PERCENTILE_ANCHORS"), {
        code: "INVALID_PERCENTILE_ANCHORS",
        issues: anchors.issues,
      });
    }

    const assignments = validateSpecAssignments(input.specAssignments ?? []);
    if (!assignments.ok) {
      throw Object.assign(new Error("INVALID_SPEC_ASSIGNMENTS"), {
        code: "INVALID_SPEC_ASSIGNMENTS",
        issues: assignments.issues,
      });
    }

    const latest = await this.prisma.seasonScoreContextRevision.findFirst({
      where: { blizzardSeasonId: input.blizzardSeasonId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    const created = await this.prisma.seasonScoreContextRevision.create({
      data: {
        blizzardSeasonId: input.blizzardSeasonId,
        seasonId: input.seasonId ?? null,
        version,
        status: "DRAFT",
        tierFactors: factors.factors as unknown as Prisma.InputJsonValue,
        specAssignments: assignments.assignments as unknown as Prisma.InputJsonValue,
        percentileAnchors: anchors.anchors as unknown as Prisma.InputJsonValue,
        createdByUserId: input.createdByUserId ?? null,
      },
      include: revisionInclude,
    });
    if (input.bindLatestValidRegionalSnapshots) {
      await this.adoptLatestRegionalDistributions(created.id);
      const reloaded = await this.prisma.seasonScoreContextRevision.findUnique({
        where: { id: created.id },
        include: revisionInclude,
      });
      return reloaded ?? created;
    }
    return created;
  }

  /**
   * Publish a DRAFT: archive any current PUBLISHED for the Blizzard season,
   * validate existing regional bindings, then freeze this revision.
   * Does not re-bind latest snapshots.
   */
  async publish(revisionId: string): Promise<SeasonScoreContextRevisionDoc> {
    const published = await this.prisma.$transaction(async (tx) => {
      const target = await tx.seasonScoreContextRevision.findUnique({
        where: { id: revisionId },
        include: revisionInclude,
      });
      if (!target) {
        throw Object.assign(new Error("CONTEXT_REVISION_NOT_FOUND"), {
          code: "CONTEXT_REVISION_NOT_FOUND",
        });
      }
      if (target.status !== "DRAFT") {
        throw Object.assign(new Error("CONTEXT_REVISION_NOT_DRAFT"), {
          code: "CONTEXT_REVISION_NOT_DRAFT",
        });
      }

      await this.validateRevisionBindings(tx, target.id, target.blizzardSeasonId);

      await tx.seasonScoreContextRevision.updateMany({
        where: { blizzardSeasonId: target.blizzardSeasonId, status: "PUBLISHED" },
        data: { status: "ARCHIVED" },
      });

      return tx.seasonScoreContextRevision.update({
        where: { id: revisionId },
        data: { status: "PUBLISHED", publishedAt: new Date() },
        include: revisionInclude,
      });
    });
    return mapRevisionDoc(published);
  }

  async adoptLatestRegionalDistributions(revisionId: string): Promise<{
    revision: SeasonScoreContextRevisionDoc;
    adopted: Array<{ regionCode: string; snapshotId: string }>;
    unchanged: Array<{ regionCode: string; snapshotId: string | null }>;
  }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const target = await tx.seasonScoreContextRevision.findUnique({
        where: { id: revisionId },
        include: revisionInclude,
      });
      if (!target) {
        throw Object.assign(new Error("CONTEXT_REVISION_NOT_FOUND"), {
          code: "CONTEXT_REVISION_NOT_FOUND",
        });
      }
      if (target.status !== "DRAFT") {
        throw Object.assign(new Error("CONTEXT_REVISION_NOT_DRAFT"), {
          code: "CONTEXT_REVISION_NOT_DRAFT",
        });
      }

      const adopted: Array<{ regionCode: string; snapshotId: string }> = [];
      const unchanged: Array<{ regionCode: string; snapshotId: string | null }> = [];
      const current = new Map(
        target.regionSnapshots.map((b) => [b.regionCode.toUpperCase(), b.distributionSnapshotId]),
      );

      for (const regionCode of KEY_CONTEXT_REGION_CODES) {
        const regional = await tx.season.findFirst({
          where: {
            blizzardSeasonId: target.blizzardSeasonId,
            region: { code: { equals: regionCode, mode: "insensitive" } },
          },
          select: { id: true },
        });
        if (!regional) {
          unchanged.push({ regionCode, snapshotId: current.get(regionCode) ?? null });
          continue;
        }
        const latest = await tx.seasonMedianKeyDistributionSnapshot.findFirst({
          where: { seasonId: regional.id },
          orderBy: { collectedAt: "desc" },
        });
        if (!latest) {
          unchanged.push({ regionCode, snapshotId: current.get(regionCode) ?? null });
          continue;
        }
        const points = validateMedianKeyDistributionPoints(latest.points);
        if (!points.ok) {
          unchanged.push({ regionCode, snapshotId: current.get(regionCode) ?? null });
          continue;
        }
        await this.assertValidRegionBinding(tx, {
          blizzardSeasonId: target.blizzardSeasonId,
          regionCode,
          snapshotId: latest.id,
        });
        if (current.get(regionCode) === latest.id) {
          unchanged.push({ regionCode, snapshotId: latest.id });
          continue;
        }
        await tx.scoreContextRevisionRegionSnapshot.upsert({
          where: { revisionId_regionCode: { revisionId: target.id, regionCode } },
          create: {
            revisionId: target.id,
            regionCode,
            distributionSnapshotId: latest.id,
          },
          update: { distributionSnapshotId: latest.id },
        });
        adopted.push({ regionCode, snapshotId: latest.id });
      }

      const updated = await tx.seasonScoreContextRevision.findUnique({
        where: { id: revisionId },
        include: revisionInclude,
      });
      if (!updated) {
        throw Object.assign(new Error("CONTEXT_REVISION_NOT_FOUND"), {
          code: "CONTEXT_REVISION_NOT_FOUND",
        });
      }
      return { updated, adopted, unchanged };
    });
    return {
      revision: mapRevisionDoc(result.updated),
      adopted: result.adopted,
      unchanged: result.unchanged,
    };
  }

  async bindRegionSnapshot(input: {
    revisionId: string;
    regionCode: string;
    snapshotId: string;
  }): Promise<SeasonScoreContextRevisionDoc> {
    const target = await this.prisma.seasonScoreContextRevision.findUnique({
      where: { id: input.revisionId },
    });
    if (!target) {
      throw Object.assign(new Error("CONTEXT_REVISION_NOT_FOUND"), {
        code: "CONTEXT_REVISION_NOT_FOUND",
      });
    }
    if (target.status !== "DRAFT") {
      throw Object.assign(new Error("CONTEXT_REVISION_NOT_DRAFT"), {
        code: "CONTEXT_REVISION_NOT_DRAFT",
      });
    }
    const regionCode = input.regionCode.toUpperCase();
    await this.assertValidRegionBinding(this.prisma, {
      blizzardSeasonId: target.blizzardSeasonId,
      regionCode,
      snapshotId: input.snapshotId,
    });
    await this.prisma.scoreContextRevisionRegionSnapshot.upsert({
      where: {
        revisionId_regionCode: { revisionId: input.revisionId, regionCode },
      },
      create: {
        revisionId: input.revisionId,
        regionCode,
        distributionSnapshotId: input.snapshotId,
      },
      update: { distributionSnapshotId: input.snapshotId },
    });
    const updated = await this.findById(input.revisionId);
    if (!updated) {
      throw Object.assign(new Error("CONTEXT_REVISION_NOT_FOUND"), {
        code: "CONTEXT_REVISION_NOT_FOUND",
      });
    }
    return updated;
  }

  private async validateRevisionBindings(
    db: PrismaClient | Prisma.TransactionClient,
    revisionId: string,
    blizzardSeasonId: number,
  ): Promise<void> {
    const bindings = await db.scoreContextRevisionRegionSnapshot.findMany({
      where: { revisionId },
    });
    const seen = new Set<string>();
    for (const binding of bindings) {
      const regionCode = binding.regionCode.toUpperCase();
      if (seen.has(regionCode)) {
        throw Object.assign(new Error("DUPLICATE_REGION_SNAPSHOT_BINDING"), {
          code: "DUPLICATE_REGION_SNAPSHOT_BINDING",
        });
      }
      seen.add(regionCode);
      await this.assertValidRegionBinding(db, {
        blizzardSeasonId,
        regionCode,
        snapshotId: binding.distributionSnapshotId,
      });
    }
  }

  private async assertValidRegionBinding(
    db: PrismaClient | Prisma.TransactionClient,
    input: { blizzardSeasonId: number; regionCode: string; snapshotId: string },
  ): Promise<void> {
    const regionCode = input.regionCode.toUpperCase();
    if (!KEY_CONTEXT_REGION_CODES.includes(regionCode as (typeof KEY_CONTEXT_REGION_CODES)[number])) {
      throw Object.assign(new Error("INVALID_REGION_CODE"), {
        code: "INVALID_REGION_CODE",
      });
    }
    const snapshot = await db.seasonMedianKeyDistributionSnapshot.findUnique({
      where: { id: input.snapshotId },
      include: { season: { include: { region: true } } },
    });
    if (!snapshot) {
      throw Object.assign(new Error("DISTRIBUTION_SNAPSHOT_NOT_FOUND"), {
        code: "DISTRIBUTION_SNAPSHOT_NOT_FOUND",
      });
    }
    const snapRegion = snapshot.season.region?.code?.toUpperCase();
    if (snapRegion !== regionCode) {
      throw Object.assign(new Error("CROSS_REGION_SNAPSHOT_BINDING"), {
        code: "CROSS_REGION_SNAPSHOT_BINDING",
      });
    }
    if (snapshot.season.blizzardSeasonId !== input.blizzardSeasonId) {
      throw Object.assign(new Error("CROSS_BLIZZARD_SEASON_SNAPSHOT_BINDING"), {
        code: "CROSS_BLIZZARD_SEASON_SNAPSHOT_BINDING",
      });
    }
    const points = validateMedianKeyDistributionPoints(snapshot.points);
    if (!points.ok) {
      throw Object.assign(new Error("INVALID_MEDIAN_KEY_DISTRIBUTION"), {
        code: "INVALID_MEDIAN_KEY_DISTRIBUTION",
        issues: points.issues,
      });
    }
  }

  async findDraftForBlizzardSeason(
    blizzardSeasonId: number,
  ): Promise<SeasonScoreContextRevisionDoc | null> {
    const row = await this.prisma.seasonScoreContextRevision.findFirst({
      where: { blizzardSeasonId, status: "DRAFT" },
      orderBy: { version: "desc" },
      include: revisionInclude,
    });
    return row ? mapRevisionDoc(row) : null;
  }

  async findDraftForSeason(seasonId: string): Promise<SeasonScoreContextRevisionDoc | null> {
    const blizzardSeasonId = await this.resolveBlizzardSeasonId(seasonId);
    if (blizzardSeasonId == null) {
      const delegate = this.prisma.seasonScoreContextRevision;
      if (!delegate || typeof delegate.findFirst !== "function") return null;
      const row = await delegate.findFirst({
        where: { seasonId, status: "DRAFT" },
        orderBy: { version: "desc" },
        include: revisionInclude,
      });
      return row ? mapRevisionDoc(row) : null;
    }
    return this.findDraftForBlizzardSeason(blizzardSeasonId);
  }

  async listRevisionsForBlizzardSeason(
    blizzardSeasonId: number,
  ): Promise<SeasonScoreContextRevisionDoc[]> {
    const rows = await this.prisma.seasonScoreContextRevision.findMany({
      where: { blizzardSeasonId },
      orderBy: { version: "desc" },
      include: revisionInclude,
    });
    return rows.map(mapRevisionDoc);
  }

  async listRevisionsForSeason(seasonId: string): Promise<SeasonScoreContextRevisionDoc[]> {
    const blizzardSeasonId = await this.resolveBlizzardSeasonId(seasonId);
    if (blizzardSeasonId == null) {
      const rows = await this.prisma.seasonScoreContextRevision.findMany({
        where: { seasonId },
        orderBy: { version: "desc" },
        include: revisionInclude,
      });
      return rows.map(mapRevisionDoc);
    }
    return this.listRevisionsForBlizzardSeason(blizzardSeasonId);
  }

  async listDistributionsForSeason(seasonId: string) {
    return this.prisma.seasonMedianKeyDistributionSnapshot.findMany({
      where: { seasonId },
      orderBy: { collectedAt: "desc" },
    });
  }

  async updateDraft(
    revisionId: string,
    patch: {
      tierFactors?: unknown;
      specAssignments?: unknown;
      percentileAnchors?: unknown;
    },
  ): Promise<SeasonScoreContextRevisionDoc> {
    const target = await this.prisma.seasonScoreContextRevision.findUnique({
      where: { id: revisionId },
      include: revisionInclude,
    });
    if (!target) {
      throw Object.assign(new Error("CONTEXT_REVISION_NOT_FOUND"), {
        code: "CONTEXT_REVISION_NOT_FOUND",
      });
    }
    if (target.status !== "DRAFT") {
      throw Object.assign(new Error("CONTEXT_REVISION_NOT_DRAFT"), {
        code: "CONTEXT_REVISION_NOT_DRAFT",
      });
    }

    const data: Prisma.SeasonScoreContextRevisionUpdateInput = {};
    if (patch.tierFactors !== undefined) {
      const factors = validateTierFactors(patch.tierFactors);
      if (!factors.ok) {
        throw Object.assign(new Error("INVALID_TIER_FACTORS"), {
          code: "INVALID_TIER_FACTORS",
          issues: factors.issues,
        });
      }
      data.tierFactors = factors.factors as unknown as Prisma.InputJsonValue;
    }
    if (patch.percentileAnchors !== undefined) {
      const anchors = validatePercentileAnchors(patch.percentileAnchors);
      if (!anchors.ok) {
        throw Object.assign(new Error("INVALID_PERCENTILE_ANCHORS"), {
          code: "INVALID_PERCENTILE_ANCHORS",
          issues: anchors.issues,
        });
      }
      data.percentileAnchors = anchors.anchors as unknown as Prisma.InputJsonValue;
    }
    if (patch.specAssignments !== undefined) {
      const assignments = validateSpecAssignments(patch.specAssignments);
      if (!assignments.ok) {
        throw Object.assign(new Error("INVALID_SPEC_ASSIGNMENTS"), {
          code: "INVALID_SPEC_ASSIGNMENTS",
          issues: assignments.issues,
        });
      }
      data.specAssignments = assignments.assignments as unknown as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.seasonScoreContextRevision.update({
      where: { id: revisionId },
      data,
      include: revisionInclude,
    });
    return mapRevisionDoc(updated);
  }

  async listCharacterIdsWithScoresForSeason(seasonId: string): Promise<string[]> {
    const rows = await this.prisma.characterScore.findMany({
      where: { seasonId },
      distinct: ["characterId"],
      select: { characterId: true },
    });
    return rows.map((r) => r.characterId);
  }

  async listRegionalSeasonsForBlizzardSeason(blizzardSeasonId: number) {
    return this.prisma.season.findMany({
      where: { blizzardSeasonId, regionId: { not: null } },
      select: {
        id: true,
        blizzardSeasonId: true,
        region: { select: { code: true } },
      },
    });
  }
}

export function createSeasonScoreContextRepository(
  prisma: PrismaClient,
): SeasonScoreContextRepository {
  return new SeasonScoreContextRepository(prisma);
}
