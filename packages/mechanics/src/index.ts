export type {
  MechanicCatalog,
  MechanicRule,
  MechanicRuleType,
  Role,
} from "./types.js";
export {
  MECHANIC_RULE_TYPES,
  createEmptyCatalog,
  validateMechanicRule,
  validateMechanicCatalog,
} from "./types.js";
export { matchMechanicRules, classifyDamageEvent } from "./match.js";
export type { MechanicMatchQuery, DamageClassification } from "./match.js";
export { MINIMAL_SEED_CATALOG } from "./seed-catalog.js";

import type { MechanicRule } from "./types.js";
import { validateMechanicRule } from "./types.js";

/** @deprecated Prefer MechanicRule + validateMechanicRule */
export type MechanicRuleDraft = MechanicRule;

/** Catalog abstractions — concrete season rules owned with Agent 4. */
export function validateMechanicRuleDraft(rule: MechanicRuleDraft): string[] {
  return validateMechanicRule(rule);
}
