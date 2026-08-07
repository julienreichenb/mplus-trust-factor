/**
 * Experience Phase 1 — Season.metadata persistence for SeasonPopulationPolicy.
 * Owns only the experiencePopulationPolicy namespace. Not wired into scoring.
 */

import {
  isMonotonicPopulationAnchors,
  SEASON_POPULATION_POLICY_VERSION,
  stableSha256,
  type SeasonPopulationAnchor,
  type SeasonPopulationAnchorKey,
  type SeasonPopulationPolicy,
  type SeasonPopulationPolicyQuality,
} from "@mplus/scoring";

export const EXPERIENCE_POPULATION_POLICY_METADATA_KEY = "experiencePopulationPolicy" as const;

export const EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION =
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
    score: raw.score,
    quantilePopulationCount:
      raw.quantilePopulationCount === null ? null : quantilePopulationCount,
    totalPopulationCount: raw.totalPopulationCount === null ? null : totalPopulationCount,
  };
}

/**
 * Validate a SeasonPopulationPolicy document using Agent 05 semantics (no second algorithm).
 */
export function parseSeasonPopulationPolicy(raw: unknown): SeasonPopulationPolicy | null {
  if (!isPlainObject(raw)) return null;
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
      score: a.score,
      quantilePopulationCount: a.quantilePopulationCount,
      totalPopulationCount: a.totalPopulationCount,
    })),
    quality: policy.quality,
  });
}

/**
 * Read typed Experience population-policy metadata from Season.metadata.
 * Fail closed on wrong schema / malformed policy; never throws for legacy JSON.
 */
export function readExperiencePopulationPolicyMetadata(
  metadata: unknown,
): PersistedExperiencePopulationPolicyMetadata | null {
  if (!isPlainObject(metadata)) return null;
  const raw = metadata[EXPERIENCE_POPULATION_POLICY_METADATA_KEY];
  if (!isPlainObject(raw)) return null;
  if (raw.schemaVersion !== EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION) return null;
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

  // Reject documents whose stored hash does not match policy content.
  const expectedHash = hashSeasonPopulationPolicyContent(policy);
  if (expectedHash.toLowerCase() !== raw.policyContentHash.toLowerCase()) return null;

  // Only COMPLETE/PARTIAL policies are Last Known Good store documents.
  if (policy.quality === "INSUFFICIENT") return null;

  return {
    schemaVersion: EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION,
    policy,
    raiderIoSeasonSlug: raw.raiderIoSeasonSlug,
    policyContentHash: raw.policyContentHash.toLowerCase(),
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
