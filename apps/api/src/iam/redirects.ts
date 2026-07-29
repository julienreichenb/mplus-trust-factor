import type { AppEnv } from "@mplus/config";

export function parseCallbackAllowlist(env: AppEnv): string[] {
  return env.BATTLENET_OAUTH_CALLBACK_URLS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedCallbackUrl(env: AppEnv, candidate: string): boolean {
  const allowlist = parseCallbackAllowlist(env);
  try {
    const url = new URL(candidate);
    return allowlist.some((allowed) => {
      try {
        const a = new URL(allowed);
        return a.href === url.href;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Post-login redirects must be relative paths on this app — never absolute external URLs.
 * Rejects protocol-relative and backslash tricks.
 */
export function sanitizeReturnTo(raw: string | undefined | null, fallback = "/account"): string {
  if (!raw) return fallback;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  if (value.includes("://")) {
    return fallback;
  }
  return value;
}

export function isSecureCookie(env: AppEnv): boolean {
  return env.NODE_ENV === "production" || env.APP_ENV === "production" || env.APP_ENV === "staging";
}
