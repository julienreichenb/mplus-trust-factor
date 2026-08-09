/**
 * Experience Phase 1 — season population policy + native Raider.IO band standing.
 *
 * Provider-free pure logic. Converts regional Mythic+ cutoff anchors into a
 * SeasonPopulationPolicy and classifies previous-season standing into discrete
 * native Raider.IO bands (no percentile interpolation).
 */

import type { RaiderIoCutoffQuantile, RaiderIoCutoffThreshold, RaiderIoSeasonCutoffs, RegionCode } from "@mplus/contracts";

/** Native-band population policy (Agent 04). */
export const SEASON_POPULATION_POLICY_VERSION = "season-population-policy-v2" as const;

/** Legacy interpolated policy version — readable for provider-free upgrade only. */
export const SEASON_POPULATION_POLICY_VERSION_V1 = "season-population-policy-v1" as const;

export type SeasonPopulationAnchorKey =
  | "top_0_1_percent"
  | "top_1_percent"
  | "top_10_percent"
  | "top_25_percent"
  | "top_40_percent";

export type NativeCutoffQuantile = "p999" | "p990" | "p900" | "p750" | "p600";

export type NativeCutoffBand = NativeCutoffQuantile | "below_p600";

export interface SeasonPopulationAnchor {
  key: SeasonPopulationAnchorKey;
  /**
   * Percentage of the population at or above this rating (lower is better).
   * Diagnostic only under v2 — scoring uses nativeQuantile bands.
   */
  topPercent: number;
  /** Provider-native Raider.IO quantile identity. */
  nativeQuantile: NativeCutoffQuantile;
  score: number;
  quantilePopulationCount: number | null;
  totalPopulationCount: number | null;
}

export type SeasonPopulationPolicyQuality = "COMPLETE" | "PARTIAL" | "INSUFFICIENT";

export interface SeasonPopulationPolicy {
  version: typeof SEASON_POPULATION_POLICY_VERSION;
  source: "RAIDER_IO_SEASON_CUTOFFS";
  region: RegionCode;
  seasonSlug: string;
  sourceUpdatedAt: string | null;
  anchors: SeasonPopulationAnchor[];
  quality: SeasonPopulationPolicyQuality;
}

/** Legacy band labels retained for diagnostics compatibility. */
export type PreviousSeasonStandingBand =
  | "TOP_0_1_OR_BETTER"
  | "TOP_1"
  | "TOP_10"
  | "TOP_25"
  | "TOP_40"
  | "BELOW_TOP_40"
  | "BELOW_SUPPORTED_RANGE";

export type PreviousSeasonStandingMethod = "NATIVE_BAND";

export interface PreviousSeasonRelativeStanding {
  rating: number;
  /** Discrete native Raider.IO band used for scoring. */
  nativeBand: NativeCutoffBand;
  /** Discrete Experience standing score for the native band (no interpolation). */
  standingScore: number;
  /** Legacy band label derived from nativeBand. */
  band: PreviousSeasonStandingBand;
  /**
   * Always null under native-band scoring (no interpolated percentile).
   * Retained for backward-compatible field presence.
   */
  estimatedTopPercent: null;
  method: PreviousSeasonStandingMethod;
  /** Inclusive lower threshold anchor when applicable. */
  betterAnchor: SeasonPopulationAnchor | null;
  /** Exclusive upper threshold anchor when applicable. */
  worseAnchor: SeasonPopulationAnchor | null;
  /** Thresholds consulted to prove this band. */
  thresholdsUsed: Array<{ quantile: NativeCutoffQuantile; score: number }>;
  policyVersion: string;
  region: RegionCode;
  seasonSlug: string;
}

export type BuildSeasonPopulationPolicyResult =
  | { ok: true; policy: SeasonPopulationPolicy }
  | {
      ok: false;
      reason: "NON_MONOTONIC_THRESHOLDS" | "MISSING_SEASON_SLUG";
    };

export type StandingEstimationResult =
  | { ok: true; standing: PreviousSeasonRelativeStanding }
  | {
      ok: false;
      reason:
        | "INSUFFICIENT_POLICY"
        | "INVALID_RATING"
        | "NON_MONOTONIC_POLICY"
        | "AMBIGUOUS_PARTIAL_POLICY"
        | "INCOMPATIBLE_POLICY_VERSION";
    };

/** Explicit cutoff → native quantile map (do not invent percentiles). */
export const NATIVE_CUTOFF_SPECS = [
  {
    field: "top0_1Percent" as const,
    key: "top_0_1_percent" as const,
    topPercent: 0.1,
    nativeQuantile: "p999" as const,
    standingScore: 100,
  },
  {
    field: "top1Percent" as const,
    key: "top_1_percent" as const,
    topPercent: 1,
    nativeQuantile: "p990" as const,
    standingScore: 90,
  },
  {
    field: "top10Percent" as const,
    key: "top_10_percent" as const,
    topPercent: 10,
    nativeQuantile: "p900" as const,
    standingScore: 75,
  },
  {
    field: "top25Percent" as const,
    key: "top_25_percent" as const,
    topPercent: 25,
    nativeQuantile: "p750" as const,
    standingScore: 60,
  },
  {
    field: "top40Percent" as const,
    key: "top_40_percent" as const,
    topPercent: 40,
    nativeQuantile: "p600" as const,
    standingScore: 45,
  },
] as const;

export const NATIVE_BAND_STANDING_SCORES = {
  p999: 100,
  p990: 90,
  p900: 75,
  p750: 60,
  p600: 45,
  below_p600: 25,
} as const;

export const EXPERIENCE_PHASE1_BELOW_P600_SCORE = NATIVE_BAND_STANDING_SCORES.below_p600;

const KEY_TO_NATIVE: Record<SeasonPopulationAnchorKey, NativeCutoffQuantile> = {
  top_0_1_percent: "p999",
  top_1_percent: "p990",
  top_10_percent: "p900",
  top_25_percent: "p750",
  top_40_percent: "p600",
};

const EXPECTED_TOP_PERCENT: Record<SeasonPopulationAnchorKey, number> = {
  top_0_1_percent: 0.1,
  top_1_percent: 1,
  top_10_percent: 10,
  top_25_percent: 25,
  top_40_percent: 40,
};

function isUsableScore(score: number): boolean {
  return Number.isFinite(score) && score >= 0;
}

function populationCountOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function thresholdToAnchor(
  threshold: RaiderIoCutoffThreshold | null,
  key: SeasonPopulationAnchorKey,
  topPercent: number,
  nativeQuantile: NativeCutoffQuantile,
): SeasonPopulationAnchor | null {
  if (!threshold || !isUsableScore(threshold.score)) return null;
  return {
    key,
    topPercent,
    nativeQuantile,
    score: threshold.score,
    quantilePopulationCount: populationCountOrNull(threshold.quantilePopulationCount),
    totalPopulationCount: populationCountOrNull(threshold.totalPopulationCount),
  };
}

function compareAnchorsStrongestFirst(a: SeasonPopulationAnchor, b: SeasonPopulationAnchor): number {
  if (a.topPercent !== b.topPercent) return a.topPercent - b.topPercent;
  return a.key.localeCompare(b.key);
}

/**
 * Higher Mythic+ score is stronger. Among present anchors (strongest→weakest),
 * each next score must be ≤ previous score (equality allowed).
 */
export function isMonotonicPopulationAnchors(anchors: readonly SeasonPopulationAnchor[]): boolean {
  const ordered = [...anchors].sort(compareAnchorsStrongestFirst);
  for (let i = 1; i < ordered.length; i += 1) {
    const stronger = ordered[i - 1]!;
    const weaker = ordered[i]!;
    if (weaker.score > stronger.score) return false;
  }
  return true;
}

function qualityFromAnchorCount(count: number): SeasonPopulationPolicyQuality {
  if (count >= 5) return "COMPLETE";
  if (count >= 2) return "PARTIAL";
  return "INSUFFICIENT";
}

function bandLabelFromNative(nativeBand: NativeCutoffBand): PreviousSeasonStandingBand {
  switch (nativeBand) {
    case "p999":
      return "TOP_0_1_OR_BETTER";
    case "p990":
      return "TOP_1";
    case "p900":
      return "TOP_10";
    case "p750":
      return "TOP_25";
    case "p600":
      return "TOP_40";
    case "below_p600":
      return "BELOW_TOP_40";
  }
}

/**
 * Build a deterministic SeasonPopulationPolicy from normalized Raider.IO season cutoffs.
 * Does not invent missing anchors. Rejects non-monotonic threshold evidence.
 */
export function buildSeasonPopulationPolicy(
  cutoffs: RaiderIoSeasonCutoffs,
  options?: { seasonSlug?: string },
): BuildSeasonPopulationPolicyResult {
  const seasonSlug = (options?.seasonSlug ?? cutoffs.seasonSlug ?? "").trim();
  if (!seasonSlug) {
    return { ok: false, reason: "MISSING_SEASON_SLUG" };
  }

  const anchors: SeasonPopulationAnchor[] = [];
  for (const spec of NATIVE_CUTOFF_SPECS) {
    const anchor = thresholdToAnchor(
      cutoffs[spec.field],
      spec.key,
      spec.topPercent,
      spec.nativeQuantile,
    );
    if (anchor) anchors.push(anchor);
  }
  anchors.sort(compareAnchorsStrongestFirst);

  if (anchors.length >= 2 && !isMonotonicPopulationAnchors(anchors)) {
    return { ok: false, reason: "NON_MONOTONIC_THRESHOLDS" };
  }

  return {
    ok: true,
    policy: {
      version: SEASON_POPULATION_POLICY_VERSION,
      source: "RAIDER_IO_SEASON_CUTOFFS",
      region: cutoffs.region,
      seasonSlug,
      sourceUpdatedAt: cutoffs.updatedAt,
      anchors,
      quality: qualityFromAnchorCount(anchors.length),
    },
  };
}

/**
 * Provider-free upgrade of a v1 interpolated policy whose anchors are the
 * canonical native p999/p990/p900/p750/p600 mappings.
 */
export function upgradeSeasonPopulationPolicyV1ToV2(
  policy: unknown,
): SeasonPopulationPolicy | null {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return null;
  const raw = policy as Record<string, unknown>;
  if (raw.version === SEASON_POPULATION_POLICY_VERSION) {
    return parseSeasonPopulationPolicyV2(raw);
  }
  if (raw.version !== SEASON_POPULATION_POLICY_VERSION_V1) return null;
  if (raw.source !== "RAIDER_IO_SEASON_CUTOFFS") return null;
  if (typeof raw.region !== "string" || !raw.region.trim()) return null;
  if (typeof raw.seasonSlug !== "string" || !raw.seasonSlug.trim()) return null;
  if (!(raw.sourceUpdatedAt === null || typeof raw.sourceUpdatedAt === "string")) return null;
  if (!Array.isArray(raw.anchors)) return null;

  const anchors: SeasonPopulationAnchor[] = [];
  for (const item of raw.anchors) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const key = row.key;
    if (typeof key !== "string" || !(key in KEY_TO_NATIVE)) return null;
    const anchorKey = key as SeasonPopulationAnchorKey;
    if (row.topPercent !== EXPECTED_TOP_PERCENT[anchorKey]) return null;
    if (typeof row.score !== "number" || !isUsableScore(row.score)) return null;
    anchors.push({
      key: anchorKey,
      topPercent: EXPECTED_TOP_PERCENT[anchorKey],
      nativeQuantile: KEY_TO_NATIVE[anchorKey],
      score: row.score,
      quantilePopulationCount: populationCountOrNull(
        row.quantilePopulationCount as number | null | undefined,
      ),
      totalPopulationCount: populationCountOrNull(
        row.totalPopulationCount as number | null | undefined,
      ),
    });
  }
  anchors.sort(compareAnchorsStrongestFirst);
  if (anchors.length >= 2 && !isMonotonicPopulationAnchors(anchors)) return null;

  return {
    version: SEASON_POPULATION_POLICY_VERSION,
    source: "RAIDER_IO_SEASON_CUTOFFS",
    region: raw.region as RegionCode,
    seasonSlug: raw.seasonSlug,
    sourceUpdatedAt: raw.sourceUpdatedAt,
    anchors,
    quality: qualityFromAnchorCount(anchors.length),
  };
}

function parseSeasonPopulationPolicyV2(
  raw: Record<string, unknown>,
): SeasonPopulationPolicy | null {
  if (raw.version !== SEASON_POPULATION_POLICY_VERSION) return null;
  if (raw.source !== "RAIDER_IO_SEASON_CUTOFFS") return null;
  if (typeof raw.region !== "string" || !raw.region.trim()) return null;
  if (typeof raw.seasonSlug !== "string" || !raw.seasonSlug.trim()) return null;
  if (!(raw.sourceUpdatedAt === null || typeof raw.sourceUpdatedAt === "string")) return null;
  if (!Array.isArray(raw.anchors)) return null;
  const anchors: SeasonPopulationAnchor[] = [];
  for (const item of raw.anchors) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const key = row.key;
    if (typeof key !== "string" || !(key in KEY_TO_NATIVE)) return null;
    const anchorKey = key as SeasonPopulationAnchorKey;
    const native =
      typeof row.nativeQuantile === "string" &&
      (Object.values(KEY_TO_NATIVE) as string[]).includes(row.nativeQuantile)
        ? (row.nativeQuantile as NativeCutoffQuantile)
        : KEY_TO_NATIVE[anchorKey];
    if (native !== KEY_TO_NATIVE[anchorKey]) return null;
    if (row.topPercent !== EXPECTED_TOP_PERCENT[anchorKey]) return null;
    if (typeof row.score !== "number" || !isUsableScore(row.score)) return null;
    anchors.push({
      key: anchorKey,
      topPercent: EXPECTED_TOP_PERCENT[anchorKey],
      nativeQuantile: native,
      score: row.score,
      quantilePopulationCount: populationCountOrNull(
        row.quantilePopulationCount as number | null | undefined,
      ),
      totalPopulationCount: populationCountOrNull(
        row.totalPopulationCount as number | null | undefined,
      ),
    });
  }
  anchors.sort(compareAnchorsStrongestFirst);
  if (anchors.length >= 2 && !isMonotonicPopulationAnchors(anchors)) return null;
  return {
    version: SEASON_POPULATION_POLICY_VERSION,
    source: "RAIDER_IO_SEASON_CUTOFFS",
    region: raw.region as RegionCode,
    seasonSlug: raw.seasonSlug,
    sourceUpdatedAt: raw.sourceUpdatedAt,
    anchors,
    quality: qualityFromAnchorCount(anchors.length),
  };
}

/**
 * @deprecated Interpolation removed in Agent 04. Kept only for import compatibility.
 */
export function interpolateTopPercent(
  _rating: number,
  better: SeasonPopulationAnchor,
  _worse: SeasonPopulationAnchor,
): number {
  return better.topPercent;
}

/**
 * Classify previous-season standing into a discrete native Raider.IO band.
 * Partial policies score only when the resulting band is unambiguous.
 */
export function estimatePreviousSeasonStanding(
  rating: number,
  policy: SeasonPopulationPolicy,
): StandingEstimationResult {
  if (!Number.isFinite(rating) || rating < 0) {
    return { ok: false, reason: "INVALID_RATING" };
  }
  if (policy.version !== SEASON_POPULATION_POLICY_VERSION) {
    return { ok: false, reason: "INCOMPATIBLE_POLICY_VERSION" };
  }
  if (policy.anchors.length === 0) {
    return { ok: false, reason: "INSUFFICIENT_POLICY" };
  }
  if (!isMonotonicPopulationAnchors(policy.anchors)) {
    return { ok: false, reason: "NON_MONOTONIC_POLICY" };
  }

  const byQuantile = new Map<NativeCutoffQuantile, SeasonPopulationAnchor>();
  for (const anchor of policy.anchors) {
    byQuantile.set(anchor.nativeQuantile, anchor);
  }

  const order = NATIVE_CUTOFF_SPECS.map((s) => s.nativeQuantile);
  const base = {
    rating,
    estimatedTopPercent: null as null,
    method: "NATIVE_BAND" as const,
    policyVersion: policy.version,
    region: policy.region,
    seasonSlug: policy.seasonSlug,
  };

  const strongestMet = order.find((q) => {
    const anchor = byQuantile.get(q);
    return anchor != null && rating >= anchor.score;
  });

  if (strongestMet === "p999") {
    const anchor = byQuantile.get("p999")!;
    return {
      ok: true,
      standing: {
        ...base,
        nativeBand: "p999",
        standingScore: NATIVE_BAND_STANDING_SCORES.p999,
        band: bandLabelFromNative("p999"),
        betterAnchor: anchor,
        worseAnchor: null,
        thresholdsUsed: [{ quantile: "p999", score: anchor.score }],
      },
    };
  }

  if (strongestMet == null) {
    const p600 = byQuantile.get("p600");
    if (p600 != null && rating < p600.score) {
      return {
        ok: true,
        standing: {
          ...base,
          nativeBand: "below_p600",
          standingScore: NATIVE_BAND_STANDING_SCORES.below_p600,
          band: bandLabelFromNative("below_p600"),
          betterAnchor: null,
          worseAnchor: p600,
          thresholdsUsed: [{ quantile: "p600", score: p600.score }],
        },
      };
    }
    return { ok: false, reason: "AMBIGUOUS_PARTIAL_POLICY" };
  }

  const idx = order.indexOf(strongestMet);
  const stronger = order[idx - 1];
  if (stronger == null) {
    return { ok: false, reason: "AMBIGUOUS_PARTIAL_POLICY" };
  }
  const strongerAnchor = byQuantile.get(stronger);
  const metAnchor = byQuantile.get(strongestMet)!;
  if (strongerAnchor == null) {
    // Missing upper discriminator — cannot separate this band from the stronger one.
    return { ok: false, reason: "AMBIGUOUS_PARTIAL_POLICY" };
  }
  if (!(rating < strongerAnchor.score)) {
    return { ok: false, reason: "AMBIGUOUS_PARTIAL_POLICY" };
  }

  return {
    ok: true,
    standing: {
      ...base,
      nativeBand: strongestMet,
      standingScore: NATIVE_BAND_STANDING_SCORES[strongestMet],
      band: bandLabelFromNative(strongestMet),
      betterAnchor: metAnchor,
      worseAnchor: strongerAnchor,
      thresholdsUsed: [
        { quantile: stronger, score: strongerAnchor.score },
        { quantile: strongestMet, score: metAnchor.score },
      ],
    },
  };
}

/** Re-export quantile type alias for callers that import from contracts shape. */
export type { RaiderIoCutoffQuantile };
