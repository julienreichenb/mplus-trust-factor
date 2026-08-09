/**
 * Catalog-guided relevant ability / buff ID collection for capability acquisition.
 * Does not modify offensive catalog content — only reads spellIds, aliases, and
 * optional activation/trigger fields when present on AbilityRule.
 */
import {
  dimensionTagsForRule,
  getAllRegisteredRules,
  ruleResolvableSpellIds,
  type AbilityDimensionTag,
  type AbilityRule,
} from "@mplus/abilities";
import type { EvidenceCapability } from "@mplus/contracts";

const CAPABILITY_DIMENSION_TAGS: Partial<
  Record<EvidenceCapability, readonly AbilityDimensionTag[]>
> = {
  PERFORMANCE_OFFENSIVE_ACTIVATIONS: ["PERFORMANCE_OFFENSIVE_COOLDOWN"],
  SURVIVAL_DEFENSIVE_ACTIVATIONS: ["SURVIVAL_PERSONAL_DEFENSIVE"],
  SURVIVAL_RECOVERY_ACTIVATIONS: ["SURVIVAL_RECOVERY"],
  UTILITY_INTERRUPTS: ["UTILITY_INTERRUPT"],
  UTILITY_DISPELS: ["UTILITY_DISPEL"],
  UTILITY_CROWD_CONTROL: ["UTILITY_CROWD_CONTROL"],
  UTILITY_EXTERNAL_CASTS: ["UTILITY_EXTERNAL", "UTILITY_COMBAT_RES"],
  UTILITY_EXTERNAL_TARGET_CONTEXT: [
    "UTILITY_EXTERNAL",
    "UTILITY_COMBAT_RES",
    "SURVIVAL_PERSONAL_DEFENSIVE",
  ],
};

/** Spell / buff IDs that may appear on Buffs or Casts for a rule. */
export function collectRuleEvidenceSpellIds(rule: AbilityRule): number[] {
  return ruleResolvableSpellIds(rule);
}

export function ruleMatchesCapability(
  rule: AbilityRule,
  capability: EvidenceCapability,
): boolean {
  const wanted = CAPABILITY_DIMENSION_TAGS[capability];
  if (!wanted || wanted.length === 0) return false;
  const tags = dimensionTagsForRule(rule);
  return wanted.some((t) => tags.includes(t));
}

export function collectRelevantAbilityIdsForCapabilities(
  capabilities: readonly EvidenceCapability[],
  rules: readonly AbilityRule[] = getAllRegisteredRules(),
): {
  abilityIds: number[];
  byCapability: Partial<Record<EvidenceCapability, number[]>>;
  ruleCount: number;
} {
  const byCapability: Partial<Record<EvidenceCapability, number[]>> = {};
  const all = new Set<number>();
  let ruleCount = 0;

  for (const capability of capabilities) {
    if (!CAPABILITY_DIMENSION_TAGS[capability]) continue;
    const ids = new Set<number>();
    for (const rule of rules) {
      if (!ruleMatchesCapability(rule, capability)) continue;
      ruleCount += 1;
      for (const id of collectRuleEvidenceSpellIds(rule)) {
        ids.add(id);
        all.add(id);
      }
    }
    byCapability[capability] = [...ids].sort((a, b) => a - b);
  }

  return {
    abilityIds: [...all].sort((a, b) => a - b),
    byCapability,
    ruleCount,
  };
}

/** Union of all digest-relevant ability IDs (production Buff/Cast filters). */
export function collectProductionRelevantAbilityIds(
  rules: readonly AbilityRule[] = getAllRegisteredRules(),
): number[] {
  const caps: EvidenceCapability[] = [
    "PERFORMANCE_OFFENSIVE_ACTIVATIONS",
    "SURVIVAL_DEFENSIVE_ACTIVATIONS",
    "SURVIVAL_RECOVERY_ACTIVATIONS",
    "UTILITY_INTERRUPTS",
    "UTILITY_DISPELS",
    "UTILITY_CROWD_CONTROL",
    "UTILITY_EXTERNAL_CASTS",
    "UTILITY_EXTERNAL_TARGET_CONTEXT",
  ];
  return collectRelevantAbilityIdsForCapabilities(caps, rules).abilityIds;
}
