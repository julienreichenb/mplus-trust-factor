import { clamp01 } from "../../math.js";
import {
  EXPERIENCE_KEY_BANDS,
  KEY_BAND_COUNT,
  PRIOR_SEASON_LOCAL_CAP,
  PRIOR_SEASON_RIO_DEPTH,
  RECENCY_DECAY_DAYS,
  RECENCY_FLOOR,
  RECENCY_FULL_DAYS,
  RECENCY_HARD_FLOOR,
  type ExperienceHistoryProvenance,
} from "./constants.js";

export interface ExperienceV2RunInput {
  dungeonSlug: string;
  keyLevel: number;
  completedAt: string;
}

export interface ExperienceV2ComputeInput {
  expectedDungeonCount: number;
  /** One highest-key run per dungeon (selection) — breadth / bands. */
  selectedRuns: ExperienceV2RunInput[];
  /** All current-season pool runs — participation depth (spam-capped). */
  seasonRuns: ExperienceV2RunInput[];
  /**
   * Distinct prior seasons with public character history (no alts).
   * Built from RIO previous ∪ durable local prior seasons.
   */
  priorSeasonCount: number;
  /**
   * Denominator for historical_seasons. Must equal the max count this observation
   * path can produce (RIO-only → 1; local consolidation → up to PRIOR_SEASON_LOCAL_CAP).
   */
  priorSeasonSourceDepth?: number;
  observedAt: string;
  /** How complete / authoritative the history sources were. */
  provenance: ExperienceHistoryProvenance;
}

export interface ExperienceV2Component {
  metricKey: string;
  rawValue: number;
  normalizedValue: number;
  confidence: number;
  coverage: { present: number; expected: number; ratio: number } | null;
  detail: Record<string, unknown>;
}

export interface ExperienceV2Result {
  components: ExperienceV2Component[];
  /** Pre-blend weighted score 0–100 from available components (for calibration). */
  rawScore: number;
  provenance: ExperienceHistoryProvenance;
  evidence: {
    distinctDungeons: number;
    bandsTouched: number;
    seasonRunCount: number;
    priorSeasonCount: number;
    priorSeasonSourceDepth: number;
    daysSinceLastRun: number | null;
  };
}

function bandIdForKey(keyLevel: number): string | null {
  if (!(keyLevel >= 2)) return null;
  for (const band of EXPERIENCE_KEY_BANDS) {
    if (keyLevel >= band.min && keyLevel <= band.max) return band.id;
  }
  return null;
}

export function distinctKeyBands(runs: ExperienceV2RunInput[]): string[] {
  const bands = new Set<string>();
  for (const run of runs) {
    const id = bandIdForKey(run.keyLevel);
    if (id) bands.add(id);
  }
  return [...bands].sort();
}

/**
 * Resolve historical_seasons denominator from actual source depth.
 * RIO `current:previous` alone → depth 1 (binary previous).
 * When durable local prior seasons exist → depth up to PRIOR_SEASON_LOCAL_CAP.
 */
export function resolvePriorSeasonSourceDepth(input: {
  rioPriorSeasonCount: number;
  localPriorSeasonCount: number;
}): number {
  const local = Math.max(0, input.localPriorSeasonCount);
  if (local > 0) {
    // Local durable history can credit up to LOCAL_CAP; depth matches what we observed
    // so a character with N local prior seasons can reach 100 when N fills the depth.
    return Math.min(PRIOR_SEASON_LOCAL_CAP, Math.max(local, PRIOR_SEASON_RIO_DEPTH));
  }
  // RIO `current:previous` alone — binary previous season, depth 1.
  return PRIOR_SEASON_RIO_DEPTH;
}

/** Merge RIO + local prior counts (distinct seasons; upper-bounded by local cap). */
export function mergePriorSeasonCount(rioPrior: number, localPrior: number): number {
  return Math.min(PRIOR_SEASON_LOCAL_CAP, Math.max(0, rioPrior, localPrior));
}

export function historicalSeasonsNormalized(
  priorSeasonCount: number,
  sourceDepth: number,
): number {
  const depth = Math.max(1, sourceDepth);
  const capped = Math.min(Math.max(0, priorSeasonCount), depth);
  return clamp01(capped / depth) * 100;
}

/** Diminishing participation: log curve capped so raw spam cannot saturate alone. */
export function participationDepthNormalized(
  seasonRunCount: number,
  expectedDungeonCount: number,
): number {
  const expected = Math.max(1, expectedDungeonCount);
  const cap = expected * 2.5;
  const capped = Math.min(Math.max(0, seasonRunCount), cap);
  return clamp01(Math.log1p(capped) / Math.log1p(cap)) * 100;
}

export function activityRecencyNormalized(
  lastCompletedAt: string | null,
  observedAt: string,
): { normalized: number; daysSince: number | null } {
  if (!lastCompletedAt) {
    return { normalized: 0, daysSince: null };
  }
  const lastMs = Date.parse(lastCompletedAt);
  const nowMs = Date.parse(observedAt);
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) {
    return { normalized: 0, daysSince: null };
  }
  const days = Math.max(0, (nowMs - lastMs) / (24 * 60 * 60 * 1000));
  if (days <= RECENCY_FULL_DAYS) {
    return { normalized: 100, daysSince: days };
  }
  if (days <= RECENCY_DECAY_DAYS) {
    const t = (days - RECENCY_FULL_DAYS) / (RECENCY_DECAY_DAYS - RECENCY_FULL_DAYS);
    return { normalized: 100 - t * (100 - RECENCY_FLOOR), daysSince: days };
  }
  const extra = days - RECENCY_DECAY_DAYS;
  const further = RECENCY_FLOOR - (extra / 180) * (RECENCY_FLOOR - RECENCY_HARD_FLOOR);
  return { normalized: Math.max(RECENCY_HARD_FLOOR, further), daysSince: days };
}

function provenanceConfidence(
  provenance: ExperienceHistoryProvenance,
  hasSignal: boolean,
): number {
  switch (provenance) {
    case "CONFIRMED_ABSENCE":
      return 0.72;
    case "HAS_HISTORY":
      return hasSignal ? 0.88 : 0.72;
    case "PARTIAL_SOURCES":
      return hasSignal ? 0.62 : 0.45;
    case "PROVIDER_FAILURE":
      return 0;
    default:
      return 0.4;
  }
}

/**
 * Pure Experience V2 computation from durable run/profile metadata.
 * No WCL combat events, no class logic, no alt inference.
 */
export function computeExperienceV2(input: ExperienceV2ComputeInput): ExperienceV2Result {
  const expected = Math.max(1, input.expectedDungeonCount);
  const selected = input.selectedRuns;
  const seasonRuns = input.seasonRuns.length > 0 ? input.seasonRuns : selected;
  const distinctDungeons = new Set(selected.map((r) => r.dungeonSlug.trim().toLowerCase())).size;
  const bands = distinctKeyBands(selected);
  const prior = Math.max(0, input.priorSeasonCount);
  const priorDepth = Math.max(1, input.priorSeasonSourceDepth ?? PRIOR_SEASON_RIO_DEPTH);
  const lastCompletedAt =
    seasonRuns.reduce<string | null>((latest, run) => {
      if (!latest || run.completedAt > latest) return run.completedAt;
      return latest;
    }, null) ??
    selected.reduce<string | null>((latest, run) => {
      if (!latest || run.completedAt > latest) return run.completedAt;
      return latest;
    }, null);

  const recency = activityRecencyNormalized(lastCompletedAt, input.observedAt);
  const hasHistory = distinctDungeons > 0 || seasonRuns.length > 0 || prior > 0;
  const baseConf = provenanceConfidence(input.provenance, hasHistory);

  const breadthNorm = clamp01(distinctDungeons / expected) * 100;
  const bandNorm = clamp01(bands.length / KEY_BAND_COUNT) * 100;
  const participationNorm = participationDepthNormalized(seasonRuns.length, expected);
  const historicalNorm = historicalSeasonsNormalized(prior, priorDepth);
  const recencyNorm = hasHistory ? recency.normalized : 0;

  const components: ExperienceV2Component[] = [
    {
      metricKey: "experience.dungeon_breadth",
      rawValue: distinctDungeons,
      normalizedValue: breadthNorm,
      confidence: baseConf,
      coverage: {
        present: distinctDungeons,
        expected,
        ratio: clamp01(distinctDungeons / expected),
      },
      detail: {
        distinctDungeons,
        expectedDungeonCount: expected,
        selectedRunCount: selected.length,
      },
    },
    {
      metricKey: "experience.key_band_breadth",
      rawValue: bands.length,
      normalizedValue: bandNorm,
      confidence: selected.length > 0 ? baseConf * 0.95 : baseConf * 0.85,
      coverage: {
        present: bands.length,
        expected: KEY_BAND_COUNT,
        ratio: clamp01(bands.length / KEY_BAND_COUNT),
      },
      detail: {
        bandsTouched: bands,
        bandCount: KEY_BAND_COUNT,
        bandDefinitions: EXPERIENCE_KEY_BANDS.map((b) => b.id),
        independentOfPeakKey: true,
      },
    },
    {
      metricKey: "experience.participation_depth",
      rawValue: seasonRuns.length,
      normalizedValue: participationNorm,
      confidence: baseConf * 0.9,
      coverage: {
        present: Math.min(seasonRuns.length, expected),
        expected,
        ratio: clamp01(Math.min(seasonRuns.length, expected) / expected),
      },
      detail: {
        seasonRunCount: seasonRuns.length,
        diminishingReturns: "log1p",
        spamCapMultiplier: 2.5,
      },
    },
    {
      metricKey: "experience.historical_seasons",
      rawValue: prior,
      normalizedValue: historicalNorm,
      confidence: prior > 0 ? Math.min(0.8, baseConf) : baseConf * 0.9,
      coverage: {
        present: prior > 0 ? 1 : 0,
        expected: 1,
        ratio: prior > 0 ? 1 : 0,
      },
      detail: {
        priorSeasonCount: prior,
        priorSeasonSourceDepth: priorDepth,
        rioFieldDepth: PRIOR_SEASON_RIO_DEPTH,
        localCap: PRIOR_SEASON_LOCAL_CAP,
        verifiedAccountHistory: false,
        noAltInference: true,
      },
    },
    {
      metricKey: "experience.activity_recency",
      rawValue: recency.daysSince ?? -1,
      normalizedValue: recencyNorm,
      confidence: hasHistory ? baseConf * 0.85 : baseConf,
      coverage: null,
      detail: {
        daysSinceLastRun: recency.daysSince,
        lastCompletedAt,
        gradualDecay: true,
      },
    },
  ];

  for (const component of components) {
    component.normalizedValue = Math.min(100, Math.max(0, component.normalizedValue));
  }

  const rawScore =
    components.reduce((s, c) => s + c.normalizedValue, 0) / Math.max(1, components.length);

  return {
    components,
    rawScore,
    provenance: input.provenance,
    evidence: {
      distinctDungeons,
      bandsTouched: bands.length,
      seasonRunCount: seasonRuns.length,
      priorSeasonCount: prior,
      priorSeasonSourceDepth: priorDepth,
      daysSinceLastRun: recency.daysSince,
    },
  };
}

/** Ablation: recompute rawScore with one component zeroed. */
export function ablateExperienceV2(
  result: ExperienceV2Result,
  zeroMetricKey: string,
): number {
  const parts = result.components.map((c) =>
    c.metricKey === zeroMetricKey ? 0 : c.normalizedValue,
  );
  return parts.reduce((s, v) => s + v, 0) / Math.max(1, parts.length);
}
