export type Role = "DPS" | "TANK" | "HEALER";

export type MechanicRuleType =
  | "AVOIDABLE_DAMAGE"
  | "MANDATORY_DAMAGE"
  | "SOAK"
  | "PRIORITY_INTERRUPT"
  | "CROWD_CONTROL"
  | "DISPEL"
  | "PURGE"
  | "DEFENSIVE_WINDOW"
  | "EXTERNAL_WINDOW";

export const MECHANIC_RULE_TYPES: readonly MechanicRuleType[] = [
  "AVOIDABLE_DAMAGE",
  "MANDATORY_DAMAGE",
  "SOAK",
  "PRIORITY_INTERRUPT",
  "CROWD_CONTROL",
  "DISPEL",
  "PURGE",
  "DEFENSIVE_WINDOW",
  "EXTERNAL_WINDOW",
] as const;

export interface MechanicRule {
  id: string;
  seasonSlug: string;
  dungeonSlug: string;
  npcId: number | null;
  spellId: number;
  ruleType: MechanicRuleType;
  severity: number;
  applicableRoles: Role[];
  responseSpellIds: number[];
  notes: string | null;
  source: string;
  version: string;
  active: boolean;
}

export interface MechanicCatalog {
  catalogVersion: string;
  seasonSlug: string | null;
  rules: MechanicRule[];
}

export function createEmptyCatalog(catalogVersion = "0.0.0"): MechanicCatalog {
  return { catalogVersion, seasonSlug: null, rules: [] };
}

export function validateMechanicRule(rule: MechanicRule): string[] {
  const errors: string[] = [];
  if (!rule.id) errors.push("id is required");
  if (!rule.seasonSlug) errors.push("seasonSlug is required");
  if (!rule.dungeonSlug) errors.push("dungeonSlug is required");
  if (!Number.isFinite(rule.spellId)) errors.push("spellId is required");
  if (!MECHANIC_RULE_TYPES.includes(rule.ruleType)) {
    errors.push(`unsupported ruleType: ${String(rule.ruleType)}`);
  }
  if (!(rule.severity >= 0)) errors.push("severity must be >= 0");
  if (!Array.isArray(rule.applicableRoles) || rule.applicableRoles.length === 0) {
    errors.push("applicableRoles must be non-empty");
  }
  if (!rule.version) errors.push("version is required");
  return errors;
}

export function validateMechanicCatalog(catalog: MechanicCatalog): string[] {
  const errors: string[] = [];
  if (!catalog.catalogVersion) errors.push("catalogVersion is required");
  if (!Array.isArray(catalog.rules)) {
    errors.push("rules must be an array");
    return errors;
  }
  const ids = new Set<string>();
  for (const [index, rule] of catalog.rules.entries()) {
    for (const err of validateMechanicRule(rule)) {
      errors.push(`rules[${index}]: ${err}`);
    }
    if (ids.has(rule.id)) errors.push(`duplicate rule id: ${rule.id}`);
    ids.add(rule.id);
  }
  return errors;
}
