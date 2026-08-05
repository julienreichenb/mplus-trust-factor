/**
 * Idempotent local-only repair: bind Midnight Season 1 dungeons to the current
 * Blizzard season row. Does not call WCL. Does not touch staging/production
 * unless the operator points DATABASE_URL there (do not).
 *
 * Usage (local):
 *   pnpm scoring-v2:canary:repair-catalog -- --region EU
 */
import type { PrismaClient } from "@mplus/database";
import { ensureDungeon } from "../../../persistence/run-repository.js";
import {
  MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID,
  MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
  MIDNIGHT_SEASON_1_PRODUCT_SLUG,
} from "./canary-catalog.js";

export interface RepairMidnightSeason1CatalogResult {
  regionCode: string;
  seasonId: string;
  seasonSlug: string;
  boundDungeonSlugs: string[];
  createdBindings: number;
  alreadyPresent: number;
  mutated: boolean;
}

export async function repairMidnightSeason1CatalogBindings(input: {
  prisma: PrismaClient;
  regionCode: string;
}): Promise<RepairMidnightSeason1CatalogResult> {
  const region = await input.prisma.region.findFirst({
    where: { code: input.regionCode.toUpperCase() },
  });
  if (!region) {
    throw Object.assign(
      new Error(`REGION_NOT_FOUND:${input.regionCode}`),
      { code: "REGION_NOT_FOUND" },
    );
  }

  let season =
    (await input.prisma.season.findFirst({
      where: {
        regionId: region.id,
        OR: [
          { blizzardSeasonId: MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID },
          { slug: `blizzard-season-${MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID}` },
          { slug: MIDNIGHT_SEASON_1_PRODUCT_SLUG },
        ],
      },
    })) ??
    (await input.prisma.season.findFirst({
      where: { regionId: region.id, isCurrent: true },
    }));

  if (!season) {
    season = await input.prisma.season.create({
      data: {
        regionId: region.id,
        slug: `blizzard-season-${MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID}`,
        name: "Midnight Season 1",
        blizzardSeasonId: MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID,
        isCurrent: true,
        dungeonCount: MIDNIGHT_SEASON_1_DUNGEON_SLUGS.length,
        metadata: {
          productSeasonSlug: MIDNIGHT_SEASON_1_PRODUCT_SLUG,
          dungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
          repairSource: "scoring-v2-canary-repair-catalog",
        },
      },
    });
  }

  let createdBindings = 0;
  let alreadyPresent = 0;
  const bound: string[] = [];

  for (let i = 0; i < MIDNIGHT_SEASON_1_DUNGEON_SLUGS.length; i++) {
    const slug = MIDNIGHT_SEASON_1_DUNGEON_SLUGS[i]!;
    const dungeon = await ensureDungeon(input.prisma, slug);
    const existing = await input.prisma.seasonDungeon.findUnique({
      where: {
        seasonId_dungeonId: { seasonId: season.id, dungeonId: dungeon.id },
      },
    });
    if (existing) {
      alreadyPresent += 1;
    } else {
      await input.prisma.seasonDungeon.create({
        data: {
          seasonId: season.id,
          dungeonId: dungeon.id,
          sortOrder: i,
        },
      });
      createdBindings += 1;
    }
    bound.push(slug);
  }

  const meta =
    season.metadata && typeof season.metadata === "object"
      ? (season.metadata as Record<string, unknown>)
      : {};
  await input.prisma.season.update({
    where: { id: season.id },
    data: {
      dungeonCount: MIDNIGHT_SEASON_1_DUNGEON_SLUGS.length,
      blizzardSeasonId:
        season.blizzardSeasonId ?? MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID,
      metadata: {
        ...meta,
        productSeasonSlug: MIDNIGHT_SEASON_1_PRODUCT_SLUG,
        dungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
        repairSource: "scoring-v2-canary-repair-catalog",
      },
    },
  });

  return {
    regionCode: region.code,
    seasonId: season.id,
    seasonSlug: season.slug,
    boundDungeonSlugs: bound,
    createdBindings,
    alreadyPresent,
    mutated: createdBindings > 0,
  };
}
