/**
 * Resolve the canonical active-season dungeon pool before scoring-run selection.
 * Off-pool dungeons (e.g. legacy icecrown runs) must never enter the eight-run set.
 */
export function normalizeDungeonSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

export interface ResolveActiveSeasonDungeonSlugsInput {
  expectedDungeonCount: number;
  wclDungeonSlugs?: string[];
  seasonDungeonSlugs?: string[];
  raiderioDungeonSlugs?: string[];
}

/**
 * Pick exactly one slug list for the active season. Prefer WCL zone-ranking aggregates
 * when they cover the full expected pool; otherwise season DB or Raider.IO static data.
 */
export function resolveActiveSeasonDungeonSlugs(
  input: ResolveActiveSeasonDungeonSlugsInput,
): string[] {
  const expected = Math.max(1, input.expectedDungeonCount);
  const normalize = (slugs: string[] | undefined): string[] =>
    [...new Set((slugs ?? []).map(normalizeDungeonSlug).filter(Boolean))].sort();

  const wcl = normalize(input.wclDungeonSlugs);
  const season = normalize(input.seasonDungeonSlugs);
  const rio = normalize(input.raiderioDungeonSlugs);

  if (wcl.length >= expected) return wcl.slice(0, expected);
  if (season.length >= expected) return season.slice(0, expected);
  if (rio.length >= expected) return rio.slice(0, expected);

  const merged = [...new Set([...wcl, ...season, ...rio])].sort();
  return merged.slice(0, expected);
}

export function isDungeonInActiveSeasonPool(
  dungeonSlug: string,
  activeSlugs: string[],
): boolean {
  const normalized = normalizeDungeonSlug(dungeonSlug);
  return activeSlugs.some((slug) => normalizeDungeonSlug(slug) === normalized);
}
