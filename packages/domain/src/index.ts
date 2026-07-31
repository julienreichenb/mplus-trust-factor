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

/** Folded search key for character display / normalized names (accents folded). */
export function normalizeCharacterSearchKey(value: string): string {
  return foldDiacritics(value);
}

/**
 * Minimum folded query length before PostgreSQL trigram fuzzy matching is used.
 * Length-2 queries stay exact/prefix/substring only (no noisy broad matches).
 */
export const CHARACTER_NAME_FUZZY_MIN_QUERY_LENGTH = 4;

/**
 * Deterministic pg_trgm similarity floor for typo-tolerant public autocomplete.
 * Conservative enough that short accidental overlaps do not flood results.
 */
export const CHARACTER_NAME_FUZZY_SIMILARITY_THRESHOLD = 0.35;

/**
 * Deterministic public character-name match rank (lower wins).
 * Ladder: exact name → exact alias → prefix → substring → trigram-only fuzzy.
 *
 * Blizzard has no supported global/fuzzy character search API. Fuzzy matching
 * applies only to characters already persisted in M+ Trust Factor.
 */
export function rankCharacterNameMatch(input: {
  queryFolded: string;
  nameFolded: string;
  /** When the hit came from an alias row, the folded alias name. */
  aliasFolded?: string | null;
  source: "character" | "alias" | "participant";
  /**
   * True only when the row was retrieved via trigram similarity and is not
   * already an exact/prefix/substring hit.
   */
  fuzzyMatched?: boolean;
}): number {
  const q = input.queryFolded;
  if (!q) return 100;
  if (input.nameFolded === q) return 0;
  if (input.source === "alias" && input.aliasFolded != null && input.aliasFolded === q) return 1;
  if (input.nameFolded.startsWith(q) || (input.aliasFolded?.startsWith(q) ?? false)) return 2;
  if (input.nameFolded.includes(q) || (input.aliasFolded?.includes(q) ?? false)) return 3;
  if (input.fuzzyMatched) return 4;
  return 10;
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

export {
  classifyRealmCatalogEntry,
  classifyRealmIndexEntry,
  type RealmCatalogClassifyInput,
  type RealmCatalogEligibility,
  type RealmCatalogRejectionReason,
} from "./realm-catalog-eligibility.js";
