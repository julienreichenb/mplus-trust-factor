const WOWHEAD_HOST = "www.wowhead.com";

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Canonical Wowhead item page URL. Returns null for invalid IDs.
 * Locale is omitted unless a future contract supplies an explicit locale.
 */
export function wowheadItemUrl(itemId: number): string | null {
  if (!isPositiveInt(itemId)) return null;
  return `https://${WOWHEAD_HOST}/item=${encodeURIComponent(String(itemId))}`;
}

export function wowheadSpellUrl(spellId: number): string | null {
  if (!isPositiveInt(spellId)) return null;
  return `https://${WOWHEAD_HOST}/spell=${encodeURIComponent(String(spellId))}`;
}

export function isWowheadItemUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === WOWHEAD_HOST &&
      /^\/item=\d+$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}
