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
import {
  resolveInterruptAbility,
  resolveUtilityCapability,
  type ResolvedInterrupt,
  type UtilityCapability,
} from "./utility-capability.js";

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
  /** Friendly party/raid actor ids (for group-support usage confirmation). */
  friendlyTargetIds?: ReadonlySet<number>;
  maxHealth: number | null;
  talentIds?: ReadonlySet<number>;
  /** Active pet slug when known (felhunter / imp / …). */
  activePet?: string | null;
  /** Fight duration — used only for evidence; scoring estimates windows. */
  runDurationMs?: number | null;
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

/** How group-support evidence was observed for this run. */
export type GroupSupportEvidenceMode = "cast_only" | "confirmed_party_usage" | "none";

export interface ExtractedUtilityCounts {
  kickCasts: number;
  successfulInterrupts: number;
  effectiveKickCooldownMs: number | null;
  distinctCcTargets: number;
  groupSupportCasts: number;
  /** Distinct friendly actors that received a catalogued group-support aura/buff. */
  groupSupportConfirmedUsages: number;
  groupSupportEvidenceMode: GroupSupportEvidenceMode;
  defensiveDispels: number;
  offensiveDispels: number;
  /** Spec-level capability + catalog spell coverage for explanations. */
  capability: UtilityCapability;
  resolvedInterrupt: ResolvedInterrupt;
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
  const capability = resolveUtilityCapability({
    abilityCatalog: input.abilityCatalog,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    talentIds,
  });
  const resolvedInterrupt = resolveInterruptAbility({
    abilityCatalog: input.abilityCatalog,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    talentIds,
    activePet: input.activePet,
  });
  const interruptSpellIds = new Set(
    resolvedInterrupt.spellIds.length > 0
      ? resolvedInterrupt.spellIds
      : capability.catalogCoverage.interruptSpellIds,
  );

  let kickCasts = 0;
  let effectiveKickCooldownMs = resolvedInterrupt.effectiveCooldownMs;
  let groupSupportCasts = 0;
  const ccTargets = new Set<number>();
  const groupSupportRecipients = new Set<number>();

  for (const cast of input.casts) {
    if (!input.attributedSourceIds.has(cast.sourceId)) continue;

    const interruptRules = rulesForCast(
      bySpell,
      cast.abilityGameId,
      input.classSlug,
      input.specSlug,
      "interrupt",
    );
    if (interruptRules.length > 0 && interruptSpellIds.has(cast.abilityGameId)) {
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
    if (ccRules.length > 0) {
      if (aura.targetId === input.targetSourceId) continue;
      if (input.hostileTargetIds && !input.hostileTargetIds.has(aura.targetId)) continue;
      ccTargets.add(aura.targetId);
    }

    // Confirmed party usage: group-support aura applied to a friendly (non-self) actor.
    const supportRules = rulesForCast(
      bySpell,
      aura.abilityGameId,
      input.classSlug,
      input.specSlug,
      "group_support",
    );
    if (supportRules.length > 0 && aura.targetId !== input.targetSourceId) {
      const friendly =
        !input.friendlyTargetIds || input.friendlyTargetIds.has(aura.targetId);
      const notHostile = !input.hostileTargetIds || !input.hostileTargetIds.has(aura.targetId);
      if (friendly && notHostile) {
        groupSupportRecipients.add(aura.targetId);
      }
    }
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
    if (def.length > 0) {
      defensiveDispels += 1;
      continue;
    }
    if (off.length > 0) {
      offensiveDispels += 1;
      continue;
    }
    // Uncatalogued dispel: classify only when the spec has matching capability and
    // the target side is consistent. Never invent offensive credit without rules.
    const onFriendly =
      dispel.targetId === input.targetSourceId ||
      input.attributedSourceIds.has(dispel.targetId) ||
      (input.friendlyTargetIds?.has(dispel.targetId) ?? false);
    if (capability.defensiveDispels && onFriendly) {
      defensiveDispels += 1;
    } else if (capability.offensiveDispels && !onFriendly) {
      offensiveDispels += 1;
    }
    // else: ignore — no matching capability or target side
  }

  const groupSupportConfirmedUsages = groupSupportRecipients.size;
  let groupSupportEvidenceMode: GroupSupportEvidenceMode = "none";
  if (groupSupportConfirmedUsages > 0) {
    groupSupportEvidenceMode = "confirmed_party_usage";
  } else if (groupSupportCasts > 0) {
    groupSupportEvidenceMode = "cast_only";
  }

  return {
    kickCasts,
    successfulInterrupts,
    effectiveKickCooldownMs,
    distinctCcTargets: ccTargets.size,
    groupSupportCasts,
    groupSupportConfirmedUsages,
    groupSupportEvidenceMode,
    defensiveDispels,
    offensiveDispels,
    capability,
    resolvedInterrupt,
  };
}
