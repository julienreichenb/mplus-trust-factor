import { createHash } from "node:crypto";
import type { CharacterIdentityInput, CharacterRef, RegionCode } from "@mplus/contracts";

/** NFKC + stable lower-case for character/realm keys. Display names are preserved separately. */
export function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function normalizeRealmSlug(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function normalizeRegion(value: string): RegionCode {
  return value.normalize("NFKC").trim().toUpperCase();
}

/**
 * Fold diacritics for accent-insensitive search while keeping display strings untouched.
 * Example: "Chérith" → "cherith", "Kazzak" → "kazzak".
 */
export function foldDiacritics(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US");
}

/** Normalized catalog search key for realm display names (accents folded). */
export function normalizeRealmSearchKey(value: string): string {
  return foldDiacritics(value);
}

export function toCharacterRef(input: CharacterIdentityInput): CharacterRef {
  return {
    region: normalizeRegion(input.region),
    realmSlug: normalizeRealmSlug(input.realmSlug),
    normalizedName: normalizeName(input.name),
  };
}

export interface RunFingerprintInput {
  region: RegionCode;
  seasonKey: string;
  dungeonKey: string;
  completedAtMs: number;
  keyLevel: number;
  durationMs: number;
  rosterCanonicalKeys: string[];
}

export function computeRunFingerprint(input: RunFingerprintInput): string {
  const roster = [...input.rosterCanonicalKeys].map(normalizeName).sort();
  const payload = [
    normalizeRegion(input.region),
    input.seasonKey,
    input.dungeonKey,
    String(input.completedAtMs),
    String(input.keyLevel),
    String(input.durationMs),
    roster.join(","),
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function buildRequestFingerprint(parts: {
  provider: string;
  region: string;
  endpointKey: string;
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  bodyHash?: string;
  authScopeType?: string;
}): string {
  const path = Object.keys(parts.pathParams)
    .sort()
    .map((key) => `${key}=${parts.pathParams[key]}`)
    .join("&");
  const query = Object.keys(parts.queryParams)
    .sort()
    .map((key) => `${key}=${parts.queryParams[key]}`)
    .join("&");
  const payload = [
    parts.provider,
    parts.region,
    parts.endpointKey,
    path,
    query,
    parts.bodyHash ?? "",
    parts.authScopeType ?? "public",
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
