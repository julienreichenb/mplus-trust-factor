import type { AbilityAvailability, AbilityCategory } from "@mplus/abilities";
import type { RunCombatFacts } from "../types.js";
import type { SurvivalCalibrationRun } from "../probe/survival-calibration-types.js";
import type {
  SurvivalNormalizedDataset,
  SurvivalPreservedEvent,
  SurvivalDeathFact,
  SurvivalMatchedAbilityUsage,
} from "../probe/survival-probe-types.js";
import { rulesForSpell } from "@mplus/abilities";
import type { AbilityCatalog } from "@mplus/abilities";

function toPreserved(
  partial: Partial<SurvivalPreservedEvent> & { timestamp: number },
): SurvivalPreservedEvent {
  return {
    timestamp: partial.timestamp,
    sourceID: partial.sourceID ?? null,
    targetID: partial.targetID ?? null,
    abilityGameID: partial.abilityGameID ?? null,
    amount: partial.amount ?? 0,
    absorbed: partial.absorbed ?? 0,
    overkill: partial.overkill ?? null,
    hitType: partial.hitType ?? null,
    additionalFields: partial.additionalFields ?? {},
    raw: partial.raw ?? {},
  };
}

/**
 * Build a SurvivalCalibrationRun from production RunCombatFacts for V1.1.1 scoring.
 * Does not invent max HP — health snapshots must be supplied separately via includeResources.
 */
export function combatFactsToSurvivalCalibrationRun(input: {
  facts: RunCombatFacts;
  dungeonSlug: string;
  keyLevel: number | null;
  durationMs: number;
  startTime?: number;
  endTime?: number;
  specialization?: string | null;
  specId?: number | null;
  catalog: AbilityCatalog;
  classSlug: string | null;
}): SurvivalCalibrationRun {
  const { facts, catalog, classSlug } = input;
  const playerActorId = facts.targetSourceId;
  const startTime = input.startTime ?? 0;
  const endTime = input.endTime ?? input.durationMs;
  const runId = `${facts.reportCode}:${facts.fightId}`;

  const damageEvents = facts.damageTaken.map((d) =>
    toPreserved({
      timestamp: d.timestamp,
      sourceID: d.sourceId,
      targetID: playerActorId,
      abilityGameID: d.abilityGameId,
      amount: d.amount,
      absorbed: 0,
      overkill: null,
      raw: d as unknown as Record<string, unknown>,
    }),
  );

  const deaths: SurvivalDeathFact[] = facts.deaths
    .filter((d) => d.targetId === playerActorId || d.sourceId === playerActorId)
    .map((d) => ({
      timestamp: d.timestamp,
      killingAbilityGameId: d.abilityGameId ?? null,
      killingSourceId: d.sourceId ?? null,
      overkill: null,
      event: toPreserved({
        timestamp: d.timestamp,
        sourceID: d.sourceId,
        targetID: d.targetId,
        abilityGameID: d.abilityGameId,
      }),
    }));

  // Defensive usage from casts + auras matched to catalog
  const defensiveCategories = new Set(["DEFENSIVE_MAJOR", "DEFENSIVE_MINOR", "IMMUNITY"]);
  const byKey = new Map<string, SurvivalMatchedAbilityUsage>();

  for (const cast of facts.casts) {
    if (!facts.attributedSourceIds.includes(cast.sourceId)) continue;
    const rules = rulesForSpell(catalog, cast.abilityGameId).filter((r) =>
      defensiveCategories.has(r.category),
    );
    const rule = rules[0];
    if (!rule) continue;
    const existing = byKey.get(rule.canonicalKey) ?? {
      canonicalKey: rule.canonicalKey,
      category: rule.category as AbilityCategory,
      spellId: cast.abilityGameId,
      name: rule.name,
      sourceOwnership: "PLAYER" as const,
      cooldownSeconds: rule.cooldownSeconds ?? null,
      availability: rule.availability as AbilityAvailability,
      talentDependentOrUncertain:
        rule.availability === "TALENT" || rule.availability === "CHOICE_NODE",
      castTimestamps: [],
      buffApplications: [],
      buffRemovals: [],
      sourceActorIds: [cast.sourceId],
    };
    existing.castTimestamps.push(cast.timestamp);
    byKey.set(rule.canonicalKey, existing);
  }

  for (const aura of facts.auras) {
    if (aura.targetId !== playerActorId && aura.sourceId !== playerActorId) continue;
    const rules = rulesForSpell(catalog, aura.abilityGameId).filter((r) =>
      defensiveCategories.has(r.category),
    );
    const rule = rules[0];
    if (!rule) continue;
    const existing = byKey.get(rule.canonicalKey) ?? {
      canonicalKey: rule.canonicalKey,
      category: rule.category as AbilityCategory,
      spellId: aura.abilityGameId,
      name: rule.name,
      sourceOwnership: "PLAYER" as const,
      cooldownSeconds: rule.cooldownSeconds ?? null,
      availability: rule.availability as AbilityAvailability,
      talentDependentOrUncertain:
        rule.availability === "TALENT" || rule.availability === "CHOICE_NODE",
      castTimestamps: [],
      buffApplications: [],
      buffRemovals: [],
      sourceActorIds: [aura.sourceId],
    };
    if (aura.type === "apply" || aura.type === "refresh") {
      existing.buffApplications.push({
        timestamp: aura.timestamp,
        type: aura.type,
        sourceID: aura.sourceId,
        targetID: aura.targetId,
      });
    } else if (aura.type === "remove") {
      existing.buffRemovals.push({
        timestamp: aura.timestamp,
        type: aura.type,
        sourceID: aura.sourceId,
        targetID: aura.targetId,
      });
    }
    byKey.set(rule.canonicalKey, existing);
  }

  // Healing aggregated by spell
  const healBySpell = new Map<
    number,
    {
      spellId: number;
      totalAmount: number;
      totalOverheal: number;
      eventCount: number;
      timestamps: number[];
      canonicalKey: string | null;
      category: AbilityCategory | null;
    }
  >();
  for (const h of facts.healing) {
    if (h.sourceId !== playerActorId && !facts.attributedSourceIds.includes(h.sourceId)) {
      continue;
    }
    if (h.targetId !== playerActorId) continue;
    const rules = rulesForSpell(catalog, h.abilityGameId);
    const rule = rules[0] ?? null;
    const row = healBySpell.get(h.abilityGameId) ?? {
      spellId: h.abilityGameId,
      totalAmount: 0,
      totalOverheal: 0,
      eventCount: 0,
      timestamps: [],
      canonicalKey: rule?.canonicalKey ?? null,
      category: (rule?.category as AbilityCategory | null) ?? null,
    };
    row.totalAmount += h.amount;
    row.totalOverheal += h.overheal ?? 0;
    row.eventCount += 1;
    row.timestamps.push(h.timestamp);
    healBySpell.set(h.abilityGameId, row);
  }

  const normalized: SurvivalNormalizedDataset = {
    probeVersion: "1",
    probedAt: new Date().toISOString(),
    identity: { region: "EU", realmSlug: "unknown", name: "unknown" },
    run: {
      dungeonSlug: input.dungeonSlug,
      reportCode: facts.reportCode,
      fightId: facts.fightId,
      playerActorId,
      ownedPetActorIds: facts.attributedSourceIds.filter((id) => id !== playerActorId),
      startTime,
      endTime,
      durationMs: input.durationMs,
      keyLevel: input.keyLevel,
      encounterId: null,
      encounterName: null,
      wclCharacterId: 0,
      wclCanonicalId: 0,
    },
    deaths: {
      playerDeathCount: deaths.length,
      deathTimestamps: deaths.map((d) => d.timestamp!).filter((t) => t != null),
      deaths,
    },
    damageTaken: {
      totalDamageTaken: damageEvents.reduce((s, e) => s + (e.amount ?? 0), 0),
      totalAbsorbed: damageEvents.reduce((s, e) => s + (e.absorbed ?? 0), 0),
      byAbility: [],
      bySource: [],
      events: damageEvents,
      avoidableClassification: null,
    },
    defensiveUsage: [...byKey.values()],
    selfHealingAndConsumables: {
      healing: [...healBySpell.values()].map((h) => ({
        spellId: h.spellId,
        canonicalKey: h.canonicalKey,
        category: h.category,
        catalogMatched: h.canonicalKey != null,
        ambiguous: false,
        eventCount: h.eventCount,
        totalAmount: h.totalAmount,
        totalOverheal: h.totalOverheal,
        timestamps: h.timestamps,
      })),
      consumableAndSelfHealCasts: [],
    },
    combatantInfo: {
      specialization: input.specialization ?? null,
      specId: input.specId ?? facts.combatantInfo?.specId ?? null,
      talents: null,
      gear: null,
      itemLevel: null,
      raw: (facts.combatantInfo as unknown as Record<string, unknown>) ?? null,
    },
    abilityCatalog: {
      catalogVersion: catalog.catalogVersion,
      classSlug,
      specSlug: input.specialization ?? null,
      supported: catalog.supported,
      matchedSpellIds: [],
      unmatchedSpellIds: [],
      ambiguousSpellIds: [],
    },
  };

  return {
    runId,
    dungeonSlug: input.dungeonSlug,
    reportCode: facts.reportCode,
    fightId: facts.fightId,
    keyLevel: input.keyLevel,
    timed: null,
    depleted: null,
    completed: true,
    durationMs: input.durationMs,
    playerActorId,
    ownedPetActorIds: normalized.run.ownedPetActorIds,
    specialization: input.specialization ?? null,
    specId: input.specId ?? null,
    itemLevel: null,
    score: null,
    encounterId: null,
    encounterName: null,
    deaths: {
      deathCount: deaths.length,
      deathTimestamps: normalized.deaths.deathTimestamps,
      deathsPerRun: deaths.length,
      deathsPer10Minutes: null,
      deaths,
    },
    damageTaken: {
      totalDamageTaken: normalized.damageTaken.totalDamageTaken,
      damageTakenPerMinute: null,
      absorbedAmount: normalized.damageTaken.totalAbsorbed,
      unabsorbedDamage:
        normalized.damageTaken.totalDamageTaken - normalized.damageTaken.totalAbsorbed,
      unabsorbedDamagePerMinute: null,
      absorbedRatio: null,
      byAbility: [],
      bySource: [],
      playerMaxHp: null,
      damageNormalizedByMaxHp: null,
      avoidableClassification: null,
    },
    defensives: [...byKey.values()].map((u) => ({
      canonicalKey: u.canonicalKey,
      category: u.category,
      spellId: u.spellId,
      name: u.name,
      availability: u.availability,
      talentDependentOrUncertain: u.talentDependentOrUncertain,
      castCount: u.castTimestamps.length,
      activeDurationMs: null,
      cooldownSeconds: u.cooldownSeconds,
      theoreticalMaxUses: null,
      observedUsageRatio: null,
      note: "Usage ratio unavailable because this production fact set has no verified cooldown opportunity window.",
    })),
    consumablesAndSelfHealing: {
      healthstoneUses: 0,
      healingPotionUses: 0,
      selfHealingAmount: [...healBySpell.values()].reduce((s, h) => s + h.totalAmount, 0),
      selfHealingPerMinute: null,
      selfHealingPercentOfIncomingDamage: null,
      healingBySpell: normalized.selfHealingAndConsumables.healing,
      matchedCasts: [],
    },
    normalized,
    missingDatasets: [],
    unmatchedSpellIds: [],
    ambiguousSpellIds: [],
  };
}
