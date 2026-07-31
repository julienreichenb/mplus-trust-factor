const WOWHEAD_ICON_BASE = "https://wow.zamimg.com/images/wow/icons/large";
const iconNameCache = new Map<number, string | null>();
const inflight = new Map<number, Promise<string | null>>();

/**
 * Resolve a spell icon name via Wowhead's public tooltip endpoint.
 * Returns a safe icon identifier (no extension), or null when unavailable.
 */
export async function resolveWowheadSpellIconName(spellId: number): Promise<string | null> {
  if (!Number.isInteger(spellId) || spellId <= 0) return null;
  if (iconNameCache.has(spellId)) return iconNameCache.get(spellId) ?? null;
  const pending = inflight.get(spellId);
  if (pending) return pending;

  const request = (async () => {
    try {
      // Omit dataEnv — retail/live is Wowhead's default. dataEnv=1 is Classic and
      // 404s many modern spell IDs.
      const response = await fetch(
        `https://nether.wowhead.com/tooltip/spell/${spellId}?locale=0`,
        { method: "GET", mode: "cors", credentials: "omit" },
      );
      if (!response.ok) {
        iconNameCache.set(spellId, null);
        return null;
      }
      const body = await response.text();
      const match =
        body.match(/"icon"\s*:\s*"([^"]+)"/i) ??
        body.match(/icon\s*:\s*'([^']+)'/i) ??
        body.match(/icon:\s*"([^"]+)"/i);
      const iconName = match?.[1]?.trim().replace(/\.(jpg|jpeg|png|webp)$/i, "");
      if (!iconName || !/^[a-z0-9_-]+$/i.test(iconName)) {
        iconNameCache.set(spellId, null);
        return null;
      }
      iconNameCache.set(spellId, iconName);
      return iconName;
    } catch {
      iconNameCache.set(spellId, null);
      return null;
    } finally {
      inflight.delete(spellId);
    }
  })();

  inflight.set(spellId, request);
  return request;
}

/**
 * Resolve a spell icon via Wowhead's public tooltip endpoint (CORS-friendly CDN).
 * Returns a zamimg HTTPS URL, or null when unavailable.
 */
export async function resolveWowheadSpellIconUrl(spellId: number): Promise<string | null> {
  const iconName = await resolveWowheadSpellIconName(spellId);
  return iconName ? `${WOWHEAD_ICON_BASE}/${iconName}.jpg` : null;
}

/** Resolve many spell icons with a small concurrency limit. */
export async function resolveWowheadSpellIconUrls(
  spellIds: number[],
  concurrency = 6,
): Promise<Map<number, string>> {
  const unique = [...new Set(spellIds.filter((id) => Number.isInteger(id) && id > 0))];
  const resolved = new Map<number, string>();
  let index = 0;

  async function worker(): Promise<void> {
    while (index < unique.length) {
      const spellId = unique[index++]!;
      const url = await resolveWowheadSpellIconUrl(spellId);
      if (url) resolved.set(spellId, url);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, () => worker());
  await Promise.all(workers);
  return resolved;
}
