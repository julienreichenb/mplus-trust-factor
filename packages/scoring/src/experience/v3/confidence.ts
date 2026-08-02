import { clamp } from "../../math.js";
import type { ExperienceV3ModelConfig } from "./constants.js";
import type {
  ExperienceV3ComponentResult,
  ExperienceV3CurrentExposureFact,
  ExperienceV3EliteHistoryFact,
  ExperienceV3HistoricalRankFact,
  ExperienceV3PreviousSeasonFact,
  HistoricalRankPolicyV3,
  PreviousSeasonNormalizationPolicyV3,
} from "./types.js";

export interface ExperienceV3ConfidenceInput {
  currentExposure: ExperienceV3CurrentExposureFact;
  previousSeason: ExperienceV3PreviousSeasonFact;
  previousSeasonPolicy: PreviousSeasonNormalizationPolicyV3;
  eliteHistory: ExperienceV3EliteHistoryFact;
  historicalRank: ExperienceV3HistoricalRankFact | null;
  historicalRankPolicy: HistoricalRankPolicyV3;
  components: ExperienceV3ComponentResult[];
  config: ExperienceV3ModelConfig;
}

function previousSeasonProviderFactor(state: ExperienceV3PreviousSeasonFact["evidenceState"]): number {
  switch (state) {
    case "HAS_VALUE":
      return 1;
    case "CONFIRMED_NO_ACTIVITY":
      return 0.9;
    case "PARTIAL":
      return 0.55;
    case "PROVIDER_FAILURE":
      return 0.15;
    case "UNKNOWN":
      return 0.2;
    default:
      return 0.2;
  }
}

function eliteVisibilityFactor(fact: ExperienceV3EliteHistoryFact): number {
  switch (fact.evidenceState) {
    case "HAS_VALUE":
      return fact.achievements.some((a) => a.visibility === "CHARACTER_CONFIRMED")
        ? 1
        : fact.achievements.some(
              (a) => a.visibility === "ACCOUNT_VISIBLE" || a.visibility === "AMBIGUOUS",
            )
          ? 0.55
          : 0.75;
    case "CONFIRMED_NO_ACTIVITY":
      return 0.85;
    case "PARTIAL":
      return 0.5;
    case "PROVIDER_FAILURE":
      return 0.15;
    case "UNKNOWN":
      return 0.25;
    default:
      return 0.25;
  }
}

function historicalRankSourceFactor(
  fact: ExperienceV3HistoricalRankFact | null,
  policy: HistoricalRankPolicyV3,
): number {
  if (fact == null) return 0.4; // optional missing — mild dampening only
  if (fact.evidenceState === "PROVIDER_FAILURE") return 0.2;
  if (fact.evidenceState === "UNKNOWN" || fact.evidenceState === "CONFIRMED_NO_ACTIVITY") {
    return 0.45;
  }
  const idx = policy.sourcePriority.indexOf(fact.source);
  if (idx === 0) return 1;
  if (idx === 1) return 0.9;
  if (idx === 2) return 0.75;
  return 0.55;
}

/**
 * Experience can have high confidence without WCL when Blizzard/local history is complete.
 */
export function computeExperienceConfidenceV3(input: ExperienceV3ConfidenceInput): {
  confidence: number;
  components: Record<string, number>;
  limits: string[];
} {
  const w = input.config.confidenceWeights;
  const limits: string[] = [];

  const exposure = input.components.find((c) => c.key === "currentExposure");
  const exposureCompleteness =
    exposure?.available && exposure.confidence > 0
      ? clamp(exposure.confidence, 0, 1)
      : input.currentExposure.provenance === "PROVIDER_FAILURE"
        ? 0
        : 0.25;

  if (input.currentExposure.provenance === "PROVIDER_FAILURE") {
    limits.push("current_exposure_provider_failure");
  }
  if (input.previousSeason.evidenceState === "PROVIDER_FAILURE") {
    limits.push("previous_season_provider_failure");
  }
  if (input.eliteHistory.evidenceState === "PROVIDER_FAILURE") {
    limits.push("elite_history_provider_failure");
  }
  if (
    input.eliteHistory.achievements.some(
      (a) => a.visibility === "ACCOUNT_VISIBLE" || a.visibility === "AMBIGUOUS",
    )
  ) {
    limits.push("account_visible_achievement_ambiguity");
  }

  const prevFactor = previousSeasonProviderFactor(input.previousSeason.evidenceState);
  const eliteFactor = eliteVisibilityFactor(input.eliteHistory);
  const rankFactor = historicalRankSourceFactor(
    input.historicalRank,
    input.historicalRankPolicy,
  );

  const seasonBinding = clamp(
    input.previousSeasonPolicy.confidence *
      (input.previousSeason.seasonId || input.previousSeason.seasonSlug ? 1 : 0.7),
    0,
    1,
  );

  const days = (() => {
    const runs =
      input.currentExposure.seasonRuns.length > 0
        ? input.currentExposure.seasonRuns
        : input.currentExposure.selectedRuns;
    if (runs.length === 0) return null;
    let latest: string | null = null;
    for (const r of runs) {
      if (!latest || r.completedAt > latest) latest = r.completedAt;
    }
    if (!latest) return null;
    const ms =
      Date.parse(input.currentExposure.observedAt) - Date.parse(latest);
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, ms / (24 * 60 * 60 * 1000));
  })();

  let recency = 0.5;
  if (days != null) {
    if (days <= 14) recency = 1;
    else if (days <= 90) recency = 1 - ((days - 14) / 76) * 0.45;
    else recency = 0.4;
  }

  const components = {
    currentExposureCompleteness: exposureCompleteness,
    previousSeasonProviderState: prevFactor,
    eliteVisibilitySemantics: eliteFactor,
    historicalRankSourceQuality: rankFactor,
    seasonBinding,
    recency,
  };

  const confidence =
    components.currentExposureCompleteness * w.currentExposureCompleteness +
    components.previousSeasonProviderState * w.previousSeasonProviderState +
    components.eliteVisibilitySemantics * w.eliteVisibilitySemantics +
    components.historicalRankSourceQuality * w.historicalRankSourceQuality +
    components.seasonBinding * w.seasonBinding +
    components.recency * w.recency;

  // Hard gate: total provider failure on exposure → confidence 0.
  if (input.currentExposure.provenance === "PROVIDER_FAILURE") {
    return { confidence: 0, components, limits };
  }

  return { confidence: clamp(confidence, 0, 1), components, limits };
}
