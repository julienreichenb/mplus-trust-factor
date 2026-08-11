/**
 * Experience historical season-cutoffs catalog — offline source of truth for
 * Season population policies. Collected via `pnpm experience:cutoffs:collect`,
 * imported by `pnpm db:seed` (no network).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegionCode } from "@mplus/contracts";

export const EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION =
  "experience-season-cutoffs-catalog-v1" as const;

/** Season.metadata sibling key for catalog import provenance (not the policy doc). */
export const EXPERIENCE_POPULATION_CATALOG_PROVENANCE_KEY =
  "experiencePopulationCatalog" as const;

export const EXPERIENCE_SEASON_CUTOFF_QUANTILES = [
  "p999",
  "p990",
  "p900",
  "p750",
  "p600",
] as const;

export type ExperienceSeasonCutoffQuantile =
  (typeof EXPERIENCE_SEASON_CUTOFF_QUANTILES)[number];

export const SUPPORTED_EXPERIENCE_CUTOFF_REGIONS = ["EU", "US", "KR", "TW"] as const;

export type ExperienceCutoffRegionCode =
  (typeof SUPPORTED_EXPERIENCE_CUTOFF_REGIONS)[number];

export interface ExperienceSeasonCutoffsCatalogSource {
  provider: "raiderio";
  schemaVersion: string;
  collectedAt: string;
}

export interface ExperienceSeasonCutoffsCatalogEntry {
  region: ExperienceCutoffRegionCode;
  raiderIoSeasonSlug: string;
  blizzardSeasonId: number | null;
  name: string | null;
  startsAt: string | null;
  endsAt: string | null;
  closed: true;
  cutoffs: Partial<Record<ExperienceSeasonCutoffQuantile, number>>;
  /** Regional Mythic+ population when Raider.IO exposes totalPopulationCount. */
  totalPopulation: number | null;
  sourceUpdatedAt: string | null;
  isRemappedSeason: boolean | null;
  source: ExperienceSeasonCutoffsCatalogSource;
}

export interface ExperienceSeasonCutoffsCatalog {
  schemaVersion: typeof EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION;
  /** Monotonic catalog revision; seed refuses to apply an older revision over a newer one. */
  catalogVersion: number;
  generatedAt: string;
  entries: ExperienceSeasonCutoffsCatalogEntry[];
}

export interface ExperiencePopulationCatalogProvenance {
  catalogVersion: number;
  catalogSchemaVersion: typeof EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION;
  raiderIoSeasonSlug: string;
  importedAt: string;
}

export type CatalogValidationIssue = { path: string; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSupportedRegion(value: string): value is ExperienceCutoffRegionCode {
  return (SUPPORTED_EXPERIENCE_CUTOFF_REGIONS as readonly string[]).includes(value);
}

function isFiniteScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Canonical Raider.IO main-season slug (not event/remix). */
export function isCanonicalRaiderIoMainSeasonSlug(slug: string): boolean {
  return /^season-[a-z]+-\d+$/i.test(slug.trim());
}

export function experienceSeasonCutoffsCatalogPath(): string {
  // Works from both src/ (tsx seed) and dist/ (built package).
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return resolve(packageRoot, "src", "seed-data", "experience-season-cutoffs.json");
}

export function compareCatalogEntryKeys(
  a: Pick<ExperienceSeasonCutoffsCatalogEntry, "region" | "raiderIoSeasonSlug">,
  b: Pick<ExperienceSeasonCutoffsCatalogEntry, "region" | "raiderIoSeasonSlug">,
): number {
  const regionCmp = a.region.localeCompare(b.region);
  if (regionCmp !== 0) return regionCmp;
  return a.raiderIoSeasonSlug.localeCompare(b.raiderIoSeasonSlug);
}

export function sortCatalogEntries<T extends ExperienceSeasonCutoffsCatalogEntry>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(compareCatalogEntryKeys);
}

/**
 * Deterministic JSON for Git diffs / equality (sorted keys via JSON.stringify order
 * on a normalized object tree).
 */
export function serializeExperienceSeasonCutoffsCatalog(
  catalog: ExperienceSeasonCutoffsCatalog,
): string {
  const normalized: ExperienceSeasonCutoffsCatalog = {
    schemaVersion: EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION,
    catalogVersion: catalog.catalogVersion,
    generatedAt: catalog.generatedAt,
    entries: sortCatalogEntries(catalog.entries).map((entry) => {
      const cutoffs: Partial<Record<ExperienceSeasonCutoffQuantile, number>> = {};
      for (const q of EXPERIENCE_SEASON_CUTOFF_QUANTILES) {
        const score = entry.cutoffs[q];
        if (score !== undefined) cutoffs[q] = score;
      }
      return {
        region: entry.region,
        raiderIoSeasonSlug: entry.raiderIoSeasonSlug,
        blizzardSeasonId: entry.blizzardSeasonId,
        name: entry.name,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        closed: true,
        cutoffs,
        totalPopulation: entry.totalPopulation,
        sourceUpdatedAt: entry.sourceUpdatedAt,
        isRemappedSeason: entry.isRemappedSeason,
        source: {
          provider: "raiderio",
          schemaVersion: entry.source.schemaVersion,
          collectedAt: entry.source.collectedAt,
        },
      };
    }),
  };
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function validateExperienceSeasonCutoffsCatalog(
  raw: unknown,
): { ok: true; catalog: ExperienceSeasonCutoffsCatalog } | { ok: false; issues: CatalogValidationIssue[] } {
  const issues: CatalogValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ path: "", message: "catalog must be an object" }] };
  }
  if (raw.schemaVersion !== EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: `expected ${EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION}`,
    });
  }
  if (
    typeof raw.catalogVersion !== "number" ||
    !Number.isInteger(raw.catalogVersion) ||
    raw.catalogVersion < 1
  ) {
    issues.push({ path: "catalogVersion", message: "must be an integer >= 1" });
  }
  if (typeof raw.generatedAt !== "string" || !raw.generatedAt.trim()) {
    issues.push({ path: "generatedAt", message: "must be a non-empty ISO string" });
  }
  if (!Array.isArray(raw.entries)) {
    issues.push({ path: "entries", message: "must be an array" });
    return { ok: false, issues };
  }

  const seen = new Set<string>();
  const entries: ExperienceSeasonCutoffsCatalogEntry[] = [];
  raw.entries.forEach((item, index) => {
    const path = `entries[${index}]`;
    if (!isPlainObject(item)) {
      issues.push({ path, message: "must be an object" });
      return;
    }
    if (typeof item.region !== "string" || !isSupportedRegion(item.region)) {
      issues.push({ path: `${path}.region`, message: "must be EU|US|KR|TW" });
      return;
    }
    if (
      typeof item.raiderIoSeasonSlug !== "string" ||
      !isCanonicalRaiderIoMainSeasonSlug(item.raiderIoSeasonSlug)
    ) {
      issues.push({
        path: `${path}.raiderIoSeasonSlug`,
        message: "must match season-<expansion>-<n> (main season only)",
      });
      return;
    }
    // Reject event/remix slug shapes even if regex somehow widened later.
    if (/remix|event|post|cutoffs/i.test(item.raiderIoSeasonSlug)) {
      issues.push({
        path: `${path}.raiderIoSeasonSlug`,
        message: "event/remix/non-main season slugs are rejected",
      });
      return;
    }
    const key = `${item.region}::${item.raiderIoSeasonSlug}`;
    if (seen.has(key)) {
      issues.push({ path, message: `duplicate region+season ${key}` });
      return;
    }
    seen.add(key);

    if (item.closed !== true) {
      issues.push({ path: `${path}.closed`, message: "catalog entries must be closed: true" });
    }
    if (
      !(
        item.blizzardSeasonId === null ||
        (typeof item.blizzardSeasonId === "number" &&
          Number.isInteger(item.blizzardSeasonId) &&
          item.blizzardSeasonId > 0)
      )
    ) {
      issues.push({
        path: `${path}.blizzardSeasonId`,
        message: "must be positive integer or null",
      });
    }
    if (!(item.name === null || typeof item.name === "string")) {
      issues.push({ path: `${path}.name`, message: "must be string or null" });
    }
    if (!(item.startsAt === null || typeof item.startsAt === "string")) {
      issues.push({ path: `${path}.startsAt`, message: "must be string or null" });
    }
    if (!(item.endsAt === null || typeof item.endsAt === "string")) {
      issues.push({ path: `${path}.endsAt`, message: "must be string or null" });
    }
    if (!(item.sourceUpdatedAt === null || typeof item.sourceUpdatedAt === "string")) {
      issues.push({ path: `${path}.sourceUpdatedAt`, message: "must be string or null" });
    }
    if (
      !(
        item.isRemappedSeason === null || typeof item.isRemappedSeason === "boolean"
      )
    ) {
      issues.push({
        path: `${path}.isRemappedSeason`,
        message: "must be boolean or null",
      });
    }
    if (
      !(
        item.totalPopulation === null ||
        (typeof item.totalPopulation === "number" &&
          Number.isFinite(item.totalPopulation) &&
          item.totalPopulation >= 0)
      )
    ) {
      issues.push({
        path: `${path}.totalPopulation`,
        message: "must be finite >= 0 or null",
      });
    }
    if (!isPlainObject(item.cutoffs)) {
      issues.push({ path: `${path}.cutoffs`, message: "must be an object" });
      return;
    }
    const cutoffs: Partial<Record<ExperienceSeasonCutoffQuantile, number>> = {};
    let cutoffCount = 0;
    for (const [q, score] of Object.entries(item.cutoffs)) {
      if (!(EXPERIENCE_SEASON_CUTOFF_QUANTILES as readonly string[]).includes(q)) {
        issues.push({
          path: `${path}.cutoffs.${q}`,
          message: "unknown quantile — only p999/p990/p900/p750/p600 (no interpolation)",
        });
        continue;
      }
      if (!isFiniteScore(score)) {
        issues.push({
          path: `${path}.cutoffs.${q}`,
          message: "must be a finite score >= 0",
        });
        continue;
      }
      cutoffs[q as ExperienceSeasonCutoffQuantile] = score;
      cutoffCount += 1;
    }
    if (cutoffCount < 1) {
      issues.push({
        path: `${path}.cutoffs`,
        message: "at least one official quantile score is required",
      });
    }
    // Strongest → weakest must be non-increasing (no invented midpoints).
    const presentScores = EXPERIENCE_SEASON_CUTOFF_QUANTILES.map((q) => cutoffs[q]).filter(
      (s): s is number => s !== undefined,
    );
    for (let i = 1; i < presentScores.length; i += 1) {
      if (presentScores[i]! > presentScores[i - 1]!) {
        issues.push({
          path: `${path}.cutoffs`,
          message: "cutoff scores must be non-increasing p999→p600 (no interpolation)",
        });
        break;
      }
    }

    if (!isPlainObject(item.source)) {
      issues.push({ path: `${path}.source`, message: "must be an object" });
      return;
    }
    if (item.source.provider !== "raiderio") {
      issues.push({ path: `${path}.source.provider`, message: "must be raiderio" });
    }
    if (typeof item.source.schemaVersion !== "string" || !item.source.schemaVersion.trim()) {
      issues.push({
        path: `${path}.source.schemaVersion`,
        message: "must be a non-empty string",
      });
    }
    if (typeof item.source.collectedAt !== "string" || !item.source.collectedAt.trim()) {
      issues.push({
        path: `${path}.source.collectedAt`,
        message: "must be a non-empty ISO string",
      });
    }

    if (issues.some((i) => i.path.startsWith(path))) return;

    entries.push({
      region: item.region,
      raiderIoSeasonSlug: item.raiderIoSeasonSlug.trim(),
      blizzardSeasonId:
        typeof item.blizzardSeasonId === "number" ? item.blizzardSeasonId : null,
      name: typeof item.name === "string" ? item.name : null,
      startsAt: typeof item.startsAt === "string" ? item.startsAt : null,
      endsAt: typeof item.endsAt === "string" ? item.endsAt : null,
      closed: true,
      cutoffs,
      totalPopulation:
        typeof item.totalPopulation === "number" ? item.totalPopulation : null,
      sourceUpdatedAt:
        typeof item.sourceUpdatedAt === "string" ? item.sourceUpdatedAt : null,
      isRemappedSeason:
        typeof item.isRemappedSeason === "boolean" ? item.isRemappedSeason : null,
      source: {
        provider: "raiderio",
        schemaVersion: String(item.source.schemaVersion),
        collectedAt: String(item.source.collectedAt),
      },
    });
  });

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    catalog: {
      schemaVersion: EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION,
      catalogVersion: raw.catalogVersion as number,
      generatedAt: String(raw.generatedAt),
      entries: sortCatalogEntries(entries),
    },
  };
}

export function loadExperienceSeasonCutoffsCatalog(
  path = experienceSeasonCutoffsCatalogPath(),
): ExperienceSeasonCutoffsCatalog {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const validated = validateExperienceSeasonCutoffsCatalog(raw);
  if (!validated.ok) {
    const detail = validated.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`Invalid experience season cutoffs catalog at ${path}: ${detail}`);
  }
  return validated.catalog;
}

export function readExperiencePopulationCatalogProvenance(
  metadata: unknown,
): ExperiencePopulationCatalogProvenance | null {
  if (!isPlainObject(metadata)) return null;
  const raw = metadata[EXPERIENCE_POPULATION_CATALOG_PROVENANCE_KEY];
  if (!isPlainObject(raw)) return null;
  if (raw.catalogSchemaVersion !== EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION) {
    return null;
  }
  if (
    typeof raw.catalogVersion !== "number" ||
    !Number.isInteger(raw.catalogVersion) ||
    raw.catalogVersion < 1
  ) {
    return null;
  }
  if (typeof raw.raiderIoSeasonSlug !== "string" || !raw.raiderIoSeasonSlug.trim()) {
    return null;
  }
  if (typeof raw.importedAt !== "string" || !raw.importedAt.trim()) return null;
  return {
    catalogVersion: raw.catalogVersion,
    catalogSchemaVersion: EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION,
    raiderIoSeasonSlug: raw.raiderIoSeasonSlug,
    importedAt: raw.importedAt,
  };
}

export function emptyExperienceSeasonCutoffsCatalog(
  generatedAt = new Date().toISOString(),
): ExperienceSeasonCutoffsCatalog {
  return {
    schemaVersion: EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION,
    catalogVersion: 1,
    generatedAt,
    entries: [],
  };
}

/** RegionCode narrowing for callers that already validated the catalog. */
export function catalogRegionAsRegionCode(
  region: ExperienceCutoffRegionCode,
): RegionCode {
  return region;
}
