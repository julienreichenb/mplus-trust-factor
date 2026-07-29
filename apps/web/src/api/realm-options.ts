import type { RealmOption, RegionCode } from "./types";

/** Human-readable realm label from a canonical slug, e.g. `tarren-mill` → `Tarren Mill`. */
export function formatRealmDisplayName(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** Prefer API/catalog display name; fall back to slug formatting. */
export function resolveRealmDisplayName(slug: string, name?: string | null): string {
  const rawName = name?.trim();
  if (rawName && rawName.toLowerCase() !== slug.trim().toLowerCase()) {
    return rawName;
  }
  return formatRealmDisplayName(slug);
}

export function formatRealmSelectedLabel(name: string, region: string): string {
  return `${name} — ${region.toUpperCase()}`;
}

export function formatRealmSecondaryLabel(option: {
  region?: string | null;
  locale?: string | null;
  category?: string | null;
}): string {
  const region = (option.region ?? "EU").toUpperCase();
  const regionLabel =
    region === "EU"
      ? "Europe"
      : region === "US"
        ? "Americas"
        : region === "KR"
          ? "Korea"
          : region === "TW"
            ? "Taiwan"
            : region;
  const localeMap: Record<string, string> = {
    en_GB: "English",
    en_US: "English",
    fr_FR: "Français",
    de_DE: "Deutsch",
    es_ES: "Español",
    it_IT: "Italiano",
    pt_BR: "Português",
    ru_RU: "Русский",
    ko_KR: "한국어",
    zh_TW: "繁體中文",
  };
  const localeLabel =
    (option.locale ? localeMap[option.locale] : null) ?? option.category ?? option.locale ?? null;
  return localeLabel ? `${regionLabel} · ${localeLabel}` : regionLabel;
}

/** Ensures realm options always expose a display label separate from the canonical slug. */
export function normalizeRealmOption(raw: {
  slug: string;
  name?: string | null;
  region?: string | null;
  locale?: string | null;
  connectedRealmId?: number | null;
  displayLabel?: string | null;
  category?: string | null;
  timezone?: string | null;
}): RealmOption {
  const slug = raw.slug.trim().toLowerCase();
  const region = (raw.region ?? "EU").toUpperCase() as RegionCode;
  const rawName = raw.name?.trim();
  const name =
    rawName && rawName.toLowerCase() !== slug ? rawName : formatRealmDisplayName(slug);
  return {
    slug,
    name,
    region,
    locale: raw.locale ?? null,
    connectedRealmId: raw.connectedRealmId ?? null,
    displayLabel: raw.displayLabel?.trim() || formatRealmSelectedLabel(name, region),
    category: raw.category ?? null,
    timezone: raw.timezone ?? null,
  };
}

export function normalizeRealmOptions(
  realms: Array<{
    slug: string;
    name?: string | null;
    region?: string | null;
    locale?: string | null;
    connectedRealmId?: number | null;
    displayLabel?: string | null;
    category?: string | null;
    timezone?: string | null;
  }>,
): RealmOption[] {
  return realms.map(normalizeRealmOption);
}
