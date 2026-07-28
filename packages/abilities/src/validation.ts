import type {
  AbilityRule,
  CatalogValidationReport,
  SourceOwnership,
  ValidationIssue,
} from "./types.js";
import { findClassDefinition, findSpecDefinition, RETAIL_CLASS_MATRIX } from "./catalog/classes-matrix.js";
import { getAllRegisteredRules, RETAIL_ABILITY_CATALOG } from "./registry.js";
import { CURRENT_CATALOG_VERSION } from "./version.js";

const OWNERSHIP: ReadonlySet<SourceOwnership> = new Set([
  "PLAYER",
  "PET",
  "GUARDIAN",
  "ANY_OWNED",
]);

function walkReplacement(
  rulesByKey: Map<string, AbilityRule>,
  start: string,
  field: "replacementFor",
): string[] | null {
  const seen = new Set<string>();
  let current: string | undefined = start;
  while (current) {
    if (seen.has(current)) return [...seen, current];
    seen.add(current);
    const rule = rulesByKey.get(current);
    current = rule?.[field];
  }
  return null;
}

/** Validates the full registered ability catalog. */
export function validateAbilityCatalog(
  rules: AbilityRule[] = getAllRegisteredRules(),
): CatalogValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const keys = new Map<string, AbilityRule>();
  const spellOwners = new Map<number, AbilityRule>();

  if (!CURRENT_CATALOG_VERSION.gameVersion) {
    errors.push({ severity: "error", code: "MISSING_VERSION", message: "Catalog version gameVersion is missing" });
  }

  for (const rule of rules) {
    if (!rule.canonicalKey) {
      errors.push({ severity: "error", code: "EMPTY_CANONICAL_KEY", message: "Rule missing canonicalKey" });
      continue;
    }

    if (keys.has(rule.canonicalKey)) {
      errors.push({
        severity: "error",
        code: "DUPLICATE_CANONICAL_KEY",
        message: `Duplicate canonical key ${rule.canonicalKey}`,
        canonicalKey: rule.canonicalKey,
      });
    } else {
      keys.set(rule.canonicalKey, rule);
    }

    if (!rule.spellIds || rule.spellIds.length === 0) {
      errors.push({
        severity: "error",
        code: "EMPTY_SPELL_IDS",
        message: `Rule ${rule.canonicalKey} has empty spellIds`,
        canonicalKey: rule.canonicalKey,
      });
    }

    if (!rule.provenance || !rule.provenance.source || !rule.provenance.verifiedAt || !rule.provenance.gameVersion) {
      errors.push({
        severity: "error",
        code: "MISSING_PROVENANCE",
        message: `Rule ${rule.canonicalKey} is missing provenance fields`,
        canonicalKey: rule.canonicalKey,
      });
    }

    if (!OWNERSHIP.has(rule.sourceOwnership)) {
      errors.push({
        severity: "error",
        code: "UNSUPPORTED_OWNERSHIP",
        message: `Rule ${rule.canonicalKey} has unsupported ownership ${String(rule.sourceOwnership)}`,
        canonicalKey: rule.canonicalKey,
      });
    }

    if (rule.classSlug != null && !findClassDefinition(rule.classSlug)) {
      errors.push({
        severity: "error",
        code: "UNKNOWN_CLASS",
        message: `Rule ${rule.canonicalKey} references unknown class ${rule.classSlug}`,
        canonicalKey: rule.canonicalKey,
        classSlug: rule.classSlug,
      });
    }

    for (const spec of rule.specSlugs) {
      if (rule.classSlug && !findSpecDefinition(rule.classSlug, spec)) {
        errors.push({
          severity: "error",
          code: "UNKNOWN_SPEC",
          message: `Rule ${rule.canonicalKey} references unknown spec ${rule.classSlug}/${spec}`,
          canonicalKey: rule.canonicalKey,
          classSlug: rule.classSlug ?? undefined,
          specSlug: spec,
        });
      }
    }

    const allIds = [...rule.spellIds, ...(rule.aliases ?? [])];
    for (const spellId of allIds) {
      const existing = spellOwners.get(spellId);
      if (existing && existing.canonicalKey !== rule.canonicalKey) {
        if (existing.category !== rule.category || existing.classSlug !== rule.classSlug) {
          errors.push({
            severity: "error",
            code: "DUPLICATE_SPELL_CONFLICT",
            message: `Spell ${spellId} conflicts between ${existing.canonicalKey} and ${rule.canonicalKey}`,
            canonicalKey: rule.canonicalKey,
            spellId,
          });
        } else {
          warnings.push({
            severity: "warning",
            code: "DUPLICATE_SPELL_SAME_SEMANTICS",
            message: `Spell ${spellId} appears on both ${existing.canonicalKey} and ${rule.canonicalKey}`,
            canonicalKey: rule.canonicalKey,
            spellId,
          });
        }
      } else {
        spellOwners.set(spellId, rule);
      }
    }

    if (rule.supportCertainty === "uncertain") {
      warnings.push({
        severity: "warning",
        code: "UNCERTAIN_ABILITY",
        message: `Rule ${rule.canonicalKey} is marked uncertain`,
        canonicalKey: rule.canonicalKey,
      });
    }
  }

  for (const rule of rules) {
    if (rule.replacementFor) {
      if (!keys.has(rule.replacementFor)) {
        errors.push({
          severity: "error",
          code: "REPLACEMENT_TARGET_MISSING",
          message: `Rule ${rule.canonicalKey} replacementFor ${rule.replacementFor} not found`,
          canonicalKey: rule.canonicalKey,
        });
      } else {
        const cycle = walkReplacement(keys, rule.canonicalKey, "replacementFor");
        if (cycle) {
          errors.push({
            severity: "error",
            code: "REPLACEMENT_CYCLE",
            message: `Replacement cycle detected: ${cycle.join(" -> ")}`,
            canonicalKey: rule.canonicalKey,
          });
        }
      }
    }
  }

  // Alias cycles: treat alias lists pointing at each other via shared IDs as warnings already covered.
  // Explicit unreachable: every rule must be in the registry export (caller passes registry rules).
  const registryKeys = new Set(RETAIL_ABILITY_CATALOG.rules.map((r) => r.canonicalKey));
  for (const rule of rules) {
    if (!registryKeys.has(rule.canonicalKey) && rules === getAllRegisteredRules()) {
      errors.push({
        severity: "error",
        code: "UNREACHABLE_RULE",
        message: `Rule ${rule.canonicalKey} is not reachable through the registry catalog`,
        canonicalKey: rule.canonicalKey,
      });
    }
  }

  for (const cls of RETAIL_CLASS_MATRIX) {
    if (!cls.supportState) {
      errors.push({
        severity: "error",
        code: "MISSING_SUPPORT_STATE",
        message: `Class ${cls.slug} missing support state`,
        classSlug: cls.slug,
      });
    }
    for (const spec of cls.specs) {
      if (!spec.supportState) {
        errors.push({
          severity: "error",
          code: "MISSING_SUPPORT_STATE",
          message: `Spec ${cls.slug}/${spec.slug} missing support state`,
          classSlug: cls.slug,
          specSlug: spec.slug,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}
