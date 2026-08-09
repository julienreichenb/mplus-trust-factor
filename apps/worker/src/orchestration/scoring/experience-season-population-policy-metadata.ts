/**
 * Experience Phase 1 — Season.metadata persistence for SeasonPopulationPolicy.
 * Owns only the experiencePopulationPolicy namespace.
 *
 * Store schema v2 pairs with season-population-policy-v2 (native bands).
 * Store schema v1 documents are accepted via provider-free upgrade when anchors
 * are the canonical p999/p990/p900/p750/p600 mappings.
 */

import {
  isMonotonicPopulationAnchors,
  SEASON_POPULATION_POLICY_VERSION,
  SEASON_POPULATION_POLICY_VERSION_V1,
  upgradeSeasonPopulationPolicyV1ToV2,
  stableSha256,
  type SeasonPopulationAnchor,
  type SeasonPopulationAnchorKey,
  type SeasonPopulationPolicy,
  type SeasonPopulationPolicyQuality,
  type NativeCutoffQuantile,
} from "@mplus/scoring";

export const EXPERIENCE_POPULATION_POLICY_METADATA_KEY = "experiencePopulationPolicy" as const;

export const EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION =
  "experience-population-policy-store-v2" as const;

/** Legacy store schema — readable for provider-free v1→v2 upgrade only. */
export const EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION_V1 =
  "experience-population-policy-store-v1" as const;

export interface PersistedExperiencePopulationPolicyMetadata {
  schemaVersion: typeof EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION;
  policy: SeasonPopulationPolicy;
  raiderIoSeasonSlug: string;
  policyContentHash: string;
  sourceRequestFingerprint: string;
  sourcePayloadId: string | null;
  sourceFetchedAt: string;
  synchronizedAt: string;
  lastKnownGood: true;
}

const ANCHOR_KEYS = new Set<SeasonPopulationAnchorKey>([
  "top_0_1_percent",
  "top_1_percent",
  "top_10_percent",
  "top_25_percent",
  "top_40_percent",
]);

const EXPECTED_TOP_PERCENT: Record<SeasonPopulationAnchorKey, number> = {
  top_0_1_percent: 0.1,
  top_1_percent: 1,
  top_10_percent: 10,
  top_25_percent: 25,
  top_40_percent: 40,
};

const KEY_TO_NATIVE: Record<SeasonPopulationAnchorKey, NativeCutoffQuantile> = {
  top_0_1_percent: "p999",
  top_1_percent: "p990",
  top_10_percent: "p900",
  top_25_percent: "p750",
  top_40_percent: "p600",
};

const QUALITIES = new Set<SeasonPopulationPolicyQuality>([
  "COMPLETE",
  "PARTIAL",
  "INSUFFICIENT",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function qualityMatchesAnchorCount(
  quality: SeasonPopulationPolicyQuality,
  count: number,
): boolean {
  if (quality === "COMPLETE") return count >= 5;
  if (quality === "PARTIAL") return count >= 2 && count <= 4;
  return count <= 1;
}

function parseAnchor(raw: unknown): SeasonPopulationAnchor | null {
  if (!isPlainObject(raw)) return null;
  const key = raw.key;
  if (typeof key !== "string" || !ANCHOR_KEYS.has(key as SeasonPopulationAnchorKey)) {
    return null;
  }
  const anchorKey = key as SeasonPopulationAnchorKey;
  if (typeof raw.topPercent !== "number" || !Number.isFinite(raw.topPercent)) return null;
  if (raw.topPercent !== EXPECTED_TOP_PERCENT[anchorKey]) return null;
  if (typeof raw.score !== "number" || !Number.isFinite(raw.score) || raw.score < 0) {
    return null;
  }
  const expectedNative = KEY_TO_NATIVE[anchorKey];
  const nativeQuantile =
    typeof raw.nativeQuantile === "string"
      ? (raw.nativeQuantile as NativeCutoffQuantile)
      : expectedNative;
  if (nativeQuantile !== expectedNative) return null;

  const quantilePopulationCount =
    raw.quantilePopulationCount === null
      ? null
      : typeof raw.quantilePopulationCount === "number" &&
          Number.isFinite(raw.quantilePopulationCount) &&
          raw.quantilePopulationCount >= 0
        ? raw.quantilePopulationCount
        : null;
  if (
    raw.quantilePopulationCount !== null &&
    raw.quantilePopulationCount !== undefined &&
    quantilePopulationCount === null
  ) {
    return null;
  }
  const totalPopulationCount =
    raw.totalPopulationCount === null
      ? null
      : typeof raw.totalPopulationCount === "number" &&
          Number.isFinite(raw.totalPopulationCount) &&
          raw.totalPopulationCount >= 0
        ? raw.totalPopulationCount
        : null;
  if (
    raw.totalPopulationCount !== null &&
    raw.totalPopulationCount !== undefined &&
    totalPopulationCount === null
  ) {
    return null;
  }
  // Require explicit null (not undefined) for population fields when present in store.
  if (!("quantilePopulationCount" in raw) || !("totalPopulationCount" in raw)) {
    return null;
  }
  return {
    key: anchorKey,
    topPercent: raw.topPercent,
    nativeQuantile,
    score: raw.score,
    quantilePopulationCount:
      raw.quantilePopulationCount === null ? null : quantilePopulationCount,
    totalPopulationCount: raw.totalPopulationCount === null ? null : totalPopulationCount,
  };
}

/**
 * Validate a SeasonPopulationPolicy document (v2). For raw v1, use upgrade first.
 */
export function parseSeasonPopulationPolicy(raw: unknown): SeasonPopulationPolicy | null {
  if (!isPlainObject(raw)) return null;
  if (raw.version === SEASON_POPULATION_POLICY_VERSION_V1) {
    return upgradeSeasonPopulationPolicyV1ToV2(raw);
  }
  if (raw.version !== SEASON_POPULATION_POLICY_VERSION) return null;
  if (raw.source !== "RAIDER_IO_SEASON_CUTOFFS") return null;
  if (typeof raw.region !== "string" || !raw.region.trim()) return null;
  if (typeof raw.seasonSlug !== "string" || !raw.seasonSlug.trim()) return null;
  if (!(raw.sourceUpdatedAt === null || typeof raw.sourceUpdatedAt === "string")) return null;
  if (typeof raw.quality !== "string" || !QUALITIES.has(raw.quality as SeasonPopulationPolicyQuality)) {
    return null;
  }
  if (!Array.isArray(raw.anchors)) return null;

  const anchors: SeasonPopulationAnchor[] = [];
  const seenKeys = new Set<string>();
  for (const item of raw.anchors) {
    const anchor = parseAnchor(item);
    if (!anchor) return null;
    if (seenKeys.has(anchor.key)) return null;
    seenKeys.add(anchor.key);
    anchors.push(anchor);
  }

  const quality = raw.quality as SeasonPopulationPolicyQuality;
  if (!qualityMatchesAnchorCount(quality, anchors.length)) return null;
  if (anchors.length >= 2 && !isMonotonicPopulationAnchors(anchors)) return null;

  // Require strongest→weakest storage order.
  for (let i = 1; i < anchors.length; i += 1) {
    if (anchors[i]!.topPercent < anchors[i - 1]!.topPercent) return null;
  }

  return {
    version: SEASON_POPULATION_POLICY_VERSION,
    source: "RAIDER_IO_SEASON_CUTOFFS",
    region: raw.region,
    seasonSlug: raw.seasonSlug,
    sourceUpdatedAt: raw.sourceUpdatedAt,
    anchors,
    quality,
  };
}

/**
 * SHA-256 of scoring-relevant policy content only (not sync/provenance timestamps).
 * Anchor array order is normalized strongest→weakest before hashing.
 */
export function hashSeasonPopulationPolicyContent(policy: SeasonPopulationPolicy): string {
  const anchors = [...policy.anchors].sort((a, b) => {
    if (a.topPercent !== b.topPercent) return a.topPercent - b.topPercent;
    return a.key.localeCompare(b.key);
  });
  return stableSha256({
    version: policy.version,
    source: policy.source,
    region: policy.region,
    seasonSlug: policy.seasonSlug,
    sourceUpdatedAt: policy.sourceUpdatedAt,
    anchors: anchors.map((a) => ({
      key: a.key,
      topPercent: a.topPercent,
      nativeQuantile: a.nativeQuantile,
      score: a.score,
      quantilePopulationCount: a.quantilePopulationCount,
      totalPopulationCount: a.totalPopulationCount,
    })),
    quality: policy.quality,
  });
}

/** Hash used by store-v1 documents (no nativeQuantile; policy version v1). */
export function hashSeasonPopulationPolicyContentV1(policyLike: {
  version: string;
  source: string;
  region: string;
  seasonSlug: string;
  sourceUpdatedAt: string | null;
  anchors: Array<{
    key: string;
    topPercent: number;
    score: number;
    quantilePopulationCount: number | null;
    totalPopulationCount: number | null;
  }>;
  quality: string;
}): string {
  const anchors = [...policyLike.anchors].sort((a, b) => {
    if (a.topPercent !== b.topPercent) return a.topPercent - b.topPercent;
    return a.key.localeCompare(b.key);
  });
  return stableSha256({
    version: policyLike.version,
    source: policyLike.source,
    region: policyLike.region,
    seasonSlug: policyLike.seasonSlug,
    sourceUpdatedAt: policyLike.sourceUpdatedAt,
    anchors: anchors.map((a) => ({
      key: a.key,
      topPercent: a.topPercent,
      score: a.score,
      quantilePopulationCount: a.quantilePopulationCount,
      totalPopulationCount: a.totalPopulationCount,
    })),
    quality: policyLike.quality,
  });
}

function verifyStoredPolicyHash(
  rawPolicy: unknown,
  storedHash: string,
  upgraded: SeasonPopulationPolicy,
): boolean {
  const normalized = storedHash.toLowerCase();
  if (!isPlainObject(rawPolicy)) return false;

  if (rawPolicy.version === SEASON_POPULATION_POLICY_VERSION) {
    return hashSeasonPopulationPolicyContent(upgraded).toLowerCase() === normalized;
  }

  if (rawPolicy.version === SEASON_POPULATION_POLICY_VERSION_V1) {
    // Integrity check against the original v1 content hash (provider-free upgrade).
    if (!Array.isArray(rawPolicy.anchors)) return false;
    const v1Anchors: Array<{
      key: string;
      topPercent: number;
      score: number;
      quantilePopulationCount: number | null;
      totalPopulationCount: number | null;
    }> = [];
    for (const item of rawPolicy.anchors) {
      if (!isPlainObject(item)) return false;
      if (typeof item.key !== "string") return false;
      if (typeof item.topPercent !== "number") return false;
      if (typeof item.score !== "number") return false;
      v1Anchors.push({
        key: item.key,
        topPercent: item.topPercent,
        score: item.score,
        quantilePopulationCount:
          item.quantilePopulationCount === null ||
          typeof item.quantilePopulationCount === "number"
            ? (item.quantilePopulationCount as number | null)
            : null,
        totalPopulationCount:
          item.totalPopulationCount === null || typeof item.totalPopulationCount === "number"
            ? (item.totalPopulationCount as number | null)
            : null,
      });
    }
    const v1Hash = hashSeasonPopulationPolicyContentV1({
      version: SEASON_POPULATION_POLICY_VERSION_V1,
      source: String(rawPolicy.source),
      region: String(rawPolicy.region),
      seasonSlug: String(rawPolicy.seasonSlug),
      sourceUpdatedAt:
        rawPolicy.sourceUpdatedAt === null ? null : String(rawPolicy.sourceUpdatedAt),
      anchors: v1Anchors,
      quality: String(rawPolicy.quality),
    });
    return v1Hash.toLowerCase() === normalized;
  }

  return false;
}

/**
 * Read typed Experience population-policy metadata from Season.metadata.
 * Accepts store-v2 natively and store-v1 via provider-free policy upgrade.
 * Fail closed on wrong schema / malformed policy; never throws for legacy JSON.
 */
export function readExperiencePopulationPolicyMetadata(
  metadata: unknown,
): PersistedExperiencePopulationPolicyMetadata | null {
  if (!isPlainObject(metadata)) return null;
  const raw = metadata[EXPERIENCE_POPULATION_POLICY_METADATA_KEY];
  if (!isPlainObject(raw)) return null;

  const schemaOk =
    raw.schemaVersion === EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION ||
    raw.schemaVersion === EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION_V1;
  if (!schemaOk) return null;
  if (raw.lastKnownGood !== true) return null;
  if (typeof raw.raiderIoSeasonSlug !== "string" || !raw.raiderIoSeasonSlug.trim()) return null;
  if (typeof raw.policyContentHash !== "string" || !/^[a-f0-9]{64}$/i.test(raw.policyContentHash)) {
    return null;
  }
  if (typeof raw.sourceRequestFingerprint !== "string" || !raw.sourceRequestFingerprint) {
    return null;
  }
  if (!(raw.sourcePayloadId === null || typeof raw.sourcePayloadId === "string")) return null;
  if (typeof raw.sourceFetchedAt !== "string" || !raw.sourceFetchedAt) return null;
  if (typeof raw.synchronizedAt !== "string" || !raw.synchronizedAt) return null;

  const policy = parseSeasonPopulationPolicy(raw.policy);
  if (!policy) return null;

  if (!verifyStoredPolicyHash(raw.policy, raw.policyContentHash, policy)) return null;

  // Only COMPLETE/PARTIAL policies are Last Known Good store documents.
  if (policy.quality === "INSUFFICIENT") return null;

  return {
    schemaVersion: EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION,
    policy,
    raiderIoSeasonSlug: raw.raiderIoSeasonSlug,
    // Return the v2 content hash so callers hashing upgraded policy match.
    policyContentHash: hashSeasonPopulationPolicyContent(policy).toLowerCase(),
    sourceRequestFingerprint: raw.sourceRequestFingerprint,
    sourcePayloadId: raw.sourcePayloadId,
    sourceFetchedAt: raw.sourceFetchedAt,
    synchronizedAt: raw.synchronizedAt,
    lastKnownGood: true,
  };
}

/**
 * Merge Experience population-policy metadata into Season.metadata.
 * Overwrites only experiencePopulationPolicy; preserves every unrelated root key.
 */
export function mergeExperiencePopulationPolicyMetadata(
  existingMetadata: unknown,
  populationPolicyMetadata: PersistedExperiencePopulationPolicyMetadata,
): Record<string, unknown> {
  const base =
    existingMetadata && isPlainObject(existingMetadata)
      ? { ...existingMetadata }
      : {};
  return {
    ...base,
    [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: populationPolicyMetadata,
  };
}
