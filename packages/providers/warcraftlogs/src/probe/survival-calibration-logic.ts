import type { SurvivalMatchedAbilityUsage, SurvivalNormalizedDataset } from "./survival-probe-types.js";
import type {
  SurvivalCalibrationRun,
  SurvivalDefensiveCalibrationUsage,
  SurvivalDungeonCalibrationAggregate,
  SurvivalGlobalCalibrationSummary,
} from "./survival-calibration-types.js";
import type { SurvivalEventDataType } from "./survival-probe-types.js";

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function maximum(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.max(...values);
}

export function equalWeightMean(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

export function perMinute(total: number, durationMs: number): number | null {
  if (durationMs <= 0) return null;
  return total / (durationMs / 60_000);
}

export function deathsPer10Minutes(deathCount: number, durationMs: number): number | null {
  if (durationMs <= 0) return null;
  return deathCount / (durationMs / 600_000);
}

/** Pair apply→remove buff windows; unpaired applies contribute 0 known duration. */
export function computeBuffActiveDurationMs(
  applications: Array<{ timestamp: number | null }>,
  removals: Array<{ timestamp: number | null }>,
  fightEndTime: number,
): number | null {
  const applies = applications
    .map((a) => a.timestamp)
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b);
  const removes = removals
    .map((a) => a.timestamp)
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b);

  if (applies.length === 0 && removes.length === 0) return 0;
  if (applies.length === 0) return null;

  let total = 0;
  let removeIdx = 0;
  for (const start of applies) {
    while (removeIdx < removes.length && removes[removeIdx]! < start) removeIdx += 1;
    const end = removeIdx < removes.length ? removes[removeIdx]! : fightEndTime;
    if (removeIdx < removes.length) removeIdx += 1;
    total += Math.max(0, end - start);
  }
  return total;
}

export function theoreticalMaxUses(
  durationMs: number,
  cooldownSeconds: number | null,
): number | null {
  if (cooldownSeconds == null || cooldownSeconds <= 0 || durationMs <= 0) return null;
  return Math.floor(durationMs / (cooldownSeconds * 1000)) + 1;
}

export function extractPlayerMaxHp(combatantRaw: Record<string, unknown> | null): number | null {
  if (!combatantRaw) return null;
  for (const key of ["maxHitPoints", "maxHp", "hitPoints", "maxHealth"]) {
    const value = combatantRaw[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function countConsumableUses(
  casts: SurvivalMatchedAbilityUsage[],
  healing: SurvivalNormalizedDataset["selfHealingAndConsumables"]["healing"],
  keyIncludes: string,
): number {
  let uses = 0;
  for (const cast of casts) {
    if (cast.canonicalKey.includes(keyIncludes)) uses += cast.castTimestamps.length;
  }
  for (const row of healing) {
    if (row.canonicalKey?.includes(keyIncludes)) uses += row.eventCount;
  }
  return uses;
}

export function enrichSurvivalCalibrationRun(input: {
  normalized: SurvivalNormalizedDataset;
  timed: boolean | null;
  depleted: boolean | null;
  completed: boolean | null;
  score: number | null;
  missingDatasets: SurvivalEventDataType[];
}): SurvivalCalibrationRun {
  const { normalized } = input;
  const durationMs = normalized.run.durationMs;
  const deathCount = normalized.deaths.playerDeathCount;
  const totalDamage = normalized.damageTaken.totalDamageTaken;
  const absorbed = normalized.damageTaken.totalAbsorbed;
  const unabsorbed = Math.max(0, totalDamage);
  // WCL amount is typically post-mitigation damage taken; absorbed is tracked separately.
  // Unabsorbed damage ≈ amount (damage that hit HP). Absorbed ratio = absorbed / (amount + absorbed).
  const grossIncoming = totalDamage + absorbed;
  const absorbedRatio = grossIncoming > 0 ? absorbed / grossIncoming : null;

  const maxHp = extractPlayerMaxHp(normalized.combatantInfo.raw);

  const defensives: SurvivalDefensiveCalibrationUsage[] = normalized.defensiveUsage.map((u) => {
    const castCount = u.castTimestamps.length;
    const activeDurationMs = computeBuffActiveDurationMs(
      u.buffApplications,
      u.buffRemovals,
      normalized.run.endTime,
    );
    const theo = theoreticalMaxUses(durationMs, u.cooldownSeconds);
    const ratio = theo != null && theo > 0 ? castCount / theo : null;
    return {
      canonicalKey: u.canonicalKey,
      category: u.category,
      spellId: u.spellId,
      name: u.name,
      availability: u.availability,
      talentDependentOrUncertain: u.talentDependentOrUncertain,
      castCount,
      activeDurationMs,
      cooldownSeconds: u.cooldownSeconds,
      theoreticalMaxUses: theo,
      observedUsageRatio: ratio,
      note:
        "theoreticalMaxUses / observedUsageRatio are diagnostic only — not a valid opportunity score.",
    };
  });

  const matchedCasts = normalized.selfHealingAndConsumables.consumableAndSelfHealCasts;
  const healing = normalized.selfHealingAndConsumables.healing;
  const selfHealingAmount = healing.reduce((sum, h) => sum + h.totalAmount, 0);
  const healthstoneUses = countConsumableUses(matchedCasts, healing, "healthstone");
  const healingPotionUses = countConsumableUses(matchedCasts, healing, "healing-potion");

  return {
    runId: `${normalized.run.reportCode}:${normalized.run.fightId}`,
    dungeonSlug: normalized.run.dungeonSlug,
    reportCode: normalized.run.reportCode,
    fightId: normalized.run.fightId,
    keyLevel: normalized.run.keyLevel,
    timed: input.timed,
    depleted: input.depleted,
    completed: input.completed,
    durationMs,
    playerActorId: normalized.run.playerActorId,
    ownedPetActorIds: normalized.run.ownedPetActorIds,
    specialization: normalized.combatantInfo.specialization,
    specId: normalized.combatantInfo.specId,
    itemLevel: normalized.combatantInfo.itemLevel,
    score: input.score,
    encounterId: normalized.run.encounterId,
    encounterName: normalized.run.encounterName,
    deaths: {
      deathCount,
      deathTimestamps: normalized.deaths.deathTimestamps,
      deathsPerRun: deathCount,
      deathsPer10Minutes: deathsPer10Minutes(deathCount, durationMs),
      deaths: normalized.deaths.deaths,
    },
    damageTaken: {
      totalDamageTaken: totalDamage,
      damageTakenPerMinute: perMinute(totalDamage, durationMs),
      absorbedAmount: absorbed,
      unabsorbedDamage: unabsorbed,
      unabsorbedDamagePerMinute: perMinute(unabsorbed, durationMs),
      absorbedRatio,
      byAbility: normalized.damageTaken.byAbility,
      bySource: normalized.damageTaken.bySource,
      playerMaxHp: maxHp,
      damageNormalizedByMaxHp: maxHp != null && maxHp > 0 ? totalDamage / maxHp : null,
      avoidableClassification: null,
    },
    defensives,
    consumablesAndSelfHealing: {
      healthstoneUses,
      healingPotionUses,
      selfHealingAmount,
      selfHealingPerMinute: perMinute(selfHealingAmount, durationMs),
      selfHealingPercentOfIncomingDamage:
        grossIncoming > 0 ? (selfHealingAmount / grossIncoming) * 100 : null,
      healingBySpell: healing,
      matchedCasts,
    },
    normalized,
    missingDatasets: input.missingDatasets,
    unmatchedSpellIds: normalized.abilityCatalog.unmatchedSpellIds,
    ambiguousSpellIds: normalized.abilityCatalog.ambiguousSpellIds,
  };
}

export function aggregateDungeonCalibration(
  dungeonSlug: string,
  runs: SurvivalCalibrationRun[],
): SurvivalDungeonCalibrationAggregate {
  const deathRates = runs
    .map((r) => r.deaths.deathsPer10Minutes)
    .filter((v): v is number => v != null);
  const dpm = runs
    .map((r) => r.damageTaken.damageTakenPerMinute)
    .filter((v): v is number => v != null);
  const udpm = runs
    .map((r) => r.damageTaken.unabsorbedDamagePerMinute)
    .filter((v): v is number => v != null);
  const absorbed = runs
    .map((r) => r.damageTaken.absorbedRatio)
    .filter((v): v is number => v != null);

  let totalCasts = 0;
  let baselineCasts = 0;
  let talentCasts = 0;
  const ratios: number[] = [];
  const abilityKeys = new Set<string>();
  for (const run of runs) {
    for (const d of run.defensives) {
      abilityKeys.add(d.canonicalKey);
      totalCasts += d.castCount;
      if (d.talentDependentOrUncertain) talentCasts += d.castCount;
      else baselineCasts += d.castCount;
      if (d.observedUsageRatio != null) ratios.push(d.observedUsageRatio);
    }
  }

  const selfHealPpm = runs
    .map((r) => r.consumablesAndSelfHealing.selfHealingPerMinute)
    .filter((v): v is number => v != null);

  return {
    dungeonSlug,
    runCount: runs.length,
    runIds: runs.map((r) => r.runId),
    deathRateMedian: median(deathRates),
    deathRateMaximum: maximum(deathRates),
    damageTakenPerMinuteMedian: median(dpm),
    unabsorbedDamagePerMinuteMedian: median(udpm),
    absorbedRatioMedian: median(absorbed),
    defensiveUsageSummary: {
      abilityCount: abilityKeys.size,
      totalCasts,
      baselineCasts,
      talentDependentOrUncertainCasts: talentCasts,
      medianObservedUsageRatio: median(ratios),
    },
    consumableUsageFrequency: {
      runsWithHealthstone: runs.filter((r) => r.consumablesAndSelfHealing.healthstoneUses > 0)
        .length,
      runsWithHealingPotion: runs.filter((r) => r.consumablesAndSelfHealing.healingPotionUses > 0)
        .length,
      healthstoneUsesTotal: runs.reduce(
        (s, r) => s + r.consumablesAndSelfHealing.healthstoneUses,
        0,
      ),
      healingPotionUsesTotal: runs.reduce(
        (s, r) => s + r.consumablesAndSelfHealing.healingPotionUses,
        0,
      ),
      medianSelfHealingPerMinute: median(selfHealPpm),
    },
  };
}

export function buildGlobalCalibrationSummary(
  perDungeon: SurvivalDungeonCalibrationAggregate[],
  expectedDungeonSlugs: string[],
): SurvivalGlobalCalibrationSummary {
  const withRuns = perDungeon.filter((d) => d.runCount > 0);
  const sampleSizeByDungeon: Record<string, number> = {};
  for (const slug of expectedDungeonSlugs) {
    sampleSizeByDungeon[slug] = perDungeon.find((d) => d.dungeonSlug === slug)?.runCount ?? 0;
  }
  const missing = expectedDungeonSlugs.filter((s) => (sampleSizeByDungeon[s] ?? 0) === 0);

  return {
    dungeonCount: withRuns.length,
    totalRuns: withRuns.reduce((s, d) => s + d.runCount, 0),
    equalWeightAverages: {
      deathRateMedian: equalWeightMean(withRuns.map((d) => d.deathRateMedian)),
      damageTakenPerMinuteMedian: equalWeightMean(
        withRuns.map((d) => d.damageTakenPerMinuteMedian),
      ),
      unabsorbedDamagePerMinuteMedian: equalWeightMean(
        withRuns.map((d) => d.unabsorbedDamagePerMinuteMedian),
      ),
      absorbedRatioMedian: equalWeightMean(withRuns.map((d) => d.absorbedRatioMedian)),
    },
    coverage: {
      expectedDungeonCount: expectedDungeonSlugs.length,
      dungeonsWithRuns: withRuns.length,
      dungeonsMissingRuns: missing,
      sampleSizeByDungeon,
    },
    note:
      "Equal-weight averages across dungeons with ≥1 run. Coverage/sample sizes are separate. No Survival score is calculated.",
  };
}
