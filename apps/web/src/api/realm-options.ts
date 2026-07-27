import type { RealmOption } from "./types";

/** Human-readable realm label from a canonical slug, e.g. `tarren-mill` → `Tarren Mill`. */
export function formatRealmDisplayName(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** Ensures realm options always expose a display label separate from the canonical slug. */
export function normalizeRealmOption(raw: { slug: string; name?: string | null }): RealmOption {
  const slug = raw.slug.trim().toLowerCase();
  const rawName = raw.name?.trim();
  const name =
    rawName && rawName.toLowerCase() !== slug ? rawName : formatRealmDisplayName(slug);
  return { slug, name };
}

export function normalizeRealmOptions(
  realms: Array<{ slug: string; name?: string | null }>,
): RealmOption[] {
  return realms.map(normalizeRealmOption);
}
