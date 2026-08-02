import { clamp } from "../../math.js";
import { getEliteCatalogEntry, ELITE_ACHIEVEMENT_CATALOG_V1 } from "./catalogs.js";
import type { ExperienceV3ModelConfig } from "./constants.js";
import type {
  EliteAchievementCatalogEntryV3,
  ExperienceV3ComponentResult,
  ExperienceV3EliteHistoryFact,
} from "./types.js";

function titleStrength(
  entry: EliteAchievementCatalogEntryV3,
  config: ExperienceV3ModelConfig,
): number {
  // Top 0.1% → singleTop01Score; softer titles scale down toward ~70.
  if (entry.percentile <= 0.1) return config.eliteHistory.singleTop01Score;
  if (entry.percentile <= 1) return config.eliteHistory.singleTop01Score * 0.82;
  return config.eliteHistory.singleTop01Score * 0.65;
}

function ageFactor(seasonsAgo: number | null, config: ExperienceV3ModelConfig): number {
  if (seasonsAgo == null || seasonsAgo <= 0) return 1;
  const decayed = 1 - seasonsAgo * config.eliteHistory.ageDecayPerSeason;
  return Math.max(config.eliteHistory.ageDecayFloor, decayed);
}

/**
 * Elite achievement / title history with diminishing returns.
 * Account-visible / ambiguous completions are discounted and noted — never claimed
 * as character-specific unless CHARACTER_CONFIRMED.
 */
export function scoreEliteHistoryV3(
  fact: ExperienceV3EliteHistoryFact,
  config: ExperienceV3ModelConfig,
  catalog: readonly EliteAchievementCatalogEntryV3[] = ELITE_ACHIEVEMENT_CATALOG_V1,
): ExperienceV3ComponentResult {
  const state = fact.evidenceState;
  const ambiguityNotes: string[] = [];

  if (state === "PROVIDER_FAILURE" || state === "UNKNOWN") {
    return {
      key: "eliteHistory",
      available: false,
      score: null,
      confidence: 0,
      weight: 0,
      effectiveWeight: 0,
      evidenceState: state,
      detail: {
        reason: state === "PROVIDER_FAILURE" ? "provider_failure" : "elite_history_unknown",
        catalogVersion: config.eliteCatalogVersion,
        ambiguityNotes,
      },
    };
  }

  if (state === "CONFIRMED_NO_ACTIVITY") {
    return {
      key: "eliteHistory",
      available: true,
      score: 0,
      confidence: 0.8,
      weight: 0,
      effectiveWeight: 0,
      evidenceState: state,
      detail: {
        confirmedTitleCount: 0,
        accountVisibleOnlyCount: 0,
        catalogVersion: config.eliteCatalogVersion,
        ambiguityNotes,
      },
    };
  }

  type ScoredTitle = {
    achievementId: number;
    strength: number;
    credit: number;
    visibility: string;
    seasonsAgo: number | null;
  };

  const scored: ScoredTitle[] = [];
  let confirmedTitleCount = 0;
  let accountVisibleOnlyCount = 0;

  for (const obs of fact.achievements) {
    const entry = getEliteCatalogEntry(obs.achievementId, catalog);
    if (!entry) continue;

    if (obs.visibility === "ABSENT") continue;

    if (obs.visibility === "ACCOUNT_VISIBLE" || obs.visibility === "AMBIGUOUS") {
      accountVisibleOnlyCount += 1;
      ambiguityNotes.push(
        `achievement_${obs.achievementId}_${obs.visibility.toLowerCase()}_not_character_confirmed`,
      );
      const strength = titleStrength(entry, config);
      const credit =
        strength *
        config.eliteHistory.accountVisibleCreditFactor *
        ageFactor(obs.seasonsAgo, config);
      scored.push({
        achievementId: obs.achievementId,
        strength,
        credit,
        visibility: obs.visibility,
        seasonsAgo: obs.seasonsAgo,
      });
      continue;
    }

    if (obs.visibility === "UNKNOWN") {
      ambiguityNotes.push(`achievement_${obs.achievementId}_visibility_unknown`);
      continue;
    }

    // CHARACTER_CONFIRMED
    confirmedTitleCount += 1;
    const strength = titleStrength(entry, config);
    const credit = strength * ageFactor(obs.seasonsAgo, config);
    scored.push({
      achievementId: obs.achievementId,
      strength,
      credit,
      visibility: obs.visibility,
      seasonsAgo: obs.seasonsAgo,
    });
  }

  if (scored.length === 0) {
    // HAS_VALUE / PARTIAL with no catalog hits → low available signal, not failure.
    const available = state === "HAS_VALUE" || state === "PARTIAL";
    return {
      key: "eliteHistory",
      available,
      score: available ? 0 : null,
      confidence: available ? (state === "PARTIAL" ? 0.45 : 0.7) : 0,
      weight: 0,
      effectiveWeight: 0,
      evidenceState: state,
      detail: {
        confirmedTitleCount: 0,
        accountVisibleOnlyCount,
        catalogVersion: config.eliteCatalogVersion,
        ambiguityNotes,
        reason: "no_catalog_matches",
      },
    };
  }

  // Sort strongest first; apply diminishing returns on successive titles.
  scored.sort((a, b) => b.credit - a.credit);
  let total = 0;
  for (let i = 0; i < scored.length; i += 1) {
    if (i === 0) {
      total += scored[i]!.credit;
      continue;
    }
    const diminishing =
      config.eliteHistory.additionalTitleBase *
      Math.pow(config.eliteHistory.additionalDiminishing, i - 1);
    // Blend additional base with residual credit so multiple titles approach 100.
    total += Math.min(scored[i]!.credit * 0.15, diminishing);
  }

  const normalized = clamp(total, 0, config.eliteHistory.scoreCap);
  const hasConfirmed = confirmedTitleCount > 0;
  const confidence = hasConfirmed
    ? state === "PARTIAL"
      ? 0.55
      : 0.82
    : state === "PARTIAL"
      ? 0.35
      : 0.45;

  return {
    key: "eliteHistory",
    available: true,
    score: normalized,
    confidence,
    weight: 0,
    effectiveWeight: 0,
    evidenceState: state,
    detail: {
      confirmedTitleCount,
      accountVisibleOnlyCount,
      catalogVersion: config.eliteCatalogVersion,
      ambiguityNotes,
      titles: scored.map((t) => ({
        achievementId: t.achievementId,
        visibility: t.visibility,
        credit: t.credit,
        seasonsAgo: t.seasonsAgo,
      })),
      diminishingReturns: true,
    },
  };
}
