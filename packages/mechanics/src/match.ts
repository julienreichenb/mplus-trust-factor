import type { MechanicCatalog, MechanicRule, MechanicRuleType, Role } from "./types.js";

export interface MechanicMatchQuery {
  seasonSlug: string;
  dungeonSlug: string;
  spellId: number;
  npcId?: number | null;
  role?: Role;
  ruleTypes?: MechanicRuleType[];
  activeOnly?: boolean;
}

/**
 * Match rules by season/dungeon/spell/(optional NPC)/role.
 * Unknown spells yield an empty list — callers must never treat that as avoidable.
 */
export function matchMechanicRules(
  catalog: MechanicCatalog,
  query: MechanicMatchQuery,
): MechanicRule[] {
  const activeOnly = query.activeOnly !== false;
  return catalog.rules.filter((rule) => {
    if (activeOnly && !rule.active) return false;
    if (rule.seasonSlug !== query.seasonSlug) return false;
    if (rule.dungeonSlug !== query.dungeonSlug && rule.dungeonSlug !== "*") return false;
    if (rule.spellId !== query.spellId) return false;
    if (rule.npcId != null && query.npcId != null && rule.npcId !== query.npcId) return false;
    if (query.role && !rule.applicableRoles.includes(query.role)) return false;
    if (query.ruleTypes && !query.ruleTypes.includes(rule.ruleType)) return false;
    return true;
  });
}

export type DamageClassification =
  | "AVOIDABLE"
  | "MANDATORY"
  | "SOAK"
  | "UNKNOWN";

/**
 * Classify a damage event. Returns UNKNOWN when no rule matches.
 * Never classifies unknown damage as avoidable.
 */
export function classifyDamageEvent(
  catalog: MechanicCatalog,
  query: Omit<MechanicMatchQuery, "ruleTypes">,
): { classification: DamageClassification; matched: MechanicRule[] } {
  const matched = matchMechanicRules(catalog, {
    ...query,
    ruleTypes: ["AVOIDABLE_DAMAGE", "MANDATORY_DAMAGE", "SOAK"],
  });
  if (matched.length === 0) {
    return { classification: "UNKNOWN", matched: [] };
  }
  if (matched.some((r) => r.ruleType === "AVOIDABLE_DAMAGE")) {
    return { classification: "AVOIDABLE", matched };
  }
  if (matched.some((r) => r.ruleType === "SOAK")) {
    return { classification: "SOAK", matched };
  }
  return { classification: "MANDATORY", matched };
}
