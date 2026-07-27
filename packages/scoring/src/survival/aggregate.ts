import { clamp, clamp01 } from "../math.js";
import type {
  ComputeSurvivalInput,
  ComputeSurvivalResult,
  SurvivalContributorKey,
  SurvivalContributorScore,
  SurvivalRunExplanation,
  SurvivalRunInput,
  SurvivalSummaryDTO,
} from "./types.js";
import {
  DEATH_SOFT_CAP,
  DEFENSIVE_CREDIT_CAP_RATIO,
  SURVIVAL_V3_FORMULA_VERSION,
  SURVIVAL_V3_METRIC_KEYS,
  SURVIVAL_V3_WEIGHTS,
} from "./types.js";

function meanOfValid(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

/**
 * Deaths → 0–100. Zero deaths scores 100 on this contributor alone;
 * Survival aggregate still mixes other contributors so deaths alone cannot perfect the dimension.
 */
export function scoreDeaths(deaths: number | null): number | null {
  if (deaths == null || !Number.isFinite(deaths) || deaths < 0) return null;
  return clamp(100 * (1 - deaths / DEATH_SOFT_CAP), 0, 100);
}

/**
 * Avoidable damage rate in max-HP fractions per minute.
 * Lower rate → higher score. Unknown/unclassified damage never enters the rate.
 */
export function computeAvoidableDamageRate(input: {
  avoidableDamageTaken: number | null;
  maxHealth: number | null;
  durationMs: number | null;
}): number | null {
  const { avoidableDamageTaken, maxHealth, durationMs } = input;
  if (
    avoidableDamageTaken == null ||
    maxHealth == null ||
    maxHealth <= 0 ||
    durationMs == null ||
    durationMs <= 0
  ) {
    return null;
  }
  const minutes = durationMs / 60_000;
  if (minutes <= 0) return null;
  return avoidableDamageTaken / maxHealth / minutes;
}

/**
 * Map avoidable HP-fractions/minute → 0–100 (invert).
 * 0 → 100; ~0.25 → ~80; ~0.5 → ~60; ~1.0 → ~30; ≥2.0 → 0.
 * When a cohort percentile is provided (higher = worse), blend 60% absolute / 40% cohort.
 */
export function scoreAvoidableDamage(
  rate: number | null,
  cohortPercentileWorse?: number | null,
): number | null {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return null;
  const absolute = clamp(100 * Math.exp(-1.2 * rate), 0, 100);
  if (
    cohortPercentileWorse == null ||
    !Number.isFinite(cohortPercentileWorse)
  ) {
    return absolute;
  }
  const cohortScore = clamp(100 - cohortPercentileWorse, 0, 100);
  return 0.6 * absolute + 0.4 * cohortScore;
}

/**
 * Cap credited defensive casts so spam past available uses cannot inflate the score.
 */
export function creditDefensiveUses(
  casts: number | null,
  availableUses: number | null,
): number | null {
  if (casts == null || availableUses == null) return null;
  if (!Number.isFinite(casts) || !Number.isFinite(availableUses)) return null;
  if (availableUses <= 0) return 0;
  const cap = availableUses * DEFENSIVE_CREDIT_CAP_RATIO;
  return Math.min(Math.max(0, casts), cap);
}

export function scorePersonalDefensives(
  casts: number | null,
  availableUses: number | null,
): number | null {
  const credited = creditDefensiveUses(casts, availableUses);
  if (credited == null || availableUses == null || availableUses <= 0) return null;
  return clamp(100 * (credited / availableUses), 0, 100);
}

/**
 * Credit effective self-healing (overheal ignored) + potion use inside the 15% bucket.
 * healShare 70% / potionShare 30% when both signals exist.
 */
export function scoreSelfHealAndPotion(input: {
  selfHealEffective: number | null;
  selfHealOverheal: number | null;
  healthPotionCasts: number | null;
  maxHealth: number | null;
  durationMs: number | null;
}): number | null {
  const { selfHealEffective, healthPotionCasts, maxHealth, durationMs } = input;
  const hasHeal = selfHealEffective != null && Number.isFinite(selfHealEffective);
  const hasPotion = healthPotionCasts != null && Number.isFinite(healthPotionCasts);
  if (!hasHeal && !hasPotion) return null;

  let healScore: number | null = null;
  if (hasHeal) {
    if (maxHealth != null && maxHealth > 0 && durationMs != null && durationMs > 0) {
      const minutes = durationMs / 60_000;
      const rate = selfHealEffective! / maxHealth / Math.max(minutes, 1 / 60);
      // Moderate self-heal throughput is good; saturates around ~0.4 HP/min.
      healScore = clamp(100 * (1 - Math.exp(-3.5 * rate)), 0, 100);
    } else {
      // Fallback absolute curve when max health missing — still credit effective heal, not overheal.
      healScore = clamp(100 * (1 - Math.exp(-selfHealEffective! / 250_000)), 0, 100);
    }
  }

  let potionScore: number | null = null;
  if (hasPotion) {
    // 0 potions → 40 (neutral-low); 1 → 85; 2+ → 100. Not using a potion is not catastrophic.
    const casts = Math.max(0, healthPotionCasts!);
    potionScore = casts <= 0 ? 40 : casts === 1 ? 85 : 100;
  }

  if (healScore != null && potionScore != null) {
    return 0.7 * healScore + 0.3 * potionScore;
  }
  return healScore ?? potionScore;
}

function fieldAvailable(
  survival: SurvivalRunInput["survival"],
  field: string,
): boolean {
  const status = survival.fieldStatus[field];
  if (!status) return false;
  return status.availability === "AVAILABLE" || status.availability === "PARTIAL";
}

/**
 * Resolve which contributors are usable for a single run.
 * Missing capability or blocked data → omit and renormalize upstream.
 */
export function resolveRunContributors(
  run: SurvivalRunInput,
): SurvivalContributorScore[] {
  const missing: SurvivalContributorScore[] = [];

  // Deaths
  if (run.detailAvailable && run.survival.deaths != null && fieldAvailable(run.survival, "deaths")) {
    missing.push({
      key: "deaths",
      metricKey: SURVIVAL_V3_METRIC_KEYS.deaths,
      weight: SURVIVAL_V3_WEIGHTS.deaths,
      effectiveWeight: 0,
      score: scoreDeaths(run.survival.deaths),
      availability: run.survival.fieldStatus.deaths?.availability ?? "AVAILABLE",
      reason: null,
    });
  } else {
    missing.push({
      key: "deaths",
      metricKey: SURVIVAL_V3_METRIC_KEYS.deaths,
      weight: SURVIVAL_V3_WEIGHTS.deaths,
      effectiveWeight: 0,
      score: null,
      availability: "BLOCKED",
      reason: run.survival.fieldStatus.deaths?.reason ?? "deaths_unavailable",
    });
  }

  // Avoidable damage — requires catalog signal + max health + duration
  const avoidableStatus = run.survival.fieldStatus.avoidableDamageTaken?.availability;
  const rate = computeAvoidableDamageRate({
    avoidableDamageTaken: run.survival.avoidableDamageTaken,
    maxHealth: run.survival.maxHealth,
    durationMs: run.durationMs,
  });
  const avoidableUsable =
    run.detailAvailable &&
    rate != null &&
    (avoidableStatus === "AVAILABLE" || avoidableStatus === "PARTIAL");

  if (avoidableUsable) {
    missing.push({
      key: "avoidableDamage",
      metricKey: SURVIVAL_V3_METRIC_KEYS.avoidableDamage,
      weight: SURVIVAL_V3_WEIGHTS.avoidableDamage,
      effectiveWeight: 0,
      score: scoreAvoidableDamage(rate, run.avoidableDamageCohortPercentile),
      availability: avoidableStatus ?? "PARTIAL",
      reason:
        avoidableStatus === "PARTIAL"
          ? run.survival.fieldStatus.avoidableDamageTaken?.reason ??
            "mechanic_catalog_coverage_incomplete"
          : null,
    });
  } else {
    const reason =
      run.survival.maxHealth == null
        ? "max_health_unavailable_for_normalization"
        : run.durationMs == null || run.durationMs <= 0
          ? "duration_unavailable_for_normalization"
          : avoidableStatus === "BLOCKED"
            ? run.survival.fieldStatus.avoidableDamageTaken?.reason ??
              "mechanic_catalog_coverage_incomplete"
            : "avoidable_damage_unavailable";
    missing.push({
      key: "avoidableDamage",
      metricKey: SURVIVAL_V3_METRIC_KEYS.avoidableDamage,
      weight: SURVIVAL_V3_WEIGHTS.avoidableDamage,
      effectiveWeight: 0,
      score: null,
      availability: "BLOCKED",
      reason,
    });
  }

  // Personal defensives — capability-aware
  if (!run.hasPersonalDefensiveCapability) {
    missing.push({
      key: "personalDefensives",
      metricKey: SURVIVAL_V3_METRIC_KEYS.personalDefensives,
      weight: SURVIVAL_V3_WEIGHTS.personalDefensives,
      effectiveWeight: 0,
      score: null,
      availability: "MISSING",
      reason: "spec_lacks_personal_defensive_capability",
    });
  } else if (
    run.detailAvailable &&
    run.survival.personalDefensiveCasts != null &&
    run.availableDefensiveUses != null &&
    run.availableDefensiveUses > 0
  ) {
    missing.push({
      key: "personalDefensives",
      metricKey: SURVIVAL_V3_METRIC_KEYS.personalDefensives,
      weight: SURVIVAL_V3_WEIGHTS.personalDefensives,
      effectiveWeight: 0,
      score: scorePersonalDefensives(
        run.survival.personalDefensiveCasts,
        run.availableDefensiveUses,
      ),
      availability: "AVAILABLE",
      reason: null,
    });
  } else {
    missing.push({
      key: "personalDefensives",
      metricKey: SURVIVAL_V3_METRIC_KEYS.personalDefensives,
      weight: SURVIVAL_V3_WEIGHTS.personalDefensives,
      effectiveWeight: 0,
      score: null,
      availability: "BLOCKED",
      reason:
        run.availableDefensiveUses == null || run.availableDefensiveUses <= 0
          ? "defensive_available_uses_unavailable"
          : "personal_defensive_casts_unavailable",
    });
  }

  // Self-heal + potion — capability-aware; overheal exposed but not scored
  if (!run.hasSelfHealOrPotionCapability) {
    missing.push({
      key: "selfHealAndPotion",
      metricKey: SURVIVAL_V3_METRIC_KEYS.selfHealAndPotion,
      weight: SURVIVAL_V3_WEIGHTS.selfHealAndPotion,
      effectiveWeight: 0,
      score: null,
      availability: "MISSING",
      reason: "spec_lacks_self_heal_or_potion_capability",
    });
  } else if (
    run.detailAvailable &&
    (run.survival.selfHealEffective != null || run.survival.healthPotionCasts != null)
  ) {
    missing.push({
      key: "selfHealAndPotion",
      metricKey: SURVIVAL_V3_METRIC_KEYS.selfHealAndPotion,
      weight: SURVIVAL_V3_WEIGHTS.selfHealAndPotion,
      effectiveWeight: 0,
      score: scoreSelfHealAndPotion({
        selfHealEffective: run.survival.selfHealEffective,
        selfHealOverheal: run.survival.selfHealOverheal,
        healthPotionCasts: run.survival.healthPotionCasts,
        maxHealth: run.survival.maxHealth,
        durationMs: run.durationMs,
      }),
      availability: run.survival.maxHealth != null ? "AVAILABLE" : "PARTIAL",
      reason:
        run.survival.maxHealth == null
          ? "self_heal_scored_without_max_health_fallback"
          : null,
    });
  } else {
    missing.push({
      key: "selfHealAndPotion",
      metricKey: SURVIVAL_V3_METRIC_KEYS.selfHealAndPotion,
      weight: SURVIVAL_V3_WEIGHTS.selfHealAndPotion,
      effectiveWeight: 0,
      score: null,
      availability: "BLOCKED",
      reason: "self_heal_and_potion_unavailable",
    });
  }

  const available = missing.filter((c) => c.score != null);
  const weightSum = available.reduce((sum, c) => sum + c.weight, 0);
  return missing.map((c) => ({
    ...c,
    effectiveWeight:
      c.score != null && weightSum > 0 ? c.weight / weightSum : 0,
  }));
}

export function combineRunSurvivalScore(
  contributors: SurvivalContributorScore[],
): number | null {
  const active = contributors.filter((c) => c.score != null && c.effectiveWeight > 0);
  if (active.length === 0) return null;
  return active.reduce((sum, c) => sum + c.score! * c.effectiveWeight, 0);
}

export function explainSurvivalRun(run: SurvivalRunInput): SurvivalRunExplanation {
  const contributors = resolveRunContributors(run);
  const rate = computeAvoidableDamageRate({
    avoidableDamageTaken: run.survival.avoidableDamageTaken,
    maxHealth: run.survival.maxHealth,
    durationMs: run.durationMs,
  });
  const credited = creditDefensiveUses(
    run.survival.personalDefensiveCasts,
    run.availableDefensiveUses,
  );
  const missingReasons = contributors
    .filter((c) => c.score == null)
    .map((c) => c.reason ?? c.key)
    .filter((r): r is string => Boolean(r));

  return {
    dungeonSlug: run.dungeonSlug,
    dungeonName: run.dungeonName ?? run.dungeonSlug,
    canonicalRunId: run.canonicalRunId,
    keyLevel: run.keyLevel,
    durationMs: run.durationMs,
    detailAvailable: run.detailAvailable,
    deaths: run.survival.deaths,
    deathScore: contributors.find((c) => c.key === "deaths")?.score ?? null,
    totalDamageTaken: run.survival.totalDamageTaken,
    avoidableDamageTaken: run.survival.avoidableDamageTaken,
    avoidableDamageCoverageRatio: run.survival.avoidableDamageCoverageRatio,
    maxHealth: run.survival.maxHealth,
    avoidableDamageRatePerMaxHpMinute: rate,
    avoidableDamageScore:
      contributors.find((c) => c.key === "avoidableDamage")?.score ?? null,
    personalDefensiveCasts: run.survival.personalDefensiveCasts,
    availableDefensiveUses: run.availableDefensiveUses,
    creditedDefensiveUses: credited,
    personalDefensiveScore:
      contributors.find((c) => c.key === "personalDefensives")?.score ?? null,
    selfHealEffective: run.survival.selfHealEffective,
    selfHealOverheal: run.survival.selfHealOverheal,
    healthPotionCasts: run.survival.healthPotionCasts,
    selfHealAndPotionScore:
      contributors.find((c) => c.key === "selfHealAndPotion")?.score ?? null,
    runSurvivalScore: combineRunSurvivalScore(contributors),
    contributors,
    missingReasons,
    formulaVersion: SURVIVAL_V3_FORMULA_VERSION,
    abilityCatalogVersion: run.survival.provenance.abilityCatalogVersion,
    mechanicCatalogVersion: run.survival.provenance.mechanicCatalogVersion,
  };
}

/**
 * Model metric weights for SURVIVAL v3. Renormalizes when contributors are absent
 * so missing data never invents a zero penalty.
 */
export function resolveSurvivalMetricWeights(
  active: ReadonlySet<SurvivalContributorKey> | SurvivalContributorKey[],
): Array<{ metricKey: string; weight: number }> {
  const set = active instanceof Set ? active : new Set(active);
  const defs: Array<{ key: SurvivalContributorKey; metricKey: string; weight: number }> = [
    {
      key: "deaths",
      metricKey: SURVIVAL_V3_METRIC_KEYS.deaths,
      weight: SURVIVAL_V3_WEIGHTS.deaths,
    },
    {
      key: "avoidableDamage",
      metricKey: SURVIVAL_V3_METRIC_KEYS.avoidableDamage,
      weight: SURVIVAL_V3_WEIGHTS.avoidableDamage,
    },
    {
      key: "personalDefensives",
      metricKey: SURVIVAL_V3_METRIC_KEYS.personalDefensives,
      weight: SURVIVAL_V3_WEIGHTS.personalDefensives,
    },
    {
      key: "selfHealAndPotion",
      metricKey: SURVIVAL_V3_METRIC_KEYS.selfHealAndPotion,
      weight: SURVIVAL_V3_WEIGHTS.selfHealAndPotion,
    },
  ];
  const available = defs.filter((d) => set.has(d.key));
  const sum = available.reduce((s, d) => s + d.weight, 0);
  if (sum <= 0) return [];
  // Preserve exact nominal weights when the full set is present.
  if (available.length === defs.length) {
    return available.map((d) => ({ metricKey: d.metricKey, weight: d.weight }));
  }
  return available.map((d) => ({
    metricKey: d.metricKey,
    weight: d.weight / sum,
  }));
}

/**
 * Independent SURVIVAL confidence. Missing contributors / thin coverage lower confidence only.
 */
export function computeSurvivalConfidence(input: {
  availableRunCount: number;
  expectedDungeonCount: number;
  selectedRunWclCoverage: number;
  hasResolvedSpecAndRole: boolean;
  logFreshness: number;
  /** Mean of per-run contributor coverage ratios (available/4). */
  meanContributorCoverage: number;
  /** Mean avoidable catalog coverage across available runs (0–1). */
  meanAvoidableCatalogCoverage: number;
  /** Fraction of available runs with max health. */
  maxHealthCoverage: number;
}): number {
  if (input.availableRunCount === 0) return 0;

  const expected = Math.max(1, input.expectedDungeonCount);
  const coverage = clamp01(input.availableRunCount / expected);
  const breadth =
    input.availableRunCount <= 1
      ? 0.25
      : input.availableRunCount <= 2
        ? 0.45
        : input.availableRunCount <= 4
          ? 0.7
          : clamp01(
              0.7 +
                0.3 *
                  ((input.availableRunCount - 4) / Math.max(1, expected - 4)),
            );

  const identity = input.hasResolvedSpecAndRole ? 1 : 0.7;
  const freshness = clamp01(input.logFreshness);
  const wclCoverage = clamp01(input.selectedRunWclCoverage);
  const contributorCoverage = clamp01(input.meanContributorCoverage);
  const catalogCoverage = clamp01(input.meanAvoidableCatalogCoverage);
  const maxHealth = clamp01(input.maxHealthCoverage);

  const base =
    0.26 * coverage +
    0.18 * breadth +
    0.16 * contributorCoverage +
    0.12 * catalogCoverage +
    0.12 * maxHealth +
    0.08 * freshness +
    0.08 * wclCoverage;

  return clamp01(base * identity);
}

function aggregateContributorScores(
  explanations: SurvivalRunExplanation[],
  key: SurvivalContributorKey,
): number | null {
  return meanOfValid(
    explanations.map(
      (e) => e.contributors.find((c) => c.key === key)?.score ?? null,
    ),
  );
}

/**
 * Equal-weight mean across available of the eight selected runs.
 * Unavailable runs are omitted (never zero-filled).
 */
export function computeSurvivalDimension(
  input: ComputeSurvivalInput,
): ComputeSurvivalResult {
  const explanations = input.runs.map(explainSurvivalRun);
  const scored = explanations.filter((e) => e.runSurvivalScore != null);
  const survivalScore = meanOfValid(scored.map((e) => e.runSurvivalScore));

  const activeKeys = new Set<SurvivalContributorKey>();
  for (const e of scored) {
    for (const c of e.contributors) {
      if (c.score != null) activeKeys.add(c.key);
    }
  }

  const observations = {
    deaths: aggregateContributorScores(scored, "deaths"),
    avoidableDamage: aggregateContributorScores(scored, "avoidableDamage"),
    personalDefensives: aggregateContributorScores(scored, "personalDefensives"),
    selfHealAndPotion: aggregateContributorScores(scored, "selfHealAndPotion"),
  };

  // Drop observation keys that resolved null across all runs.
  if (observations.deaths == null) activeKeys.delete("deaths");
  if (observations.avoidableDamage == null) activeKeys.delete("avoidableDamage");
  if (observations.personalDefensives == null) activeKeys.delete("personalDefensives");
  if (observations.selfHealAndPotion == null) activeKeys.delete("selfHealAndPotion");

  const meanContributorCoverage =
    scored.length === 0
      ? 0
      : scored.reduce((sum, e) => {
          const available = e.contributors.filter((c) => c.score != null).length;
          return sum + available / e.contributors.length;
        }, 0) / scored.length;

  const meanAvoidableCatalogCoverage =
    scored.length === 0
      ? 0
      : scored.reduce(
          (sum, e) => sum + (e.avoidableDamageCoverageRatio ?? 0),
          0,
        ) / scored.length;

  const maxHealthCoverage =
    scored.length === 0
      ? 0
      : scored.filter((e) => e.maxHealth != null && e.maxHealth > 0).length /
        scored.length;

  const confidence = computeSurvivalConfidence({
    availableRunCount: scored.length,
    expectedDungeonCount: input.expectedDungeonCount,
    selectedRunWclCoverage: input.selectedRunWclCoverage,
    hasResolvedSpecAndRole: input.hasResolvedSpecAndRole,
    logFreshness: input.logFreshness ?? (scored.length > 0 ? 0.75 : 0),
    meanContributorCoverage,
    meanAvoidableCatalogCoverage,
    maxHealthCoverage,
  });

  const weightDefs = resolveSurvivalMetricWeights(activeKeys);
  const weightByKey = new Map(
    (
      [
        ["deaths", SURVIVAL_V3_METRIC_KEYS.deaths],
        ["avoidableDamage", SURVIVAL_V3_METRIC_KEYS.avoidableDamage],
        ["personalDefensives", SURVIVAL_V3_METRIC_KEYS.personalDefensives],
        ["selfHealAndPotion", SURVIVAL_V3_METRIC_KEYS.selfHealAndPotion],
      ] as const
    ).map(([key, metricKey]) => [
      key,
      weightDefs.find((w) => w.metricKey === metricKey)?.weight ?? 0,
    ]),
  );
  const contributorWeights = (
    Object.keys(SURVIVAL_V3_WEIGHTS) as SurvivalContributorKey[]
  ).map((key) => ({
    key,
    weight: SURVIVAL_V3_WEIGHTS[key],
    effectiveWeight: weightByKey.get(key) ?? 0,
  }));

  const latestObservedAt =
    input.runs
      .map((r) => r.survival.provenance.observedAt)
      .filter((v): v is string => typeof v === "string")
      .sort()
      .at(-1) ?? null;

  const summary: SurvivalSummaryDTO = {
    formulaVersion: SURVIVAL_V3_FORMULA_VERSION,
    score: survivalScore,
    confidence,
    availableRunCount: scored.length,
    expectedDungeonCount: input.expectedDungeonCount,
    contributorWeights,
    runs: explanations,
    latestObservedAt,
  };

  return {
    summary,
    survivalScore,
    confidence,
    observations,
    activeContributors: [...activeKeys],
  };
}
