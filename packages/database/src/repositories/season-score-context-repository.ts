import type { Prisma, PrismaClient } from "@prisma/client";
import type { SeasonScoreContextRevisionDoc } from "@mplus/contracts";
import {
  defaultNeutralTierFactors,
  validateMedianKeyDistributionPoints,
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

function mapRevisionDoc(row: {
  id: string;
  seasonId: string;
  version: number;
  status: string;
  publishedAt: Date | null;
  tierFactors: unknown;
  specAssignments: unknown;
  percentileAnchors: unknown;
  distributionSnapshot: {
    id: string;
    seasonId: string;
    source: string;
    provenance: unknown;
    sourceVersion: string | null;
    collectedAt: Date;
    effectiveAt: Date | null;
    contentHash: string;
    points: unknown;
  } | null;
}): SeasonScoreContextRevisionDoc {
  const factors = validateTierFactors(row.tierFactors);
  const anchors = validatePercentileAnchors(row.percentileAnchors);
  const assignments = validateSpecAssignments(row.specAssignments);

  const dist = row.distributionSnapshot;
  const distPoints = dist ? validateMedianKeyDistributionPoints(dist.points) : null;

  return {
    id: row.id,
    seasonId: row.seasonId,
    version: row.version,
    status: row.status as SeasonScoreContextRevisionDoc["status"],
    publishedAt: row.publishedAt?.toISOString() ?? null,
    tierFactors: factors.ok ? factors.factors : defaultNeutralTierFactors(),
    specAssignments: assignments.ok ? assignments.assignments : [],
    percentileAnchors: anchors.ok ? anchors.anchors : [],
    distribution:
      dist && distPoints?.ok
        ? {
            id: dist.id,
            seasonId: dist.seasonId,
            source: dist.source,
            provenance: asRecord(dist.provenance),
            sourceVersion: dist.sourceVersion,
            collectedAt: dist.collectedAt.toISOString(),
            effectiveAt: dist.effectiveAt?.toISOString() ?? null,
            contentHash: dist.contentHash,
            points: distPoints.value.points,
          }
        : null,
  };
}

const revisionInclude = {
  distributionSnapshot: true,
} as const;

export class SeasonScoreContextRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPublishedForSeason(seasonId: string): Promise<SeasonScoreContextRevisionDoc | null> {
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

  async importDistribution(input: {
    seasonId: string;
    source: string;
    provenance?: Record<string, unknown>;
    sourceVersion?: string | null;
    collectedAt: Date;
    effectiveAt?: Date | null;
    points: unknown;
  }) {
    const validated = validateMedianKeyDistributionPoints(input.points);
    if (!validated.ok) {
      throw Object.assign(new Error("INVALID_MEDIAN_KEY_DISTRIBUTION"), {
        code: "INVALID_MEDIAN_KEY_DISTRIBUTION",
        issues: validated.issues,
      });
    }
    return this.prisma.seasonMedianKeyDistributionSnapshot.upsert({
      where: {
        seasonId_contentHash: {
          seasonId: input.seasonId,
          contentHash: validated.value.contentHash,
        },
      },
      create: {
        seasonId: input.seasonId,
        source: input.source,
        provenance: (input.provenance ?? {}) as Prisma.InputJsonValue,
        sourceVersion: input.sourceVersion ?? null,
        collectedAt: input.collectedAt,
        effectiveAt: input.effectiveAt ?? null,
        contentHash: validated.value.contentHash,
        points: validated.value.points as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  async createDraft(input: {
    seasonId: string;
    createdByUserId?: string | null;
    distributionSnapshotId?: string | null;
    tierFactors?: unknown;
    specAssignments?: unknown;
    percentileAnchors?: unknown;
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

    if (input.distributionSnapshotId) {
      const snapshot = await this.prisma.seasonMedianKeyDistributionSnapshot.findUnique({
        where: { id: input.distributionSnapshotId },
        select: { id: true, seasonId: true },
      });
      if (!snapshot) {
        throw Object.assign(new Error("DISTRIBUTION_SNAPSHOT_NOT_FOUND"), {
          code: "DISTRIBUTION_SNAPSHOT_NOT_FOUND",
        });
      }
      if (snapshot.seasonId !== input.seasonId) {
        throw Object.assign(new Error("DISTRIBUTION_SNAPSHOT_SEASON_MISMATCH"), {
          code: "DISTRIBUTION_SNAPSHOT_SEASON_MISMATCH",
        });
      }
    }

    const latest = await this.prisma.seasonScoreContextRevision.findFirst({
      where: { seasonId: input.seasonId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    return this.prisma.seasonScoreContextRevision.create({
      data: {
        seasonId: input.seasonId,
        version,
        status: "DRAFT",
        distributionSnapshotId: input.distributionSnapshotId ?? null,
        tierFactors: factors.factors as unknown as Prisma.InputJsonValue,
        specAssignments: assignments.assignments as unknown as Prisma.InputJsonValue,
        percentileAnchors: anchors.anchors as unknown as Prisma.InputJsonValue,
        createdByUserId: input.createdByUserId ?? null,
      },
      include: revisionInclude,
    });
  }

  /**
   * Publish a DRAFT: archive any current PUBLISHED for the season, freeze this revision.
   * Does not rescore characters.
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

      await tx.seasonScoreContextRevision.updateMany({
        where: { seasonId: target.seasonId, status: "PUBLISHED" },
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

  async findDraftForSeason(seasonId: string): Promise<SeasonScoreContextRevisionDoc | null> {
    const row = await this.prisma.seasonScoreContextRevision.findFirst({
      where: { seasonId, status: "DRAFT" },
      orderBy: { version: "desc" },
      include: revisionInclude,
    });
    return row ? mapRevisionDoc(row) : null;
  }

  async listRevisionsForSeason(seasonId: string): Promise<SeasonScoreContextRevisionDoc[]> {
    const rows = await this.prisma.seasonScoreContextRevision.findMany({
      where: { seasonId },
      orderBy: { version: "desc" },
      include: revisionInclude,
    });
    return rows.map(mapRevisionDoc);
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
      distributionSnapshotId?: string | null;
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
    if (patch.distributionSnapshotId !== undefined) {
      if (patch.distributionSnapshotId) {
        const snapshot = await this.prisma.seasonMedianKeyDistributionSnapshot.findUnique({
          where: { id: patch.distributionSnapshotId },
          select: { id: true, seasonId: true },
        });
        if (!snapshot) {
          throw Object.assign(new Error("DISTRIBUTION_SNAPSHOT_NOT_FOUND"), {
            code: "DISTRIBUTION_SNAPSHOT_NOT_FOUND",
          });
        }
        if (snapshot.seasonId !== target.seasonId) {
          throw Object.assign(new Error("DISTRIBUTION_SNAPSHOT_SEASON_MISMATCH"), {
            code: "DISTRIBUTION_SNAPSHOT_SEASON_MISMATCH",
          });
        }
        data.distributionSnapshot = { connect: { id: snapshot.id } };
      } else {
        data.distributionSnapshot = { disconnect: true };
      }
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
}

export function createSeasonScoreContextRepository(
  prisma: PrismaClient,
): SeasonScoreContextRepository {
  return new SeasonScoreContextRepository(prisma);
}
