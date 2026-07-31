/**
 * Browser-safe Warcraft Logs URL allowlist.
 * Must stay aligned with `sanitizeWarcraftLogsUrl` in `@mplus/contracts`.
 */
export const WARCRAFT_LOGS_URL_HOSTNAMES = ["www.warcraftlogs.com", "warcraftlogs.com"] as const;

/** HTTPS + exact hostname allowlist — no suffix matching, no credentials. */
export function sanitizeWarcraftLogsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!(WARCRAFT_LOGS_URL_HOSTNAMES as readonly string[]).includes(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
