/**
 * Canary season resolution via ActiveMythicPlusSeasonAuthority.
 * No hard-coded blizzard season prefer; no static dungeon-array fallback.
 */
import type { PrismaClient } from "@mplus/database";
import {
  parseOptionalPositiveIntEnv,
  resolveActiveMythicPlusSeason,
  resolveWclMplusZoneMode,
  SeasonDungeonBindingsMissingError,
  type ActiveMythicPlusSeasonAuthority,
} from "../../active-mplus-season/index.js";

export type SeasonValidationStatus =
  | "OK"
  | "SEASON_NOT_FOUND"
  | "SEASON_DUNGEON_BINDINGS_MISSING"
  | "SEASON_CATALOG_MISMATCH"
  | "ZONE_UNSUPPORTED";

export interface CanarySeasonDungeonRow {
  slug: string;
  dungeonId: string;
  journalInstanceId: number | null;
  wclZoneOrEncounterId: string | null;
  sortOrder: number;
}

export interface CanarySeasonResolution {
  configuredZoneId: number | null;
  resolutionMode: "AUTO" | "PINNED";
  seasonId: string | null;
  seasonSlug: string | null;
  seasonName: string | null;
  blizzardSeasonId: number | null;
  expansion: string | null;
  productSeasonSlug: string | null;
  catalogSource: string;
  catalogVersion: string;
  dungeonCount: number;
  dungeons: CanarySeasonDungeonRow[];
  activeDungeonSlugs: string[];
  dungeonPoolHash: string | null;
  expectedSlotCount: number;
  validationStatus: SeasonValidationStatus;
  validationReasons: string[];
  isCurrent: boolean | null;
  startsAt: string | null;
  endsAt: string | null;
  authority: ActiveMythicPlusSeasonAuthority | null;
  warnings: string[];
}

export class SeasonCatalogMismatchError extends Error {
  readonly code: "SEASON_CATALOG_MISMATCH" | "SEASON_DUNGEON_BINDINGS_MISSING";
  readonly seasonResolution: CanarySeasonResolution;

  constructor(resolution: CanarySeasonResolution) {
    const code: "SEASON_CATALOG_MISMATCH" | "SEASON_DUNGEON_BINDINGS_MISSING" =
      resolution.validationStatus === "SEASON_DUNGEON_BINDINGS_MISSING"
        ? "SEASON_DUNGEON_BINDINGS_MISSING"
        : "SEASON_CATALOG_MISMATCH";
    super(
      `${code}: ${resolution.validationReasons.join("; ") || "catalog mismatch"}`,
    );
    this.name = "SeasonCatalogMismatchError";
    this.code = code;
    this.seasonResolution = resolution;
  }
}

export async function resolveCanarySeasonCatalog(input: {
  prisma: PrismaClient;
  regionId: string;
  regionCode: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CanarySeasonResolution> {
  const env = input.env ?? process.env;
  const mode = resolveWclMplusZoneMode(env);
  const zoneFromEnv = (() => {
    try {
      return parseOptionalPositiveIntEnv(env.WCL_MPLUS_ZONE_ID);
    } catch {
      return null;
    }
  })();

  try {
    const authority = await resolveActiveMythicPlusSeason({
      prisma: input.prisma,
      regionCode: input.regionCode,
      regionId: input.regionId,
      resolutionMode: mode === "pinned" ? "PINNED" : "AUTO",
      pinnedWclZoneId: mode === "pinned" ? zoneFromEnv : null,
      diagnosticExpectedZoneId: mode === "auto" ? zoneFromEnv : null,
    });

    return {
      configuredZoneId: authority.wclZoneId,
      resolutionMode: authority.resolutionMode,
      seasonId: authority.applicationSeasonId,
      seasonSlug: authority.seasonSlug,
      seasonName: authority.seasonDisplayName,
      blizzardSeasonId: authority.blizzardSeasonId,
      expansion: authority.expansionIdentity,
      productSeasonSlug: null,
      catalogSource: authority.catalogSource,
      catalogVersion: authority.catalogVersion,
      dungeonCount: authority.expectedDungeonCount,
      dungeons: authority.dungeons.map((d) => ({
        slug: d.slug,
        dungeonId: d.dungeonId,
        journalInstanceId: null,
        wclZoneOrEncounterId:
          d.wclEncounterId != null ? String(d.wclEncounterId) : null,
        sortOrder: d.sortOrder,
      })),
      activeDungeonSlugs: authority.activeDungeonSlugs,
      dungeonPoolHash: authority.dungeonPoolHash,
      expectedSlotCount: authority.expectedSlotCount,
      validationStatus: "OK",
      validationReasons: [],
      isCurrent: authority.active,
      startsAt: authority.validFrom,
      endsAt: authority.validUntil,
      authority,
      warnings: authority.warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status: SeasonValidationStatus =
      err instanceof SeasonDungeonBindingsMissingError ||
      (err instanceof Error &&
        "code" in err &&
        (err as { code?: string }).code === "SEASON_DUNGEON_BINDINGS_MISSING")
        ? "SEASON_DUNGEON_BINDINGS_MISSING"
        : "SEASON_CATALOG_MISMATCH";
    return {
      configuredZoneId: zoneFromEnv,
      resolutionMode: mode === "pinned" ? "PINNED" : "AUTO",
      seasonId: null,
      seasonSlug: null,
      seasonName: null,
      blizzardSeasonId: null,
      expansion: null,
      productSeasonSlug: null,
      catalogSource: "none",
      catalogVersion: "none",
      dungeonCount: 0,
      dungeons: [],
      activeDungeonSlugs: [],
      dungeonPoolHash: null,
      expectedSlotCount: 0,
      validationStatus: status,
      validationReasons: [message],
      isCurrent: null,
      startsAt: null,
      endsAt: null,
      authority: null,
      warnings: [],
    };
  }
}

export function assertSeasonCatalogOk(
  resolution: CanarySeasonResolution,
): asserts resolution is CanarySeasonResolution & {
  validationStatus: "OK";
  seasonId: string;
  seasonSlug: string;
} {
  if (
    resolution.validationStatus !== "OK" ||
    !resolution.seasonId ||
    !resolution.seasonSlug ||
    resolution.activeDungeonSlugs.length === 0 ||
    resolution.catalogSource === "none"
  ) {
    throw new SeasonCatalogMismatchError(resolution);
  }
  if (resolution.catalogSource !== "season_dungeon_bindings") {
    throw new SeasonCatalogMismatchError({
      ...resolution,
      validationStatus: "SEASON_CATALOG_MISMATCH",
      validationReasons: [
        ...resolution.validationReasons,
        `operator_refuses_non_binding_catalog_source:${resolution.catalogSource}`,
      ],
    });
  }
}
