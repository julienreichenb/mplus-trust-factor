/**
 * Canonical dungeon name → slug used across WCL discovery / aggregates.
 * Standalone helper — not tied to report metadata fetching.
 */
export function slugifyDungeonName(value: string): string {
  const hasPossessiveS = /['’]s\b/i.test(value);
  let slug = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (hasPossessiveS) {
    // "Maisara's Caverns" -> "maisara-caverns" instead of "maisaras-caverns"
    slug = slug.replace(/^([a-z0-9]+)s-/, "$1-");
  }

  return slug;
}
