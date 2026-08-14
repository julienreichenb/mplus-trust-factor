/**
 * Lightweight effective scoring season peek for DB-only read paths.
 *
 * Prefer {@link resolveEffectiveScoringSeason} when Blizzard sync / catalog
 * bootstrap is required (refresh, WCL acquisition). Use this helper when the
 * caller only needs the application Season row id/slug for score reads,
 * calibration defaults, evidence join defaults, etc.
 *
 * Never invents seasons. Never reads process.env Mythic+ zone variables.
 */
import type { PrismaClient, Season } from "@mplus/database";
import { getScoringSeasonSelection } from "./selection-setting.js";
import { seasonAuthoritySlug, isNonProductSeasonSlug } from "../season-authority.js";
import { readActiveMplusCatalogMetadata } from "./catalog-metadata.js";

export interface EffectiveScoringSeasonRow {
  id: string;
  slug: string;
  name: string;
  regionId: string | null;
  blizzardSeasonId: number | null;
  isCurrent: boolean;
  selectionMode: "AUTO" | "PINNED";
  /** Persisted catalog WCL zone; null when catalog metadata is absent. */
  wclZoneId: number | null;
}

function toPeekRow(
  season: Season,
  selectionMode: "AUTO" | "PINNED",
): EffectiveScoringSeasonRow {
  return {
    id: season.id,
    slug: season.slug,
    name: season.name,
    regionId: season.regionId,
    blizzardSeasonId: season.blizzardSeasonId,
    isCurrent: season.isCurrent,
    selectionMode,
    wclZoneId: readActiveMplusCatalogMetadata(season.metadata)?.wclZoneId ?? null,
  };
}

export async function requireEffectiveScoringSeasonRow(
  prisma: Pick<PrismaClient, "runtimeSetting" | "season">,
  input: { regionId: string },
): Promise<EffectiveScoringSeasonRow> {
  const row = await peekEffectiveScoringSeasonRow(prisma, input);
  if (!row) {
    throw Object.assign(new Error("Effective scoring season is not resolved"), {
      code: "EFFECTIVE_SCORING_SEASON_MISSING",
    });
  }
  return row;
}

/**
 * Resolve the platform effective scoring Season row for a region.
 * Missing RuntimeSetting ⇒ AUTO (Blizzard isCurrent).
 */
export async function peekEffectiveScoringSeasonRow(
  prisma: Pick<PrismaClient, "runtimeSetting" | "season">,
  input: { regionId: string },
): Promise<EffectiveScoringSeasonRow | null> {
  const { selection } = await getScoringSeasonSelection(prisma);

  if (selection.mode === "PINNED") {
    const slug = seasonAuthoritySlug(selection.blizzardSeasonId);
    const pinned =
      (await prisma.season.findFirst({
        where: { regionId: input.regionId, slug },
      })) ??
      (await prisma.season.findFirst({
        where: {
          regionId: input.regionId,
          blizzardSeasonId: selection.blizzardSeasonId,
        },
        orderBy: { updatedAt: "desc" },
      }));
    if (!pinned || isNonProductSeasonSlug(pinned.slug)) return null;
    return toPeekRow(pinned, "PINNED");
  }

  const current = await prisma.season.findFirst({
    where: { regionId: input.regionId, isCurrent: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!current || isNonProductSeasonSlug(current.slug)) return null;
  return toPeekRow(current, "AUTO");
}

/**
 * When region is unknown (global admin default), prefer PINNED Blizzard ID
 * across any region, else any isCurrent Blizzard season.
 */
export async function peekEffectiveScoringSeasonRowGlobal(
  prisma: Pick<PrismaClient, "runtimeSetting" | "season">,
): Promise<EffectiveScoringSeasonRow | null> {
  const { selection } = await getScoringSeasonSelection(prisma);

  if (selection.mode === "PINNED") {
    const slug = seasonAuthoritySlug(selection.blizzardSeasonId);
    const pinned =
      (await prisma.season.findFirst({
        where: { slug },
        orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
      })) ??
      (await prisma.season.findFirst({
        where: { blizzardSeasonId: selection.blizzardSeasonId },
        orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
      }));
    if (!pinned || isNonProductSeasonSlug(pinned.slug)) return null;
    return toPeekRow(pinned, "PINNED");
  }

  const current = await prisma.season.findFirst({
    where: { isCurrent: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!current || isNonProductSeasonSlug(current.slug)) return null;
  return toPeekRow(current, "AUTO");
}

/**
 * Map regionId → effective scoring season id for multi-region score projections.
 */
export async function mapEffectiveScoringSeasonIdsByRegion(
  prisma: Pick<PrismaClient, "runtimeSetting" | "season">,
  regionIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(regionIds.filter(Boolean))];
  const out = new Map<string, string>();
  for (const regionId of unique) {
    const row = await peekEffectiveScoringSeasonRow(prisma, { regionId });
    if (row) out.set(regionId, row.id);
  }
  return out;
}
