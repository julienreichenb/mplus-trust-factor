/**
 * Derive Utility toolkit applicability from the Ability Catalog.
 * No second spell-ID registry — catalog + getApplicableAbilityCategories only.
 */

import {
  canonicalRoleForClassSpec,
  getApplicableAbilityCategories,
  resolveAbilityCatalog,
  type AbilityCatalogContext,
  type AbilityRole,
  type ApplicableCategoryResult,
} from "@mplus/abilities";
import {
  UTILITY_FAMILY_CATALOG_CATEGORIES,
  UTILITY_V2_FAMILY_KEYS,
  emptyFamilyApplicability,
  isOptionalUtilityFamily,
  legacyToolkitBooleansFromFamilies,
  utilityFamilyFromCatalogRule,
  type UtilityFamilyApplicabilityMap,
  type UtilityV2FamilyKey,
} from "./families.js";
import type { UtilityV2ToolkitApplicability } from "./types.js";

export interface ResolveUtilityToolkitInput {
  classSlug: string | null | undefined;
  specSlug: string | null | undefined;
  role?: AbilityRole | "UNKNOWN" | null;
  knownTalentSpellIds?: number[];
  talentDataAvailable?: boolean;
  /** Observed Utility spell IDs for this run (availability proof). */
  observedSpellIds?: number[];
  /** Run-scoped race slug when historically known. */
  raceSlug?: string | null;
  includeRacials?: boolean;
  /** Families with observed usage — promote uncertain/not_applicable to applicable. */
  observedFamilies?: Partial<Record<UtilityV2FamilyKey, boolean>>;
  /** Optional catalog context (replay). Default = static registry. */
  catalog?: AbilityCatalogContext;
}

export interface ResolveUtilityToolkitResult {
  toolkit: UtilityV2ToolkitApplicability;
  catalogSupported: boolean;
  unsupportedReason: string | null;
  limitations: string[];
}

function roleForLookup(
  classSlug: string,
  specSlug: string,
  role?: AbilityRole | "UNKNOWN" | null,
): AbilityRole | null {
  if (role === "TANK" || role === "HEALER" || role === "DPS") return role;
  return canonicalRoleForClassSpec(classSlug, specSlug);
}

function combineCategoryStates(
  family: UtilityV2FamilyKey,
  results: ApplicableCategoryResult[],
): UtilityFamilyApplicabilityMap[UtilityV2FamilyKey] {
  if (results.length === 0) {
    return { state: "not_applicable", reason: "no_rules_for_family" };
  }

  const applicable = results.filter((r) => r.state === "applicable");
  const uncertain = results.filter((r) => r.state === "uncertain");

  if (isOptionalUtilityFamily(family) && applicable.length > 0) {
    const optional = applicable.find((r) => r.reason === "optional_group_expectation");
    return {
      state: "optional",
      reason: optional?.reason ?? "optional_group_expectation",
    };
  }

  if (applicable.length > 0) {
    return { state: "applicable", reason: applicable[0]!.reason };
  }
  if (uncertain.length > 0) {
    return {
      state: "uncertain",
      reason: uncertain[0]!.reason ?? "talent_data_unavailable",
    };
  }
  return {
    state: "not_applicable",
    reason: results[0]!.reason ?? "not_applicable",
  };
}

export function resolveUtilityToolkitFromCatalog(
  input: ResolveUtilityToolkitInput,
): ResolveUtilityToolkitResult {
  const limitations: string[] = [];
  const classSlug = input.classSlug ?? null;
  const specSlug = input.specSlug ?? null;

  if (classSlug == null || specSlug == null) {
    const families = emptyFamilyApplicability("uncertain", "class_spec_identity_unknown");
    // Observed usage cannot confirm a toolkit when class/spec is unknown.
    return {
      toolkit: {
        ...legacyToolkitBooleansFromFamilies(families),
        families,
      },
      catalogSupported: false,
      unsupportedReason: "CLASS_SPEC_UNKNOWN",
      limitations: [
        "class_spec_identity_unknown",
        "toolkit_coverage_unconfirmed",
      ],
    };
  }

  const role = roleForLookup(classSlug, specSlug, input.role);
  if (role == null) {
    const families = emptyFamilyApplicability("uncertain", "class_spec_identity_unknown");
    return {
      toolkit: {
        ...legacyToolkitBooleansFromFamilies(families),
        families,
      },
      catalogSupported: false,
      unsupportedReason: "UNKNOWN_SPEC",
      limitations: [
        "class_spec_identity_unknown",
        "toolkit_coverage_unconfirmed",
      ],
    };
  }

  const resolved = input.catalog
    ? input.catalog.resolveCatalog({
        classSlug,
        specSlug,
        role,
        includeShared: true,
        includeRacials: input.includeRacials ?? true,
      })
    : resolveAbilityCatalog({
        classSlug,
        specSlug,
        role,
        includeShared: true,
        includeRacials: input.includeRacials ?? true,
      });

  if (!resolved.ok) {
    const families = emptyFamilyApplicability(
      "uncertain",
      resolved.reason ?? "ABILITY_CATALOG_UNSUPPORTED",
    );
    promoteObserved(families, input.observedFamilies);
    limitations.push(
      `ability_catalog:${resolved.reason ?? "UNSUPPORTED"}`,
      "toolkit_coverage_unconfirmed",
    );
    return {
      toolkit: {
        ...legacyToolkitBooleansFromFamilies(families),
        families,
      },
      catalogSupported: false,
      unsupportedReason: resolved.reason ?? "ABILITY_CATALOG_UNSUPPORTED",
      limitations,
    };
  }

  const talentDataAvailable =
    input.talentDataAvailable ?? input.knownTalentSpellIds != null;
  const knownTalentSpellIds = talentDataAvailable
    ? (input.knownTalentSpellIds ?? [])
    : undefined;

  const categoryResults = getApplicableAbilityCategories({
    classSlug,
    specSlug,
    role,
    knownTalentSpellIds,
    observedSpellIds: input.observedSpellIds,
    raceSlug: input.raceSlug,
    includeRacials: input.includeRacials ?? true,
    catalog: input.catalog,
  });

  const byCategory = new Map(categoryResults.map((r) => [r.category, r]));
  const families = emptyFamilyApplicability("not_applicable");

  for (const family of UTILITY_V2_FAMILY_KEYS) {
    const categories = UTILITY_FAMILY_CATALOG_CATEGORIES[family];
    const results: ApplicableCategoryResult[] = [];
    for (const category of categories) {
      const row = byCategory.get(category);
      if (!row) continue;
      if (family === "movement") {
        const utilityRules = row.rules.filter(
          (rule) => utilityFamilyFromCatalogRule(rule) === "movement",
        );
        if (utilityRules.length === 0 && row.rules.length > 0) {
          results.push({
            ...row,
            state: "not_applicable",
            reason: "movement_not_utility_tagged",
            rules: row.rules,
          });
          continue;
        }
      }
      results.push(row);
    }
    families[family] = combineCategoryStates(family, results);
  }

  promoteObserved(families, input.observedFamilies);

  if (!talentDataAvailable) {
    limitations.push("talent_data_unavailable");
  }

  return {
    toolkit: {
      ...legacyToolkitBooleansFromFamilies(families),
      families,
    },
    catalogSupported: true,
    unsupportedReason: null,
    limitations,
  };
}

function promoteObserved(
  families: UtilityFamilyApplicabilityMap,
  observed?: Partial<Record<UtilityV2FamilyKey, boolean>>,
): void {
  if (!observed) return;
  for (const family of UTILITY_V2_FAMILY_KEYS) {
    if (!observed[family]) continue;
    const current = families[family];
    if (current.state === "applicable") continue;
    families[family] = {
      state: "applicable",
      reason: "observed_usage",
    };
  }
}
