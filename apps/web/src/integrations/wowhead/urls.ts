const WOWHEAD_HOST = "www.wowhead.com";

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export interface WowheadItemLinkOptions {
  itemLevel?: number | null;
  bonusList?: readonly number[] | null;
}

function sanitizeBonusList(bonusList: readonly number[] | null | undefined): number[] {
  if (!bonusList?.length) return [];
  return bonusList.filter((id) => isPositiveInt(id));
}

/**
 * Query fragment for Wowhead tooltips / deep links (without leading `item=`).
 * Includes equipped ilvl + bonus IDs so scaled/crafted pieces don't show base item data.
 */
export function wowheadItemQuery(
  itemId: number,
  options: WowheadItemLinkOptions = {},
): string | null {
  if (!isPositiveInt(itemId)) return null;
  const parts = [`item=${encodeURIComponent(String(itemId))}`];
  if (typeof options.itemLevel === "number" && Number.isFinite(options.itemLevel) && options.itemLevel > 0) {
    parts.push(`ilvl=${encodeURIComponent(String(Math.round(options.itemLevel)))}`);
  }
  const bonuses = sanitizeBonusList(options.bonusList);
  if (bonuses.length > 0) {
    // Digits + colon only — keep unencoded for Wowhead deep-link compatibility.
    parts.push(`bonus=${bonuses.join(":")}`);
  }
  return parts.join("&");
}

/**
 * Canonical Wowhead item page URL. Returns null for invalid IDs.
 * Locale is omitted unless a future contract supplies an explicit locale.
 */
export function wowheadItemUrl(
  itemId: number,
  options: WowheadItemLinkOptions = {},
): string | null {
  const query = wowheadItemQuery(itemId, options);
  if (!query) return null;
  // Wowhead uses path-style `item=ID` with optional `&ilvl=` / `&bonus=` query params.
  return `https://${WOWHEAD_HOST}/${query}`;
}

export function wowheadSpellUrl(spellId: number): string | null {
  if (!isPositiveInt(spellId)) return null;
  return `https://${WOWHEAD_HOST}/spell=${encodeURIComponent(String(spellId))}`;
}

export function isWowheadItemUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== WOWHEAD_HOST) return false;
    // `/item=123` or `/item=123&ilvl=298&bonus=1:2`
    return /^\/item=\d+(?:&|$)/.test(parsed.pathname + (parsed.search ? parsed.search.replace(/^\?/, "&") : ""));
  } catch {
    return false;
  }
}
