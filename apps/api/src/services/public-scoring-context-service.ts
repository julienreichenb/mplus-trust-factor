import { getRetailClassMatrix } from "@mplus/abilities";
import {
  formatPercentileBpsLabel,
  KEY_CONTEXT_PERCENTILE_BPS,
  KEY_CONTEXT_REGION_CODES,
  type KeyContextRegionCode,
  type PublicScoringContextDTO,
  type PublicScoringContextKeyRowDTO,
  type PublicScoringContextRegionSnapshotDTO,
} from "@mplus/contracts";
import { SeasonScoreContextRepository, type PrismaClient } from "@mplus/database";
import { peekEffectiveScoringSeasonRowGlobal } from "@mplus/worker";

export class PublicScoringContextService {
  constructor(private readonly prisma: PrismaClient) {}

  async getPublished(): Promise<PublicScoringContextDTO> {
    const season = await peekEffectiveScoringSeasonRowGlobal(this.prisma);
    if (!season) {
      return unavailable("Scoring season is not resolved.");
    }
    const scoringSeason = {
      id: season.id,
      slug: season.slug,
      name: season.name,
      blizzardSeasonId: season.blizzardSeasonId,
    };
    const repo = new SeasonScoreContextRepository(this.prisma);
    const published =
      season.blizzardSeasonId != null
        ? await repo.findPublishedForBlizzardSeason(season.blizzardSeasonId)
        : await repo.findPublishedForSeason(season.id);
    if (!published || published.status !== "PUBLISHED") {
      return {
        ...unavailable("Current Meta context is temporarily unavailable."),
        scoringSeason,
      };
    }

    const regionalSnapshots: Record<
      KeyContextRegionCode,
      PublicScoringContextRegionSnapshotDTO | null
    > = {
      EU: null,
      US: null,
      KR: null,
      TW: null,
    };
    const boundPoints: Record<
      KeyContextRegionCode,
      Array<{ percentileBps: number; medianKeyThreshold: number }> | null
    > = { EU: null, US: null, KR: null, TW: null };

    for (const code of KEY_CONTEXT_REGION_CODES) {
      let regionalSeasonId: string | null = null;
      if (season.blizzardSeasonId != null) {
        const regional = await this.prisma.season.findFirst({
          where: {
            blizzardSeasonId: season.blizzardSeasonId,
            region: { code: { equals: code, mode: "insensitive" } },
          },
          select: { id: true },
        });
        regionalSeasonId = regional?.id ?? null;
      } else if (code === "EU") {
        // Non-Blizzard-backed seasons: treat the effective season row as EU-only.
        regionalSeasonId = season.id;
      }
      if (!regionalSeasonId) continue;
      const dist = await repo.findLatestValidRegionalDistribution(regionalSeasonId);
      if (!dist) continue;
      regionalSnapshots[code] = {
        collectedAt: dist.collectedAt,
        source: dist.source,
        sourceVersion: dist.sourceVersion,
      };
      boundPoints[code] = dist.points;
    }

    const rows: PublicScoringContextKeyRowDTO[] = KEY_CONTEXT_PERCENTILE_BPS.map((percentileBps) => {
      const factor =
        published.percentileAnchors.find((anchor) => anchor.percentileBps === percentileBps)?.factor ?? 1;
      const threshold = (code: KeyContextRegionCode) =>
        boundPoints[code]?.find((point) => point.percentileBps === percentileBps)?.medianKeyThreshold ??
        null;
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

    const keyUnavailable = KEY_CONTEXT_REGION_CODES.every((code) => regionalSnapshots[code] == null);

    return {
      available: true,
      unavailableReason: null,
      scoringSeason,
      revision: {
        id: published.id,
        version: published.version,
        publishedAt: published.publishedAt,
      },
      meta: {
        classes: getRetailClassMatrix().map((cls) => ({
          slug: cls.slug,
          name: cls.name,
          specs: cls.specs.map((spec) => ({
            slug: spec.slug,
            name: spec.name,
            role: spec.role,
          })),
        })),
        assignments: published.specAssignments,
        tierFactors: published.tierFactors,
      },
      key: {
        rows,
        unavailable: keyUnavailable,
        regionalSnapshots,
      },
    };
  }
}

function unavailable(reason: string): PublicScoringContextDTO {
  return {
    available: false,
    unavailableReason: reason,
    scoringSeason: null,
    revision: null,
    meta: null,
    key: null,
  };
}
