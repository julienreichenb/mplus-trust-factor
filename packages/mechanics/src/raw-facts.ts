import type {
  AbilityCatalog,
  AbilityCategory,
} from "./ability-types.js";
import { resolveEffectiveCooldownMs } from "./ability-types.js";
import {
  type ScoringMechanicCatalog,
  isAvoidableAbility,
} from "./scoring-mechanic-types.js";
import { indexAbilityRulesBySpellId } from "./catalog-loader.js";

/** Minimal event shapes — keep extractors free of provider coupling. */
export interface RawCastLike {
  abilityGameId: number;
  sourceId: number;
  targetId: number | null;
}

export interface RawInterruptLike {
  abilityGameId: number;
  sourceId: number;
}

export interface RawDeathLike {
  targetId: number;
}

export interface RawDamageTakenLike {
  targetId: number;
  abilityGameId: number;
  amount: number;
  sourceId?: number | null;
}

export interface RawHealingLike {
  abilityGameId: number;
  sourceId: number;
  targetId: number;
  amount: number;
  overheal: number | null;
}

export interface RawDispelLike {
  abilityGameId: number;
  sourceId: number;
  targetId: number;
}

export interface RawAuraLike {
  abilityGameId: number;
  sourceId: number;
  targetId: number;
}

export interface ExtractRawFactsInput {
  seasonSlug: string;
  dungeonSlug: string;
  targetSourceId: number;
  /** Player + attributed pets. */
  attributedSourceIds: ReadonlySet<number>;
  /** Hostile actor ids (for distinct CC target counting). */
  hostileTargetIds?: ReadonlySet<number>;
  maxHealth: number | null;
  talentIds?: ReadonlySet<number>;
  abilityCatalog: AbilityCatalog;
  mechanicCatalog: ScoringMechanicCatalog;
  casts: RawCastLike[];
  interrupts: RawInterruptLike[];
  deaths: RawDeathLike[];
  damageTaken: RawDamageTakenLike[];
  healing: RawHealingLike[];
  dispels: RawDispelLike[];
  auras?: RawAuraLike[];
  classSlug?: string | null;
  specSlug?: string | null;
}

export interface ExtractedSurvivalCounts {
  deaths: number;
  totalDamageTaken: number;
  avoidableDamageTaken: number;
  classifiedDamageEvents: number;
  damageEvents: number;
  personalDefensiveCasts: number;
  selfHealEffective: number;
  selfHealOverheal: number;
  healthPotionCasts: number;
  maxHealth: number | null;
  avoidableDamageCoverageRatio: number;
}

export interface ExtractedUtilityCounts {
  kickCasts: number;
  successfulInterrupts: number;
  effectiveKickCooldownMs: number | null;
  distinctCcTargets: number;
  groupSupportCasts: number;
  defensiveDispels: number;
  offensiveDispels: number;
}

function rulesForCast(
  bySpell: Map<number, import("./ability-types.js").AbilityRule[]>,
  spellId: number,
  classSlug: string | null | undefined,
  specSlug: string | null | undefined,
  category: AbilityCategory,
) {
  return (bySpell.get(spellId) ?? []).filter((rule) => {
    if (!rule.categories.includes(category)) return false;
    if (rule.classSlug !== "*" && classSlug && rule.classSlug !== classSlug) return false;
    if (rule.specSlugs && specSlug && !rule.specSlugs.includes(specSlug)) return false;
    return true;
  });
}

export function extractSurvivalCounts(input: ExtractRawFactsInput): ExtractedSurvivalCounts {
  const bySpell = indexAbilityRulesBySpellId(input.abilityCatalog);
  const deaths = input.deaths.filter((e) => e.targetId === input.targetSourceId).length;

  let totalDamageTaken = 0;
  let avoidableDamageTaken = 0;
  let classifiedDamageEvents = 0;
  const playerDamage = input.damageTaken.filter((e) => e.targetId === input.targetSourceId);
  for (const event of playerDamage) {
    totalDamageTaken += event.amount;
    const matched = isAvoidableAbility(input.mechanicCatalog, {
      seasonSlug: input.seasonSlug,
      dungeonSlug: input.dungeonSlug,
      abilityId: event.abilityGameId,
    });
    const known = input.mechanicCatalog.rules.some(
      (r) =>
        r.abilityId === event.abilityGameId &&
        (r.seasonSlug === input.seasonSlug || r.seasonSlug === "*") &&
        (r.dungeonSlug === input.dungeonSlug || r.dungeonSlug === "*"),
    );
    if (known) classifiedDamageEvents += 1;
    if (matched) avoidableDamageTaken += event.amount;
  }

  let personalDefensiveCasts = 0;
  let healthPotionCasts = 0;
  for (const cast of input.casts) {
    if (!input.attributedSourceIds.has(cast.sourceId)) continue;
    if (
      rulesForCast(bySpell, cast.abilityGameId, input.classSlug, input.specSlug, "personal_defensive")
        .length > 0
    ) {
      personalDefensiveCasts += 1;
    }
    if (
      rulesForCast(bySpell, cast.abilityGameId, input.classSlug, input.specSlug, "health_potion")
        .length > 0
    ) {
      healthPotionCasts += 1;
    }
  }

  let selfHealEffective = 0;
  let selfHealOverheal = 0;
  for (const heal of input.healing) {
    if (!input.attributedSourceIds.has(heal.sourceId)) continue;
    if (heal.targetId !== input.targetSourceId) continue;
    const selfHealRules = rulesForCast(
      bySpell,
      heal.abilityGameId,
      input.classSlug,
      input.specSlug,
      "self_heal",
    );
    const potionRules = rulesForCast(
      bySpell,
      heal.abilityGameId,
      input.classSlug,
      input.specSlug,
      "health_potion",
    );
    if (selfHealRules.length === 0 && potionRules.length === 0) continue;
    selfHealEffective += heal.amount;
    selfHealOverheal += heal.overheal ?? 0;
  }

  const avoidableDamageCoverageRatio =
    playerDamage.length === 0 ? 1 : classifiedDamageEvents / playerDamage.length;

  return {
    deaths,
    totalDamageTaken,
    avoidableDamageTaken,
    classifiedDamageEvents,
    damageEvents: playerDamage.length,
    personalDefensiveCasts,
    selfHealEffective,
    selfHealOverheal,
    healthPotionCasts,
    maxHealth: input.maxHealth,
    avoidableDamageCoverageRatio,
  };
}

export function extractUtilityCounts(input: ExtractRawFactsInput): ExtractedUtilityCounts {
  const bySpell = indexAbilityRulesBySpellId(input.abilityCatalog);
  const talentIds = input.talentIds ?? new Set<number>();

  let kickCasts = 0;
  let effectiveKickCooldownMs: number | null = null;
  let groupSupportCasts = 0;
  const ccTargets = new Set<number>();

  for (const cast of input.casts) {
    if (!input.attributedSourceIds.has(cast.sourceId)) continue;
    const interruptRules = rulesForCast(
      bySpell,
      cast.abilityGameId,
      input.classSlug,
      input.specSlug,
      "interrupt",
    );
    if (interruptRules.length > 0) {
      kickCasts += 1;
      for (const rule of interruptRules) {
        const cd = resolveEffectiveCooldownMs(rule, talentIds);
        if (cd != null) {
          effectiveKickCooldownMs =
            effectiveKickCooldownMs == null ? cd : Math.min(effectiveKickCooldownMs, cd);
        }
      }
    }
    const ccRules = rulesForCast(
      bySpell,
      cast.abilityGameId,
      input.classSlug,
      input.specSlug,
      "crowd_control",
    );
    if (ccRules.length > 0 && cast.targetId != null) {
      if (!input.hostileTargetIds || input.hostileTargetIds.has(cast.targetId)) {
        if (cast.targetId !== input.targetSourceId) ccTargets.add(cast.targetId);
      }
    }
    if (
      rulesForCast(bySpell, cast.abilityGameId, input.classSlug, input.specSlug, "group_support")
        .length > 0
    ) {
      groupSupportCasts += 1;
    }
  }

  // Also count CC from aura applies when casts lack targets.
  for (const aura of input.auras ?? []) {
    if (!input.attributedSourceIds.has(aura.sourceId)) continue;
    const ccRules = rulesForCast(
      bySpell,
      aura.abilityGameId,
      input.classSlug,
      input.specSlug,
      "crowd_control",
    );
    if (ccRules.length === 0) continue;
    if (aura.targetId === input.targetSourceId) continue;
    if (input.hostileTargetIds && !input.hostileTargetIds.has(aura.targetId)) continue;
    ccTargets.add(aura.targetId);
  }

  const successfulInterrupts = input.interrupts.filter((e) =>
    input.attributedSourceIds.has(e.sourceId),
  ).length;

  let defensiveDispels = 0;
  let offensiveDispels = 0;
  for (const dispel of input.dispels) {
    if (!input.attributedSourceIds.has(dispel.sourceId)) continue;
    const def = rulesForCast(
      bySpell,
      dispel.abilityGameId,
      input.classSlug,
      input.specSlug,
      "defensive_dispel",
    );
    const off = rulesForCast(
      bySpell,
      dispel.abilityGameId,
      input.classSlug,
      input.specSlug,
      "offensive_dispel",
    );
    if (def.length > 0) defensiveDispels += 1;
    else if (off.length > 0) offensiveDispels += 1;
    else if (dispel.targetId === input.targetSourceId || input.attributedSourceIds.has(dispel.targetId)) {
      // Unknown dispel ability on friendly target — count as defensive candidate with low certainty upstream.
      defensiveDispels += 1;
    } else {
      offensiveDispels += 1;
    }
  }

  return {
    kickCasts,
    successfulInterrupts,
    effectiveKickCooldownMs,
    distinctCcTargets: ccTargets.size,
    groupSupportCasts,
    defensiveDispels,
    offensiveDispels,
  };
}
