/**
 * Bounded, non-critical Blizzard journal-instance artwork enrichment for
 * season-bound Dungeon rows. Never affects catalog readiness or scoring.
 */
import type { BlizzardProvider, ProviderFetchContext } from "@mplus/contracts";
import type { Prisma, PrismaClient } from "@mplus/database";
import type { Logger } from "@mplus/observability";
import { canonicalDungeonSlug, sanitizeHttpsUrl } from "@mplus/provider-blizzard";

export const DUNGEON_ART_MEDIA_SOURCE = "journal-instance-media" as const;

export interface DungeonBlizzardArtMetadata {
  journalInstanceId?: number;
  tileUrl?: string | null;
  mediaFetchedAt?: string;
  mediaSource?: typeof DUNGEON_ART_MEDIA_SOURCE;
}

export function readDungeonBlizzardArtMetadata(metadata: unknown): DungeonBlizzardArtMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const root = metadata as Record<string, unknown>;
  const blizzard = root.blizzard;
  if (!blizzard || typeof blizzard !== "object" || Array.isArray(blizzard)) return null;
  const blob = blizzard as Record<string, unknown>;
  return {
    journalInstanceId:
      typeof blob.journalInstanceId === "number" && Number.isFinite(blob.journalInstanceId)
        ? blob.journalInstanceId
        : undefined,
    tileUrl: typeof blob.tileUrl === "string" || blob.tileUrl === null ? (blob.tileUrl as string | null) : undefined,
    mediaFetchedAt: typeof blob.mediaFetchedAt === "string" ? blob.mediaFetchedAt : undefined,
    mediaSource: blob.mediaSource === DUNGEON_ART_MEDIA_SOURCE ? DUNGEON_ART_MEDIA_SOURCE : undefined,
  };
}

/** Official HTTPS tile URL from persisted dungeon metadata, or null. */
export function readDungeonTileUrl(metadata: unknown): string | null {
  const art = readDungeonBlizzardArtMetadata(metadata);
  return sanitizeHttpsUrl(art?.tileUrl ?? null);
}

export function dungeonNeedsArtworkEnrichment(metadata: unknown): boolean {
  const art = readDungeonBlizzardArtMetadata(metadata);
  if (!art) return true;
  // Already attempted (success or explicit null tile) — do not retry forever.
  if (art.mediaFetchedAt) return false;
  return true;
}

export function mergeDungeonBlizzardArtMetadata(
  existing: unknown,
  art: DungeonBlizzardArtMetadata,
): Prisma.InputJsonObject {
  const root =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const previousBlizzard =
    root.blizzard && typeof root.blizzard === "object" && !Array.isArray(root.blizzard)
      ? { ...(root.blizzard as Record<string, unknown>) }
      : {};
  return {
    ...root,
    blizzard: {
      ...previousBlizzard,
      ...art,
    },
  } as Prisma.InputJsonObject;
}

export async function enrichSeasonDungeonArtwork(input: {
  prisma: PrismaClient;
  blizzard: BlizzardProvider;
  logger: Logger;
  seasonId: string;
  regionCode: string;
  now?: Date;
}): Promise<{ examined: number; enriched: number; skipped: number; failed: number }> {
  const now = input.now ?? new Date();
  const bindings = await input.prisma.seasonDungeon.findMany({
    where: { seasonId: input.seasonId },
    include: { dungeon: true },
  });
  const needing = bindings.filter((row) => dungeonNeedsArtworkEnrichment(row.dungeon.metadata));
  if (needing.length === 0) {
    return { examined: bindings.length, enriched: 0, skipped: bindings.length, failed: 0 };
  }

  const ctx: ProviderFetchContext = {
    region: input.regionCode,
    requestId: `dungeon-art:${input.seasonId}`,
    correlationId: null,
    forceRefresh: false,
    now: now.toISOString(),
  };

  let journalBySlug = new Map<string, { journalInstanceId: number; name: string }>();
  let mplusBySlug = new Map<string, { blizzardDungeonId: number; name: string; mapId: number | null }>();
  try {
    const [journalIndex, mplusIndex] = await Promise.all([
      input.blizzard.getJournalInstanceIndex(ctx),
      input.blizzard.getMythicKeystoneDungeonIndex(ctx),
    ]);
    journalBySlug = new Map(
      journalIndex.data.map((row) => [row.slug, { journalInstanceId: row.journalInstanceId, name: row.name }]),
    );
    mplusBySlug = new Map(
      mplusIndex.data.map((row) => [
        row.slug,
        { blizzardDungeonId: row.blizzardDungeonId, name: row.name, mapId: row.mapId },
      ]),
    );
  } catch (error) {
    input.logger.warn(
      {
        event: "dungeon_artwork_index_failed",
        seasonId: input.seasonId,
        region: input.regionCode,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
      },
      "blizzard journal/m+ indexes unavailable; skipping artwork enrichment",
    );
    return { examined: bindings.length, enriched: 0, skipped: bindings.length - needing.length, failed: needing.length };
  }

  let enriched = 0;
  let failed = 0;
  for (const row of needing) {
    const slug = row.dungeon.slug.trim().toLowerCase();
    try {
      const mplus = mplusBySlug.get(slug) ?? null;
      const journal =
        journalBySlug.get(slug) ??
        (mplus ? journalBySlug.get(canonicalDungeonSlug(mplus.name) ?? "") ?? null : null);
      if (!journal) {
        await input.prisma.dungeon.update({
          where: { id: row.dungeon.id },
          data: {
            metadata: mergeDungeonBlizzardArtMetadata(row.dungeon.metadata, {
              tileUrl: null,
              mediaFetchedAt: now.toISOString(),
              mediaSource: DUNGEON_ART_MEDIA_SOURCE,
            }),
            ...(mplus && row.dungeon.blizzardDungeonId == null
              ? { blizzardDungeonId: BigInt(mplus.blizzardDungeonId) }
              : {}),
            ...(mplus?.mapId != null && row.dungeon.mapId == null ? { mapId: mplus.mapId } : {}),
          },
        });
        enriched += 1;
        continue;
      }

      let tileUrl: string | null = null;
      try {
        const media = await input.blizzard.getJournalInstanceMedia(journal.journalInstanceId, ctx);
        tileUrl = sanitizeHttpsUrl(media.data.tileUrl);
      } catch (error) {
        input.logger.warn(
          {
            event: "dungeon_artwork_media_failed",
            seasonId: input.seasonId,
            dungeonSlug: slug,
            journalInstanceId: journal.journalInstanceId,
            error: error instanceof Error ? error.message.slice(0, 200) : String(error),
          },
          "journal-instance media fetch failed; persisting null tile",
        );
      }

      const update: Prisma.DungeonUpdateInput = {
        metadata: mergeDungeonBlizzardArtMetadata(row.dungeon.metadata, {
          journalInstanceId: journal.journalInstanceId,
          tileUrl,
          mediaFetchedAt: now.toISOString(),
          mediaSource: DUNGEON_ART_MEDIA_SOURCE,
        }),
      };
      if (mplus && row.dungeon.blizzardDungeonId == null) {
        update.blizzardDungeonId = BigInt(mplus.blizzardDungeonId);
      }
      if (mplus?.mapId != null && row.dungeon.mapId == null) {
        update.mapId = mplus.mapId;
      }
      // Prefer official Blizzard journal name when present and row still has slug-capitalized placeholder.
      if (journal.name && (!row.dungeon.name || row.dungeon.name === capitalizeSlug(slug))) {
        update.name = journal.name;
      }

      await input.prisma.dungeon.update({
        where: { id: row.dungeon.id },
        data: update,
      });
      enriched += 1;
    } catch (error) {
      failed += 1;
      input.logger.warn(
        {
          event: "dungeon_artwork_enrich_failed",
          seasonId: input.seasonId,
          dungeonSlug: slug,
          error: error instanceof Error ? error.message.slice(0, 300) : String(error),
        },
        "dungeon artwork enrichment failed for one dungeon",
      );
    }
  }

  input.logger.info(
    {
      event: "dungeon_artwork_enrichment_completed",
      seasonId: input.seasonId,
      region: input.regionCode,
      examined: bindings.length,
      enriched,
      skipped: bindings.length - needing.length,
      failed,
    },
    "season dungeon artwork enrichment completed",
  );

  return {
    examined: bindings.length,
    enriched,
    skipped: bindings.length - needing.length,
    failed,
  };
}

function capitalizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
