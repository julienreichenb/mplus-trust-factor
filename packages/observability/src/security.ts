import { timingSafeEqual } from "node:crypto";

const DEFAULT_ALLOWED_PROVIDER_HOSTS = [
  "eu.api.blizzard.com",
  "us.api.blizzard.com",
  "kr.api.blizzard.com",
  "tw.api.blizzard.com",
  "oauth.battle.net",
  "www.warcraftlogs.com",
  "raider.io",
] as const;

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isAllowedProviderHost(
  urlString: string,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_PROVIDER_HOSTS,
): boolean {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "https:") return false;
    return allowedHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

export function assertAllowedProviderUrl(urlString: string): void {
  if (!isAllowedProviderHost(urlString)) {
    throw new Error(`Provider URL host is not allowlisted: ${urlString}`);
  }
}

export function redactSecretsInObject<T extends Record<string, unknown>>(obj: T): T {
  const sensitive = /secret|password|token|authorization|cookie|api[_-]?key/i;
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (sensitive.test(key)) {
      (result as Record<string, unknown>)[key] = "[Redacted]";
    }
  }
  return result;
}

export { DEFAULT_ALLOWED_PROVIDER_HOSTS };
