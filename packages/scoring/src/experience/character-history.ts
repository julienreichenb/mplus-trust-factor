import type { MetricObservationDTO } from "@mplus/contracts";

export interface CharacterHistoryRunInput {
  dungeonSlug: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  scoreValue?: number | null;
}

export interface CharacterHistoryExperienceInput {
  observedAt: string;
  expectedDungeonCount: number;
  selectedRuns: CharacterHistoryRunInput[];
  /** Current-season Mythic+ rating when known (CHARACTER_HISTORY only). */
  mythicRatingObservation?: MetricObservationDTO | null;
  /** Count of distinct prior seasons with public history (no alt inference). */
  priorSeasonCount?: number;
  /** Same-character role continuity 0–1 when known. */
  roleContinuity?: number | null;
  sourceProvider?: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Build EXPERIENCE observations from character-history facts only.
 * Does not use WCL combat events, detailedRunCount, or account/alt graphs.
 */
export function buildCharacterHistoryExperienceObservations(
  input: CharacterHistoryExperienceInput,
): MetricObservationDTO[] {
  const runs = input.selectedRuns;
  const expected = Math.max(1, input.expectedDungeonCount);
  const distinctDungeons = new Set(runs.map((r) => r.dungeonSlug)).size;
  const peakKey = runs.reduce((max, r) => Math.max(max, r.keyLevel), 0);
  const peakRuns = peakKey > 0 ? runs.filter((r) => r.keyLevel === peakKey).length : 0;
  const sourceProvider = input.sourceProvider ?? "character_history";
  const observedAt = input.observedAt;
  const out: MetricObservationDTO[] = [];

  out.push({
    metricKey: "experience.dungeon_breadth",
    dimension: "EXPERIENCE",
    rawValue: distinctDungeons,
    normalizedValue: clamp01(distinctDungeons / expected) * 100,
    confidence: runs.length > 0 ? 0.85 : 0,
    observedAt,
    sourceProvider,
    coverage: { present: distinctDungeons, expected, ratio: clamp01(distinctDungeons / expected) },
    context: {
      historyMode: "CHARACTER_HISTORY",
      distinctDungeons,
      expectedDungeonCount: expected,
      selectedRunCount: runs.length,
      noAltInference: true,
      independentOfWclDetails: true,
    },
  });

  out.push({
    metricKey: "experience.top_level_repeat",
    dimension: "EXPERIENCE",
    rawValue: peakRuns,
    normalizedValue: peakKey > 0 ? clamp01(peakRuns / Math.max(2, expected / 2)) * 100 : null,
    confidence: peakKey > 0 ? 0.8 : 0,
    observedAt,
    sourceProvider,
    coverage: {
      present: peakRuns,
      expected: Math.max(2, Math.floor(expected / 2)),
      ratio: peakKey > 0 ? clamp01(peakRuns / Math.max(2, expected / 2)) : 0,
    },
    context: {
      historyMode: "CHARACTER_HISTORY",
      peakKeyLevel: peakKey,
      peakRunCount: peakRuns,
      independentOfWclDetails: true,
    },
  });

  out.push({
    metricKey: "experience.volume_recency",
    dimension: "EXPERIENCE",
    rawValue: runs.length,
    normalizedValue: clamp01(runs.length / expected) * 100,
    confidence: runs.length > 0 ? 0.75 : 0,
    observedAt,
    sourceProvider,
    coverage: {
      present: runs.length,
      expected,
      ratio: clamp01(runs.length / expected),
    },
    context: {
      historyMode: "CHARACTER_HISTORY",
      selectedRunCount: runs.length,
      independentOfWclDetails: true,
      derivedFrom: "selected_seasonal_runs",
    },
  });

  if (input.mythicRatingObservation) {
    out.push(input.mythicRatingObservation);
  }

  const prior = input.priorSeasonCount ?? 0;
  out.push({
    metricKey: "experience.historical_seasons",
    dimension: "EXPERIENCE",
    rawValue: prior,
    normalizedValue: prior > 0 ? clamp01(prior / 4) * 100 : null,
    confidence: prior > 0 ? 0.55 : 0,
    observedAt,
    sourceProvider,
    coverage: { present: prior > 0 ? 1 : 0, expected: 1, ratio: prior > 0 ? 1 : 0 },
    context: {
      historyMode: "CHARACTER_HISTORY",
      priorSeasonCount: prior,
      verifiedAccountHistory: false,
      noAltInference: true,
      independentOfWclDetails: true,
    },
  });

  if (input.roleContinuity != null && Number.isFinite(input.roleContinuity)) {
    out.push({
      metricKey: "experience.role_continuity",
      dimension: "EXPERIENCE",
      rawValue: input.roleContinuity,
      normalizedValue: clamp01(input.roleContinuity) * 100,
      confidence: 0.5,
      observedAt,
      sourceProvider,
      coverage: null,
      context: {
        historyMode: "CHARACTER_HISTORY",
        noAltInference: true,
        independentOfWclDetails: true,
      },
    });
  }

  return out.filter((o) => o.confidence > 0 || o.normalizedValue != null);
}
