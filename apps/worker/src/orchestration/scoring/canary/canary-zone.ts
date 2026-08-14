/**
 * Resolve the Mythic+ WCL zone for Scoring V2 canary commands.
 *
 * Default: effective scoring season → persisted catalog wclZoneId.
 * Optional: explicit --zone-id for raw WCL diagnostics only (never from .env).
 */
import type { PrismaClient } from "@mplus/database";
import { peekEffectiveScoringSeasonRow } from "../../active-mplus-season/effective-season-peek.js";
import { readActiveMplusCatalogMetadata } from "../../active-mplus-season/catalog-metadata.js";

export type CanaryZoneSource = "effective-season" | "cli-override";

export interface ResolveCanaryZoneIdInput {
  /** Parsed --zone-id when supplied; null/undefined when omitted. */
  cliZoneId?: number | null;
  prisma?: PrismaClient;
  regionCode?: string;
  regionId?: string;
  wcl?: unknown;
  log?: (message: string) => void;
}

export interface ResolvedCanaryZone {
  zoneId: number;
  /** Alias kept for call-site compatibility; equals resolved zoneId. */
  envZoneId: number;
  source: CanaryZoneSource;
  overrideActive: boolean;
  applicationSeasonId?: string;
  activeSeasonId?: string;
  blizzardSeasonId?: number;
}

function assertPositiveZoneId(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw Object.assign(
      new Error(`${label}: expected positive integer, got ${value}`),
      { code: "CANARY_ZONE_ID_INVALID" },
    );
  }
  return value;
}

export function parseOptionalCliZoneId(raw: string): number {
  const trimmed = raw.trim();
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(
      new Error(`Invalid --zone-id: expected positive integer, got "${raw}"`),
      { code: "CANARY_ZONE_ID_INVALID" },
    );
  }
  return n;
}

/**
 * Resolve zone from effective scoring season catalog (async).
 */
export async function resolveCanaryZoneIdFromEffectiveSeason(
  input: ResolveCanaryZoneIdInput,
): Promise<ResolvedCanaryZone> {
  const log = input.log ?? (() => undefined);

  if (input.cliZoneId != null) {
    const cliZoneId = assertPositiveZoneId(input.cliZoneId, "--zone-id");
    log(
      `Canary --zone-id=${cliZoneId} explicit diagnostic override (not from env; not scoring authority).`,
    );
    return {
      zoneId: cliZoneId,
      envZoneId: cliZoneId,
      source: "cli-override",
      overrideActive: true,
    };
  }

  if (!input.prisma || !input.regionId) {
    throw Object.assign(
      new Error(
        "Canary zone resolution requires prisma + regionId " +
          "(or an explicit --zone-id diagnostic override).",
      ),
      { code: "CANARY_ZONE_CONTEXT_MISSING" },
    );
  }

  const peek = await peekEffectiveScoringSeasonRow(input.prisma, {
    regionId: input.regionId,
  });
  if (!peek) {
    throw Object.assign(
      new Error(
        `No effective scoring season for region ${input.regionCode ?? input.regionId}`,
      ),
      { code: "CANARY_ZONE_SEASON_MISSING" },
    );
  }

  const season = await input.prisma.season.findUnique({ where: { id: peek.id } });
  if (!season) {
    throw Object.assign(
      new Error(`Effective scoring season row ${peek.id} not found`),
      { code: "CANARY_ZONE_SEASON_MISSING" },
    );
  }

  const meta = readActiveMplusCatalogMetadata(season.metadata);
  if (!meta?.wclZoneId) {
    throw Object.assign(
      new Error(
        `Effective scoring season ${season.slug} lacks persisted wclZoneId catalog metadata`,
      ),
      { code: "CANARY_ZONE_CATALOG_INCOMPLETE" },
    );
  }

  const zoneId = assertPositiveZoneId(meta.wclZoneId, "catalog.wclZoneId");
  log(
    `Canary zone from effective scoring season ${season.slug} ` +
      `(blizzard=${peek.blizzardSeasonId}, wclZoneId=${zoneId}).`,
  );

  return {
    zoneId,
    envZoneId: zoneId,
    source: "effective-season",
    overrideActive: false,
    applicationSeasonId: season.id,
    activeSeasonId: season.slug,
    blizzardSeasonId: peek.blizzardSeasonId ?? undefined,
  };
}

/**
 * Sync path: only explicit --zone-id (no env authority).
 */
export function resolveCanaryZoneId(
  input: ResolveCanaryZoneIdInput = {},
): ResolvedCanaryZone {
  if (input.cliZoneId != null) {
    const cliZoneId = assertPositiveZoneId(input.cliZoneId, "--zone-id");
    return {
      zoneId: cliZoneId,
      envZoneId: cliZoneId,
      source: "cli-override",
      overrideActive: true,
    };
  }
  throw Object.assign(
    new Error(
      "Canary zone requires async effective-season resolution or an explicit --zone-id. " +
        "Env Mythic+ zone variables are not authoritative.",
    ),
    { code: "CANARY_ZONE_REQUIRES_EFFECTIVE_SEASON" },
  );
}

/** Season identity aligned with live WCL zone rankings / discovery. */
export function canarySeasonIdForZone(zoneId: number): string {
  return `wcl-zone-${assertPositiveZoneId(zoneId, "zoneId")}`;
}
