/**
 * Idempotent local repair plan for competing isCurrent seasons + missing bindings.
 * Requires explicit confirmation. Do not run against staging/production.
 */
import type { PrismaClient } from "@mplus/database";
import { readActiveMplusCatalogMetadata } from "./catalog-metadata.js";
import { synchronizeActiveMplusSeasonCatalog } from "./synchronize.js";
import {
  createDefaultMplusZoneCatalogRegistry,
  type MplusZoneCatalogRegistry,
} from "./zone-catalog-registry.js";

export interface ActiveSeasonRepairPlanRow {
  seasonId: string;
  seasonSlug: string;
  isCurrent: boolean;
  isPlaceholder: boolean;
  hasValidatedCatalog: boolean;
  wclZoneId: number | null;
  dungeonBindingCount: number;
  action:
    | "keep_active"
    | "deactivate"
    | "synchronize_and_activate"
    | "leave_historical";
}

export interface ActiveSeasonRepairPlan {
  regionCode: string;
  regionId: string;
  blizzardSeasonId: number;
  plannedRows: ActiveSeasonRepairPlanRow[];
  willSynchronize: boolean;
  willActivateSeasonSlug: string;
}

function isPlaceholder(slug: string): boolean {
  const s = slug.toLowerCase();
  return s === "placeholder-current" || s === "auto-current" || s.startsWith("placeholder");
}

export async function planActiveMplusSeasonRepair(input: {
  prisma: PrismaClient;
  regionId: string;
  regionCode: string;
  blizzardSeasonId: number;
}): Promise<ActiveSeasonRepairPlan> {
  const seasons = await input.prisma.season.findMany({
    where: { regionId: input.regionId },
    orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
  });
  const targetSlug = `blizzard-season-${input.blizzardSeasonId}`;
  const plannedRows: ActiveSeasonRepairPlanRow[] = [];

  for (const season of seasons) {
    const meta = readActiveMplusCatalogMetadata(season.metadata);
    const bindingCount = await input.prisma.seasonDungeon.count({
      where: { seasonId: season.id },
    });
    const placeholder = isPlaceholder(season.slug);
    let action: ActiveSeasonRepairPlanRow["action"] = "leave_historical";
    if (season.slug === targetSlug) {
      action = "synchronize_and_activate";
    } else if (season.isCurrent) {
      action = "deactivate";
    }
    plannedRows.push({
      seasonId: season.id,
      seasonSlug: season.slug,
      isCurrent: season.isCurrent,
      isPlaceholder: placeholder,
      hasValidatedCatalog: meta?.lastKnownGood === true,
      wclZoneId: meta?.wclZoneId ?? null,
      dungeonBindingCount: bindingCount,
      action,
    });
  }

  if (!plannedRows.some((r) => r.seasonSlug === targetSlug)) {
    plannedRows.push({
      seasonId: "(create)",
      seasonSlug: targetSlug,
      isCurrent: false,
      isPlaceholder: false,
      hasValidatedCatalog: false,
      wclZoneId: null,
      dungeonBindingCount: 0,
      action: "synchronize_and_activate",
    });
  }

  return {
    regionCode: input.regionCode.toUpperCase(),
    regionId: input.regionId,
    blizzardSeasonId: input.blizzardSeasonId,
    plannedRows,
    willSynchronize: true,
    willActivateSeasonSlug: targetSlug,
  };
}

export async function applyActiveMplusSeasonRepair(input: {
  prisma: PrismaClient;
  regionId: string;
  regionCode: string;
  blizzardSeasonId: number;
  confirmLocalRepair: boolean;
  appEnv: string;
  registry?: MplusZoneCatalogRegistry;
  wclZoneId?: number | null;
}): Promise<{
  plan: ActiveSeasonRepairPlan;
  sync: Awaited<ReturnType<typeof synchronizeActiveMplusSeasonCatalog>> | null;
}> {
  if (!input.confirmLocalRepair) {
    throw Object.assign(
      new Error("repair_refused: pass --confirm-local-repair"),
      { code: "ACTIVE_SEASON_REPAIR_NOT_CONFIRMED" },
    );
  }
  if (input.appEnv === "staging" || input.appEnv === "production") {
    throw Object.assign(
      new Error("repair_refused: APP_ENV is staging/production"),
      { code: "ACTIVE_SEASON_REPAIR_FORBIDDEN_ENV" },
    );
  }

  const plan = await planActiveMplusSeasonRepair({
    prisma: input.prisma,
    regionId: input.regionId,
    regionCode: input.regionCode,
    blizzardSeasonId: input.blizzardSeasonId,
  });

  const sync = await synchronizeActiveMplusSeasonCatalog({
    prisma: input.prisma,
    regionId: input.regionId,
    regionCode: input.regionCode,
    blizzardSeasonId: input.blizzardSeasonId,
    wclZoneId: input.wclZoneId,
    registry: input.registry ?? createDefaultMplusZoneCatalogRegistry(),
    activate: true,
  });

  return { plan, sync };
}
