/**
 * Resolve the canonical active-season dungeon pool before scoring-run selection.
 * Off-pool dungeons (e.g. legacy icecrown runs) must never enter the eight-run set.
 */
export function normalizeDungeonSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

/** Where the canonical active-season dungeon pool was resolved from. */
export type ActiveSeasonDungeonPoolSource =
  | "season_db"
  | "blizzard_metadata"
  | "raiderio_static"
  | "none";

export interface ResolveActiveSeasonDungeonSlugsInput {
  expectedDungeonCount: number;
  /** Authoritative: internal SeasonDungeon rows synced from Blizzard season metadata. */
  seasonDungeonSlugs?: string[];
  /** Authoritative: Blizzard season metadata dungeon slugs when DB rows are absent. */
  blizzardSeasonDungeonSlugs?: string[];
  /** Cached static fallback when season DB / Blizzard metadata are not seeded. */
  raiderioDungeonSlugs?: string[];
  /**
   * WCL zone-ranking slugs — enrichment/diagnostics only.
   * Never used to expand or define the canonical active-season pool.
   */
  wclDungeonSlugs?: string[];
}

export interface ResolvedActiveSeasonDungeonPool {
  /** Canonical slugs used for scoring-run selection filtering. */
  canonicalSlugs: string[];
  expectedDungeonCount: number;
  source: ActiveSeasonDungeonPoolSource;
  /** WCL slugs that intersect the canonical pool (usable for enrichment). */
  wclMatchedSlugs: string[];
  /** WCL slugs outside the canonical pool — must be ignored for selection/scoring. */
  wclOffPoolSlugs: string[];
}

function normalizeSlugList(slugs: string[] | undefined): string[] {
  return [...new Set((slugs ?? []).map(normalizeDungeonSlug).filter(Boolean))].sort();
}

function intersectWclWithCanonicalPool(
  canonicalSlugs: string[],
  wclSlugs: string[],
): { matched: string[]; offPool: string[] } {
  const canonicalSet = new Set(canonicalSlugs.map(normalizeDungeonSlug));
  const wcl = normalizeSlugList(wclSlugs);
  const matched: string[] = [];
  const offPool: string[] = [];
  for (const slug of wcl) {
    if (canonicalSet.has(slug)) matched.push(slug);
    else offPool.push(slug);
  }
  return { matched, offPool };
}

/**
 * Resolve the canonical active-season dungeon pool from Blizzard/internal season metadata.
 * WCL availability, completeness, or stale zone data never determines pool membership.
 */
export function resolveActiveSeasonDungeonPool(
  input: ResolveActiveSeasonDungeonSlugsInput,
): ResolvedActiveSeasonDungeonPool {
  const expected = Math.max(1, input.expectedDungeonCount);
  const season = normalizeSlugList(input.seasonDungeonSlugs);
  const blizzard = normalizeSlugList(input.blizzardSeasonDungeonSlugs);
  const rio = normalizeSlugList(input.raiderioDungeonSlugs);

  let canonicalSlugs: string[] = [];
  let source: ActiveSeasonDungeonPoolSource = "none";

  if (season.length > 0) {
    canonicalSlugs = season.slice(0, expected);
    source = "season_db";
  } else if (blizzard.length > 0) {
    canonicalSlugs = blizzard.slice(0, expected);
    source = "blizzard_metadata";
  } else if (rio.length > 0) {
    canonicalSlugs = rio.slice(0, expected);
    source = "raiderio_static";
  }

  const wclPartition = intersectWclWithCanonicalPool(
    canonicalSlugs,
    input.wclDungeonSlugs ?? [],
  );

  return {
    canonicalSlugs,
    expectedDungeonCount: expected,
    source,
    wclMatchedSlugs: wclPartition.matched,
    wclOffPoolSlugs: wclPartition.offPool,
  };
}

/** Backward-compatible helper returning canonical slugs only. */
export function resolveActiveSeasonDungeonSlugs(
  input: ResolveActiveSeasonDungeonSlugsInput,
): string[] {
  return resolveActiveSeasonDungeonPool(input).canonicalSlugs;
}

export function isDungeonInActiveSeasonPool(
  dungeonSlug: string,
  activeSlugs: string[],
): boolean {
  const normalized = normalizeDungeonSlug(dungeonSlug);
  return activeSlugs.some((slug) => normalizeDungeonSlug(slug) === normalized);
}

/** Read Blizzard-synced dungeon slugs stored on the internal Season.metadata document. */
export function readBlizzardSeasonDungeonSlugsFromMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const record = metadata as Record<string, unknown>;
  const candidates = [record.dungeonSlugs, record.activeDungeonSlugs, record.dungeons];
  for (const value of candidates) {
    if (!Array.isArray(value)) continue;
    const slugs = value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && typeof (entry as { slug?: string }).slug === "string") {
          return (entry as { slug: string }).slug;
        }
        return null;
      })
      .filter((slug): slug is string => typeof slug === "string" && slug.trim().length > 0);
    if (slugs.length > 0) return slugs;
  }
  return [];
}
