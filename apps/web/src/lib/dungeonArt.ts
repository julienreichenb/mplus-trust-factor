/**
 * Sanitize dungeon artwork URLs for CSS/img use.
 * Official tile URLs come from the API (Blizzard journal-instance media).
 */
export function sanitizeDungeonImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith("https://")) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
