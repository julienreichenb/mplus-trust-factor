import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import type { RegionCode } from "@mplus/contracts";

export function buildLookupKey(region: RegionCode, realmSlug: string, name: string): string {
  return `${normalizeRegion(region)}:${normalizeRealmSlug(realmSlug)}:${normalizeName(name)}`;
}

export function shardBucket(normalizedName: string): string {
  const first = normalizedName.charAt(0);
  if (!first) {
    return "_";
  }
  const code = first.charCodeAt(0);
  if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
    return first;
  }
  return "_";
}

export function shardRelativePath(
  region: RegionCode,
  realmSlug: string,
  normalizedName: string,
): string {
  const bucket = shardBucket(normalizedName);
  return `${normalizeRegion(region)}/${normalizeRealmSlug(realmSlug)}/${bucket}`;
}

export function shardFilePath(
  region: RegionCode,
  realmSlug: string,
  normalizedName: string,
): string {
  return `${shardRelativePath(region, realmSlug, normalizedName)}.lua`;
}
