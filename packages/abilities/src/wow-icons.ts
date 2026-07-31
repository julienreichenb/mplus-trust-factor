/**
 * Approved WoW icon CDN (Wowhead/Zamimg public icons).
 * Icon inputs are treated as identifiers only — never as arbitrary URLs.
 */
export const WOW_ICON_CDN_ORIGIN = "https://wow.zamimg.com";
export const WOW_ICON_CDN_BASE = `${WOW_ICON_CDN_ORIGIN}/images/wow/icons/large`;

const SAFE_ICON_NAME_RE = /^[a-z0-9_-]+$/;
const TRAILING_EXTENSION_RE = /\.(jpe?g|png|webp)$/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Neutral missing-icon tile (dark gray). Safe for img src / CSS background. */
export const WOW_ICON_FALLBACK_DATA_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#3a3a42" rx="4"/></svg>',
  );

/**
 * Normalize a catalog/API icon identifier to a bare CDN file stem.
 * Accepts names with or without a known image extension, and legacy path basenames.
 * Rejects protocols, hostnames, data/javascript URLs, and traversal-only junk.
 */
export function normalizeWowIconName(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Identifiers only — never accept schemes, protocol-relative URLs, or data URLs.
  if (SCHEME_RE.test(trimmed) || trimmed.startsWith("//")) return null;
  if (/^(javascript|data|vbscript)\b/i.test(trimmed)) return null;

  // Reject host-like values (e.g. evil.example/icons/foo) without a scheme.
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(trimmed)) return null;

  let candidate = trimmed;
  if (candidate.includes("/") || candidate.includes("\\")) {
    const parts = candidate.split(/[/\\]/).filter((part) => part.length > 0);
    if (parts.some((part) => part === "." || part === "..")) return null;
    candidate = parts[parts.length - 1] ?? "";
  }

  const queryIndex = candidate.search(/[?#]/);
  if (queryIndex >= 0) candidate = candidate.slice(0, queryIndex);

  candidate = candidate.replace(TRAILING_EXTENSION_RE, "");
  if (!candidate) return null;

  const normalized = candidate.toLowerCase();
  if (!SAFE_ICON_NAME_RE.test(normalized)) return null;
  return normalized;
}

/**
 * Build an allowlisted CDN icon URL from a safe icon identifier.
 * Never passes through arbitrary URLs from API/catalog data.
 */
export function wowIconUrl(icon: string | null | undefined): string | null {
  const name = normalizeWowIconName(icon);
  if (!name) return null;
  return `${WOW_ICON_CDN_BASE}/${name}.jpg`;
}

/** Resolve a display src: normalized CDN URL, or the neutral fallback data URI. */
export function wowIconSrc(icon: string | null | undefined): string {
  return wowIconUrl(icon) ?? WOW_ICON_FALLBACK_DATA_URI;
}
