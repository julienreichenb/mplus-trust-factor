import { EXPERIENCE_V3_FORMULA_VERSION } from "@mplus/contracts";
import { clamp, clamp01 } from "../math.js";
import type {
  ComputeExperienceInput,
  ComputeExperienceResult,
  ExperienceCharacterHistory,
  ExperienceSeasonFact,
} from "./types.js";

/** Verified / public Experience internal weights (Agent 25 baseline). */
export const EXPERIENCE_CURRENT_PEAK_WEIGHT = 0.45;
export const EXPERIENCE_CURRENT_BREADTH_WEIGHT = 0.25;
export const EXPERIENCE_HISTORICAL_PEAK_WEIGHT = 0.2;
export const EXPERIENCE_LONGEVITY_WEIGHT = 0.1;

/**
 * Age decay: each season ago multiplies historical peak by this factor.
 * Exceptional old peaks retain at least AGE_DECAY_FLOOR of their season-normalized value.
 */
export const AGE_DECAY_PER_SEASON = 0.85;
export const AGE_DECAY_FLOOR = 0.35;

/** Default seasons of meaningful activity that map longevity toward 100. */
export const DEFAULT_LONGEVITY_TARGET_SEASONS = 6;

/** Metric keys for Agent 27 `default@3` EXPERIENCE composition. */
export const EXPERIENCE_V3_METRIC_KEYS = {
  currentPeak: "experience.current_peak",
  currentBreadth: "experience.current_breadth",
  historicalPeak: "experience.historical_peak",
  longevity: "experience.longevity",
} as const;

/**
 * Cutoff-relative season normalization (0–100).
 * Maps raw score against documented top-25% cutoff (p750 ≈ 0.75 quantile).
 * Never compare raw Legion-era and current ratings directly.
 */
export function normalizeScoreAgainstTop25Cutoff(
  rawScore: number,
  top25CutoffScore: number,
): number | null {
  if (!(rawScore >= 0) || !(top25CutoffScore > 0)) return null;
  const approxCeiling = top25CutoffScore / 0.75;
  return clamp((rawScore / approxCeiling) * 100);
}

/**
 * Bounded age decay with a non-zero floor so exceptional old achievements retain value.
 * decayed = seasonNormalized × max(FLOOR, DECAY^seasonsAgo)
 */
export function applyAgeDecay(seasonNormalizedScore: number, seasonsAgo: number): number {
  if (!(seasonNormalizedScore >= 0) || !Number.isFinite(seasonNormalizedScore)) {
    return 0;
  }
  if (seasonsAgo <= 0) return clamp(seasonNormalizedScore);
  const decayed = Math.pow(AGE_DECAY_PER_SEASON, seasonsAgo);
  const multiplier = Math.max(AGE_DECAY_FLOOR, decayed);
  return clamp(seasonNormalizedScore * multiplier);
}

/**
 * Current-season breadth with diminishing returns on each additional dungeon.
 * credit(i) = 1/√i for the i-th dungeon; ratio vs full expected dungeon set.
 */
export function computeBreadthWithDiminishingReturns(
  dungeonCount: number,
  expectedDungeonCount: number,
): number | null {
  if (!(expectedDungeonCount > 0)) return null;
  const present = Math.max(0, Math.min(Math.floor(dungeonCount), expectedDungeonCount));
  if (present === 0 && dungeonCount <= 0) return null;

  let earned = 0;
  for (let i = 1; i <= present; i++) earned += 1 / Math.sqrt(i);
  let full = 0;
  for (let i = 1; i <= expectedDungeonCount; i++) full += 1 / Math.sqrt(i);
  if (full <= 0) return null;
  return clamp((earned / full) * 100);
}

/**
 * Longevity: share of active seasons toward a target (capped at 100).
 */
export function computeLongevityScore(
  activeSeasonCount: number,
  targetSeasons: number = DEFAULT_LONGEVITY_TARGET_SEASONS,
): number | null {
  if (!(targetSeasons > 0)) return null;
  if (!(activeSeasonCount > 0)) return null;
  return clamp((activeSeasonCount / targetSeasons) * 100);
}

function selectCharacters(input: ComputeExperienceInput): {
  characters: ExperienceCharacterHistory[];
  mode: "CHARACTER_HISTORY" | "VERIFIED_ACCOUNT_HISTORY";
  linkageSource: ComputeExperienceInput["linkageSource"];
} {
  const verified = input.characters.filter((c) => c.verified);
  if (input.accountLinkageVerified && verified.length > 0) {
    return {
      characters: verified,
      mode: "VERIFIED_ACCOUNT_HISTORY",
      linkageSource: input.linkageSource ?? "USER_CLAIM",
    };
  }
  // Public character-only: first character, never invent an account graph.
  const primary = input.characters[0] ? [input.characters[0]] : [];
  return {
    characters: primary,
    mode: "CHARACTER_HISTORY",
    linkageSource: "NONE",
  };
}

function currentSeasonFacts(characters: ExperienceCharacterHistory[]): ExperienceSeasonFact[] {
  return characters.flatMap((c) => c.seasons.filter((s) => s.seasonsAgo === 0));
}

function historicalSeasonRows(
  characters: ExperienceCharacterHistory[],
): Array<ExperienceSeasonFact & { characterKey: string }> {
  return characters.flatMap((c) =>
    c.seasons
      .filter((s) => s.seasonsAgo > 0)
      .map((s) => ({ ...s, characterKey: c.characterKey })),
  );
}

/** Max season-normalized score among current-season facts (account peak in verified mode). */
export function computeCurrentPeak(facts: ExperienceSeasonFact[]): number | null {
  const scores = facts
    .map((f) => f.seasonNormalizedScore)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (scores.length === 0) return null;
  return clamp(Math.max(...scores));
}

/** Union breadth across characters for current season (verified) or single character. */
export function computeCurrentBreadth(
  facts: ExperienceSeasonFact[],
  expectedDungeonCount: number,
): number | null {
  const counts = facts
    .map((f) => f.dungeonCount)
    .filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
  if (counts.length === 0) return null;
  // Verified account: take the max single-character breadth proxy (union of dungeons
  // is not reliably available without per-dungeon ids). Prefer sum capped at expected
  // only when facts carry disjoint character keys — here max is the honest public bound.
  const dungeonCount = Math.max(...counts);
  return computeBreadthWithDiminishingReturns(dungeonCount, expectedDungeonCount);
}

/**
 * Historical peak: max age-decayed season-normalized score across prior seasons.
 * Raw cross-expansion scores are never compared.
 */
export function computeHistoricalPeak(
  rows: Array<ExperienceSeasonFact & { characterKey?: string }>,
): { score: number | null; best: (ExperienceSeasonFact & { decayedScore: number }) | null } {
  let best: (ExperienceSeasonFact & { decayedScore: number }) | null = null;
  for (const row of rows) {
    if (row.seasonNormalizedScore == null || !Number.isFinite(row.seasonNormalizedScore)) {
      continue;
    }
    const decayedScore = applyAgeDecay(row.seasonNormalizedScore, row.seasonsAgo);
    if (!best || decayedScore > best.decayedScore) {
      best = { ...row, decayedScore };
    }
  }
  return { score: best?.decayedScore ?? null, best };
}

function uniqueActiveSeasonCount(characters: ExperienceCharacterHistory[]): number {
  const slugs = new Set<string>();
  for (const c of characters) {
    for (const s of c.seasons) {
      if (s.active || (s.rawScore != null && s.rawScore > 0) || (s.dungeonCount ?? 0) > 0) {
        slugs.add(s.seasonSlug);
      }
    }
  }
  return slugs.size;
}

function renormalizeWeights(available: {
  currentPeak: boolean;
  currentBreadth: boolean;
  historicalPeak: boolean;
  longevity: boolean;
}): ComputeExperienceResult["effectiveWeights"] {
  const base = {
    currentPeak: available.currentPeak ? EXPERIENCE_CURRENT_PEAK_WEIGHT : 0,
    currentBreadth: available.currentBreadth ? EXPERIENCE_CURRENT_BREADTH_WEIGHT : 0,
    historicalPeak: available.historicalPeak ? EXPERIENCE_HISTORICAL_PEAK_WEIGHT : 0,
    longevity: available.longevity ? EXPERIENCE_LONGEVITY_WEIGHT : 0,
  };
  const sum = base.currentPeak + base.currentBreadth + base.historicalPeak + base.longevity;
  if (sum <= 0) {
    return { currentPeak: 0, currentBreadth: 0, historicalPeak: 0, longevity: 0 };
  }
  return {
    currentPeak: base.currentPeak / sum,
    currentBreadth: base.currentBreadth / sum,
    historicalPeak: base.historicalPeak / sum,
    longevity: base.longevity / sum,
  };
}

/**
 * Experience confidence: coverage of contributors + season normalization quality + mode honesty.
 * Missing account graph does not reduce character-mode confidence.
 */
export function computeExperienceConfidence(input: {
  contributorCount: number;
  expectedContributors: number;
  seasonsWithNormalizedScores: number;
  seasonsConsidered: number;
  mode: "CHARACTER_HISTORY" | "VERIFIED_ACCOUNT_HISTORY";
  crawlFresh?: number;
}): number {
  if (input.contributorCount === 0) return 0;
  const coverage = clamp01(input.contributorCount / Math.max(1, input.expectedContributors));
  const normQuality =
    input.seasonsConsidered > 0
      ? clamp01(input.seasonsWithNormalizedScores / input.seasonsConsidered)
      : 0;
  const freshness = input.crawlFresh ?? 0.7;
  const modeFactor = input.mode === "VERIFIED_ACCOUNT_HISTORY" ? 1 : 0.92;
  return clamp01(0.5 * coverage + 0.35 * normQuality + 0.15 * freshness) * modeFactor;
}

/**
 * Experience v3 dimension aggregate.
 * Public lookups stay CHARACTER_HISTORY. Verified account mode requires explicit linkage.
 */
export function computeExperienceDimension(
  input: ComputeExperienceInput,
): ComputeExperienceResult {
  const { characters, mode, linkageSource } = selectCharacters(input);
  const missingMetrics: string[] = [];
  const accountGraphAvailable =
    mode === "VERIFIED_ACCOUNT_HISTORY" && characters.some((c) => c.verified);

  if (!accountGraphAvailable) {
    missingMetrics.push("account_linked_alts");
  }

  const currentFacts = currentSeasonFacts(characters);
  const historicalRows = historicalSeasonRows(characters);
  const currentPeak = computeCurrentPeak(currentFacts);
  const currentBreadth = computeCurrentBreadth(currentFacts, input.expectedDungeonCount);
  const historical = computeHistoricalPeak(historicalRows);
  const activeSeasonCount = uniqueActiveSeasonCount(characters);
  const longevity = computeLongevityScore(
    activeSeasonCount,
    input.longevityTargetSeasons ?? DEFAULT_LONGEVITY_TARGET_SEASONS,
  );

  if (currentPeak == null) missingMetrics.push("experience.current_peak");
  if (currentBreadth == null) missingMetrics.push("experience.current_breadth");
  if (historical.score == null) missingMetrics.push("experience.historical_peak");
  if (longevity == null) missingMetrics.push("experience.longevity");

  const weights = renormalizeWeights({
    currentPeak: currentPeak != null,
    currentBreadth: currentBreadth != null,
    historicalPeak: historical.score != null,
    longevity: longevity != null,
  });

  let experienceScore: number | null = null;
  const hasAny =
    currentPeak != null ||
    currentBreadth != null ||
    historical.score != null ||
    longevity != null;
  if (hasAny) {
    experienceScore = clamp(
      (currentPeak ?? 0) * weights.currentPeak +
        (currentBreadth ?? 0) * weights.currentBreadth +
        (historical.score ?? 0) * weights.historicalPeak +
        (longevity ?? 0) * weights.longevity,
    );
  }

  const allSeasons = characters.flatMap((c) => c.seasons);
  const seasonsWithNormalizedScores = allSeasons.filter(
    (s) => s.seasonNormalizedScore != null,
  ).length;
  const contributorCount = [
    currentPeak,
    currentBreadth,
    historical.score,
    longevity,
  ].filter((v) => v != null).length;

  const confidence = computeExperienceConfidence({
    contributorCount,
    expectedContributors: 4,
    seasonsWithNormalizedScores,
    seasonsConsidered: allSeasons.length,
    mode,
  });

  const seasonsUsed = characters.flatMap((c) =>
    c.seasons.map((s) => ({
      seasonSlug: s.seasonSlug,
      seasonsAgo: s.seasonsAgo,
      seasonNormalizedScore: s.seasonNormalizedScore,
      decayedScore:
        s.seasonNormalizedScore != null
          ? applyAgeDecay(s.seasonNormalizedScore, s.seasonsAgo)
          : null,
      active: s.active,
      characterKey: c.characterKey,
    })),
  );

  const summary: ComputeExperienceResult["summary"] = {
    mode,
    linkageSource: linkageSource ?? "NONE",
    label: mode,
    currentPeak,
    currentBreadth,
    historicalPeak: historical.score,
    longevity,
    score: experienceScore,
    confidence,
    formulaVersion: EXPERIENCE_V3_FORMULA_VERSION,
    contributors: {
      currentPeakWeight: EXPERIENCE_CURRENT_PEAK_WEIGHT,
      currentBreadthWeight: EXPERIENCE_CURRENT_BREADTH_WEIGHT,
      historicalPeakWeight: EXPERIENCE_HISTORICAL_PEAK_WEIGHT,
      longevityWeight: EXPERIENCE_LONGEVITY_WEIGHT,
    },
    seasonsUsed,
    accountGraph: {
      availability: accountGraphAvailable ? "AVAILABLE" : "BLOCKED",
      reason: accountGraphAvailable
        ? "Explicit verified character linkage"
        : "Public providers do not expose a reliable account-wide alt graph; requires user-authorized Blizzard OAuth or explicit claims",
      verifiedCharacterCount: accountGraphAvailable ? characters.length : 0,
    },
    missingMetrics,
  };

  return {
    summary,
    experienceScore,
    confidence,
    observations: {
      currentPeak,
      currentBreadth,
      historicalPeak: historical.score,
      longevity,
    },
    effectiveWeights: weights,
  };
}

/** Recommended `default@3` EXPERIENCE metric weights for Agent 27 (do not seed here). */
export function resolveExperienceV3MetricWeights(): Array<{ metricKey: string; weight: number }> {
  return [
    { metricKey: EXPERIENCE_V3_METRIC_KEYS.currentPeak, weight: EXPERIENCE_CURRENT_PEAK_WEIGHT },
    {
      metricKey: EXPERIENCE_V3_METRIC_KEYS.currentBreadth,
      weight: EXPERIENCE_CURRENT_BREADTH_WEIGHT,
    },
    {
      metricKey: EXPERIENCE_V3_METRIC_KEYS.historicalPeak,
      weight: EXPERIENCE_HISTORICAL_PEAK_WEIGHT,
    },
    { metricKey: EXPERIENCE_V3_METRIC_KEYS.longevity, weight: EXPERIENCE_LONGEVITY_WEIGHT },
  ];
}
