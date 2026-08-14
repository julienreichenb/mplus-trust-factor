/**
 * Canary season resolution via effective scoring season (RuntimeSetting).
 * Uses persisted Season catalog only — no env WCL zone mode.
 */
import type { PrismaClient } from "@mplus/database";
import { peekEffectiveScoringSeasonRow } from "../../active-mplus-season/effective-season-peek.js";
import {
  buildAuthorityFromSeason,
  loadSeasonDungeonIdentities,
} from "../../active-mplus-season/resolve.js";
import {
  SeasonDungeonBindingsMissingError,
  type ActiveMythicPlusSeasonAuthority,
} from "../../active-mplus-season/types.js";

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
  wcl?: unknown;
}): Promise<CanarySeasonResolution> {
  void input.env;
  void input.wcl;

  try {
    const peek = await peekEffectiveScoringSeasonRow(input.prisma, {
      regionId: input.regionId,
    });
    if (!peek) {
      throw new SeasonDungeonBindingsMissingError(
        `SEASON_DUNGEON_BINDINGS_MISSING: no effective scoring season for ${input.regionCode}`,
      );
    }

    const season = await input.prisma.season.findUnique({ where: { id: peek.id } });
    if (!season) {
      throw new SeasonDungeonBindingsMissingError(
        `SEASON_NOT_FOUND: effective scoring season row ${peek.id} missing`,
      );
    }

    const dungeons = await loadSeasonDungeonIdentities(input.prisma, season.id);
    if (dungeons.length === 0) {
      throw new SeasonDungeonBindingsMissingError(
        `SEASON_DUNGEON_BINDINGS_MISSING: ${season.slug} has empty SeasonDungeon bindings`,
      );
    }

    const authority = buildAuthorityFromSeason({
      season,
      dungeons,
      regionCode: input.regionCode,
      regionId: input.regionId,
      resolutionMode: peek.selectionMode,
      diagnosticExpectedZoneId: null,
      autoDetectedZoneId: null,
      now: new Date(),
      metadataTtlSeconds: 86_400,
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
      configuredZoneId: null,
      resolutionMode: "AUTO",
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
