export type MechanicRuleType =
  | "AVOIDABLE_DAMAGE"
  | "MANDATORY_DAMAGE"
  | "PRIORITY_INTERRUPT"
  | "CROWD_CONTROL"
  | "DISPEL"
  | "PURGE"
  | "DEFENSIVE_WINDOW"
  | "EXTERNAL_WINDOW";

export interface MechanicRuleDraft {
  seasonSlug: string;
  dungeonSlug: string;
  npcId: number | null;
  spellId: number;
  ruleType: MechanicRuleType;
  severity: number;
  applicableRoles: Array<"DPS" | "TANK" | "HEALER">;
  responseSpellIds: number[];
  notes: string | null;
  source: string;
  version: string;
  active: boolean;
}

/** Catalog abstractions only — concrete season rules owned with Agent 4. */
export function validateMechanicRuleDraft(rule: MechanicRuleDraft): string[] {
  const errors: string[] = [];
  if (!rule.seasonSlug) errors.push("seasonSlug is required");
  if (!rule.dungeonSlug) errors.push("dungeonSlug is required");
  if (!Number.isFinite(rule.spellId)) errors.push("spellId is required");
  if (rule.severity < 0) errors.push("severity must be >= 0");
  return errors;
}
