/**
 * Wave 4 scoring mechanic rule — avoidability / severity catalog.
 * Distinct from the Wave 3 `MechanicRule` (ruleType enum + numeric severity) used by matcher fixtures.
 */
export const SCORING_MECHANIC_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "LETHAL"] as const;
export type ScoringMechanicSeverity = (typeof SCORING_MECHANIC_SEVERITIES)[number];

export interface ScoringMechanicRule {
  id: string;
  seasonSlug: string;
  dungeonSlug: string;
  npcId?: number;
  abilityId: number;
  avoidable: boolean;
  severity: ScoringMechanicSeverity;
  categories: string[];
  validFrom?: string;
  validTo?: string;
  notes?: string;
}

export interface ScoringMechanicCatalog {
  catalogVersion: string;
  seasonSlug: string | null;
  rules: ScoringMechanicRule[];
}

export function createEmptyScoringMechanicCatalog(
  catalogVersion = "0.0.0",
): ScoringMechanicCatalog {
  return { catalogVersion, seasonSlug: null, rules: [] };
}

export function validateScoringMechanicRule(rule: ScoringMechanicRule): string[] {
  const errors: string[] = [];
  if (!rule.id) errors.push("id is required");
  if (!rule.seasonSlug) errors.push("seasonSlug is required");
  if (!rule.dungeonSlug) errors.push("dungeonSlug is required");
  if (!Number.isFinite(rule.abilityId) || rule.abilityId <= 0) {
    errors.push("abilityId must be a positive number");
  }
  if (typeof rule.avoidable !== "boolean") errors.push("avoidable must be boolean");
  if (!SCORING_MECHANIC_SEVERITIES.includes(rule.severity)) {
    errors.push(`unsupported severity: ${String(rule.severity)}`);
  }
  if (!Array.isArray(rule.categories)) errors.push("categories must be an array");
  return errors;
}

export function validateScoringMechanicCatalog(catalog: ScoringMechanicCatalog): string[] {
  const errors: string[] = [];
  if (!catalog.catalogVersion) errors.push("catalogVersion is required");
  if (!Array.isArray(catalog.rules)) {
    errors.push("rules must be an array");
    return errors;
  }
  const ids = new Set<string>();
  for (const [index, rule] of catalog.rules.entries()) {
    for (const err of validateScoringMechanicRule(rule)) {
      errors.push(`rules[${index}]: ${err}`);
    }
    if (ids.has(rule.id)) errors.push(`duplicate rule id: ${rule.id}`);
    ids.add(rule.id);
  }
  return errors;
}

export function findScoringMechanicRules(
  catalog: ScoringMechanicCatalog,
  query: {
    seasonSlug: string;
    dungeonSlug: string;
    abilityId: number;
    npcId?: number | null;
  },
): ScoringMechanicRule[] {
  return catalog.rules.filter((rule) => {
    if (rule.seasonSlug !== query.seasonSlug && rule.seasonSlug !== "*") return false;
    if (rule.dungeonSlug !== query.dungeonSlug && rule.dungeonSlug !== "*") return false;
    if (rule.abilityId !== query.abilityId) return false;
    if (rule.npcId != null && query.npcId != null && rule.npcId !== query.npcId) return false;
    return true;
  });
}

/** Unknown abilities are never treated as avoidable. */
export function isAvoidableAbility(
  catalog: ScoringMechanicCatalog,
  query: {
    seasonSlug: string;
    dungeonSlug: string;
    abilityId: number;
    npcId?: number | null;
  },
): boolean {
  const matched = findScoringMechanicRules(catalog, query);
  return matched.some((rule) => rule.avoidable);
}
