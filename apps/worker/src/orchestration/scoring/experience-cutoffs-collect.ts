/**
 * Collect closed real Mythic+ season cutoffs from Raider.IO into the versioned
 * offline Experience catalog (ops/dev command — not runtime refresh).
 */

import { writeFileSync } from "node:fs";
import type {
  ProviderFetchContext,
  RaiderIoProvider,
  RaiderIoSeasonCutoffs,
  RaiderIoStaticSeason,
  RegionCode,
} from "@mplus/contracts";
import {
  EXPERIENCE_SEASON_CUTOFF_QUANTILES,
  SUPPORTED_EXPERIENCE_CUTOFF_REGIONS,
  compareCatalogEntryKeys,
  emptyExperienceSeasonCutoffsCatalog,
  experienceSeasonCutoffsCatalogPath,
  isCanonicalRaiderIoMainSeasonSlug,
  loadExperienceSeasonCutoffsCatalog,
  serializeExperienceSeasonCutoffsCatalog,
  sortCatalogEntries,
  validateExperienceSeasonCutoffsCatalog,
  type ExperienceCutoffRegionCode,
  type ExperienceSeasonCutoffsCatalog,
  type ExperienceSeasonCutoffsCatalogEntry,
  type ExperienceSeasonCutoffQuantile,
} from "@mplus/database";
import { RAIDERIO_EXPANSION_CATALOG, RAIDERIO_SCHEMA_VERSION } from "@mplus/provider-raiderio";
import { isRealMythicPlusRaiderIoSeason } from "./experience-season-bootstrap.js";

export interface CollectExperienceCutoffsOptions {
  regions?: ExperienceCutoffRegionCode[];
  /** Exact Raider.IO season slug filter (optional). */
  seasonSlug?: string;
  dryRun?: boolean;
  now?: Date;
  catalogPath?: string;
  /** When true, do not read an existing catalog file (start empty). */
  fresh?: boolean;
}

export interface CollectExperienceCutoffsLine {
  region: string;
  seasonSlug: string;
  status:
    | "OK"
    | "SKIPPED_CURRENT"
    | "SKIPPED_FILTER"
    | "SKIPPED_NOT_MAIN"
    | "SKIPPED_NO_SCORES"
    | "FAILED";
  detail?: string;
}

export interface CollectExperienceCutoffsResult {
  catalog: ExperienceSeasonCutoffsCatalog;
  catalogPath: string;
  wrote: boolean;
  lines: CollectExperienceCutoffsLine[];
  collected: number;
  skippedCurrent: number;
  failed: number;
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (value == null || typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Closed = not current and endsAt strictly before now (fail closed when ends unknown). */
export function isClosedRaiderIoSeasonForCatalog(
  season: Pick<RaiderIoStaticSeason, "isCurrent" | "endsAt">,
  nowMs: number,
): boolean {
  if (season.isCurrent === true) return false;
  const endMs = parseIsoMs(season.endsAt);
  if (endMs == null) return false;
  return endMs < nowMs;
}

export function selectClosedMainSeasonsForCatalog(
  seasons: readonly RaiderIoStaticSeason[],
  nowMs: number,
): {
  selected: RaiderIoStaticSeason[];
  skippedCurrent: RaiderIoStaticSeason[];
  skippedNonMain: RaiderIoStaticSeason[];
} {
  const selected: RaiderIoStaticSeason[] = [];
  const skippedCurrent: RaiderIoStaticSeason[] = [];
  const skippedNonMain: RaiderIoStaticSeason[] = [];

  for (const season of seasons) {
    if (!isRealMythicPlusRaiderIoSeason(season) || !isCanonicalRaiderIoMainSeasonSlug(season.slug)) {
      skippedNonMain.push(season);
      continue;
    }
    if (!isClosedRaiderIoSeasonForCatalog(season, nowMs)) {
      skippedCurrent.push(season);
      continue;
    }
    selected.push(season);
  }

  return { selected, skippedCurrent, skippedNonMain };
}

function cutoffsFromDto(
  data: RaiderIoSeasonCutoffs,
): Partial<Record<ExperienceSeasonCutoffQuantile, number>> {
  const map: Partial<Record<ExperienceSeasonCutoffQuantile, number>> = {};
  const pairs: Array<[ExperienceSeasonCutoffQuantile, number | null | undefined]> = [
    ["p999", data.top0_1Percent?.score],
    ["p990", data.top1Percent?.score],
    ["p900", data.top10Percent?.score],
    ["p750", data.top25Percent?.score],
    ["p600", data.top40Percent?.score],
  ];
  for (const [q, score] of pairs) {
    if (typeof score === "number" && Number.isFinite(score) && score >= 0) {
      map[q] = score;
    }
  }
  return map;
}

function totalPopulationFromDto(data: RaiderIoSeasonCutoffs): number | null {
  for (const field of [
    data.top0_1Percent,
    data.top1Percent,
    data.top10Percent,
    data.top25Percent,
    data.top40Percent,
  ] as const) {
    const n = field?.totalPopulationCount;
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export function catalogEntryFromSeasonCutoffs(input: {
  region: ExperienceCutoffRegionCode;
  season: RaiderIoStaticSeason;
  cutoffs: RaiderIoSeasonCutoffs;
  collectedAt: string;
  schemaVersion?: string;
}): ExperienceSeasonCutoffsCatalogEntry {
  return {
    region: input.region,
    raiderIoSeasonSlug: input.season.slug,
    blizzardSeasonId:
      input.season.blizzardSeasonId != null && Number.isFinite(input.season.blizzardSeasonId)
        ? Math.trunc(input.season.blizzardSeasonId)
        : null,
    name: input.season.name ?? null,
    startsAt: input.season.startsAt,
    endsAt: input.season.endsAt,
    closed: true,
    cutoffs: cutoffsFromDto(input.cutoffs),
    totalPopulation: totalPopulationFromDto(input.cutoffs),
    sourceUpdatedAt: input.cutoffs.updatedAt,
    isRemappedSeason: input.cutoffs.isRemappedSeason,
    source: {
      provider: "raiderio",
      schemaVersion: input.schemaVersion ?? RAIDERIO_SCHEMA_VERSION,
      collectedAt: input.collectedAt,
    },
  };
}

function entriesContentFingerprint(entries: readonly ExperienceSeasonCutoffsCatalogEntry[]): string {
  // Ignore per-entry collectedAt / generated timestamps for equality.
  const stable = sortCatalogEntries(entries).map((e) => ({
    region: e.region,
    raiderIoSeasonSlug: e.raiderIoSeasonSlug,
    blizzardSeasonId: e.blizzardSeasonId,
    name: e.name,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    closed: e.closed,
    cutoffs: e.cutoffs,
    totalPopulation: e.totalPopulation,
    sourceUpdatedAt: e.sourceUpdatedAt,
    isRemappedSeason: e.isRemappedSeason,
    sourceSchemaVersion: e.source.schemaVersion,
  }));
  return JSON.stringify(stable);
}

export async function collectExperienceSeasonCutoffs(input: {
  raiderIo: Pick<RaiderIoProvider, "getStaticData" | "getSeasonCutoffs">;
  ctx: ProviderFetchContext;
  options?: CollectExperienceCutoffsOptions;
}): Promise<CollectExperienceCutoffsResult> {
  const now = input.options?.now ?? new Date();
  const nowMs = now.getTime();
  const collectedAt = now.toISOString();
  const catalogPath = input.options?.catalogPath ?? experienceSeasonCutoffsCatalogPath();
  const regions = (input.options?.regions?.length
    ? input.options.regions
    : [...SUPPORTED_EXPERIENCE_CUTOFF_REGIONS]) as ExperienceCutoffRegionCode[];
  const seasonFilter = input.options?.seasonSlug?.trim() || null;

  let previous: ExperienceSeasonCutoffsCatalog = emptyExperienceSeasonCutoffsCatalog(collectedAt);
  if (!input.options?.fresh) {
    try {
      previous = loadExperienceSeasonCutoffsCatalog(catalogPath);
    } catch {
      previous = emptyExperienceSeasonCutoffsCatalog(collectedAt);
    }
  }

  const lines: CollectExperienceCutoffsLine[] = [];
  const entriesByKey = new Map<string, ExperienceSeasonCutoffsCatalogEntry>();
  let skippedCurrent = 0;
  let failed = 0;

  const seasonsBySlug = new Map<string, RaiderIoStaticSeason>();
  const skippedCurrentSlugs = new Set<string>();
  for (const expansion of RAIDERIO_EXPANSION_CATALOG) {
    const staticResult = await input.raiderIo.getStaticData(input.ctx, {
      expansionId: expansion.id,
    });
    const { selected, skippedCurrent: cur } = selectClosedMainSeasonsForCatalog(
      staticResult.data.seasons,
      nowMs,
    );
    for (const s of cur) {
      if (seasonFilter && s.slug !== seasonFilter) continue;
      skippedCurrentSlugs.add(s.slug);
      for (const region of regions) {
        lines.push({
          region,
          seasonSlug: s.slug,
          status: "SKIPPED_CURRENT",
        });
      }
    }
    for (const season of selected) {
      if (seasonFilter && season.slug !== seasonFilter) continue;
      seasonsBySlug.set(season.slug, season);
    }
  }
  skippedCurrent = skippedCurrentSlugs.size;

  for (const season of [...seasonsBySlug.values()].sort((a, b) =>
    a.slug.localeCompare(b.slug),
  )) {
    for (const region of regions) {
      if (seasonFilter && season.slug !== seasonFilter) {
        lines.push({
          region,
          seasonSlug: season.slug,
          status: "SKIPPED_FILTER",
        });
        continue;
      }
      try {
        const result = await input.raiderIo.getSeasonCutoffs(
          region as RegionCode,
          season.slug,
          input.ctx,
        );
        const entry = catalogEntryFromSeasonCutoffs({
          region,
          season,
          cutoffs: result.data,
          collectedAt,
        });
        if (Object.keys(entry.cutoffs).length === 0) {
          lines.push({
            region,
            seasonSlug: season.slug,
            status: "SKIPPED_NO_SCORES",
            detail: "provider returned no official quantile scores",
          });
          continue;
        }
        const key = `${entry.region}::${entry.raiderIoSeasonSlug}`;
        entriesByKey.set(key, entry);
        lines.push({ region, seasonSlug: season.slug, status: "OK" });
      } catch (error) {
        failed += 1;
        lines.push({
          region,
          seasonSlug: season.slug,
          status: "FAILED",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const entries = sortCatalogEntries([...entriesByKey.values()]);
  const contentChanged =
    entriesContentFingerprint(entries) !== entriesContentFingerprint(previous.entries);
  let catalogVersion = previous.catalogVersion;
  if (contentChanged) {
    catalogVersion =
      previous.entries.length === 0 ? Math.max(1, previous.catalogVersion) : previous.catalogVersion + 1;
  }

  const catalogCandidate: ExperienceSeasonCutoffsCatalog = {
    schemaVersion: previous.schemaVersion,
    catalogVersion,
    generatedAt: collectedAt,
    entries,
  };

  const validated = validateExperienceSeasonCutoffsCatalog(catalogCandidate);
  if (!validated.ok) {
    throw new Error(
      `Collected catalog failed validation: ${validated.issues
        .map((i) => `${i.path}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const wrote = !input.options?.dryRun;
  if (wrote) {
    writeFileSync(catalogPath, serializeExperienceSeasonCutoffsCatalog(validated.catalog), "utf8");
  }

  lines.sort((a, b) => {
    const regionCmp = a.region.localeCompare(b.region);
    if (regionCmp !== 0) return regionCmp;
    return a.seasonSlug.localeCompare(b.seasonSlug);
  });

  return {
    catalog: validated.catalog,
    catalogPath,
    wrote,
    lines,
    collected: entries.length,
    skippedCurrent,
    failed,
  };
}

export function formatCollectExperienceCutoffsSummary(
  result: CollectExperienceCutoffsResult,
): string {
  const body = result.lines
    .filter(
      (l) =>
        l.status === "OK" ||
        l.status === "FAILED" ||
        l.status === "SKIPPED_CURRENT" ||
        l.status === "SKIPPED_NO_SCORES",
    )
    .map((l) => {
      const pad = `${l.region} ${l.seasonSlug}`.padEnd(28);
      return `${pad} ${l.status}${l.detail ? ` (${l.detail})` : ""}`;
    })
    .join("\n");
  return [
    "Experience cutoff catalog",
    "-------------------------",
    body,
    "",
    `Collected: ${result.collected}`,
    `Skipped current: ${result.skippedCurrent}`,
    `Failed: ${result.failed}`,
    result.wrote ? `Wrote: ${result.catalogPath}` : "Dry-run (not written)",
    `catalogVersion: ${result.catalog.catalogVersion}`,
  ].join("\n");
}

/** Exported for tests — ordering helper. */
export { compareCatalogEntryKeys, EXPERIENCE_SEASON_CUTOFF_QUANTILES };
