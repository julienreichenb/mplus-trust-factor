/**
 * Offensive cooldown eligibility for Performance Phase 2.
 * Authoritative gate: catalogue rules authored via performanceCooldownRule
 * (OFFENSIVE_* + PERFORMANCE_OFFENSIVE_COOLDOWN), not category alone.
 */

import {
  dimensionTagsForRule,
  getCatalogByVersion,
  RETAIL_ABILITY_CATALOG,
  type AbilityCatalog,
  type AbilityRule,
} from "@mplus/abilities";

export type CooldownEligibilitySkipReason =
  | "not_offensive_cooldown_rule"
  | "class_mismatch"
  | "spec_mismatch"
  | "talent_availability_unknown"
  | "malformed_cooldown"
  | "catalogue_incompatible"
  | "unsupported_activation_semantics"
  | "ambiguous_charge_semantics";

export interface EligibleOffensiveCooldown {
  rule: AbilityRule;
  effectiveCooldownMs: number;
  charges: number | null;
}

export interface SkippedOffensiveCooldown {
  canonicalKey: string;
  reason: CooldownEligibilitySkipReason;
}

function isPerformanceCooldownRule(rule: AbilityRule): boolean {
  if (
    rule.category !== "OFFENSIVE_MAJOR" &&
    rule.category !== "OFFENSIVE_MINOR"
  ) {
    return false;
  }
  return dimensionTagsForRule(rule).includes("PERFORMANCE_OFFENSIVE_COOLDOWN");
}

function resolveCatalog(catalogVersion: string | null | undefined): {
  catalog: AbilityCatalog | null;
  incompatible: boolean;
} {
  if (catalogVersion == null || catalogVersion.length === 0) {
    return { catalog: RETAIL_ABILITY_CATALOG, incompatible: false };
  }
  if (catalogVersion === RETAIL_ABILITY_CATALOG.catalogVersion) {
    return { catalog: RETAIL_ABILITY_CATALOG, incompatible: false };
  }
  // Digests store `${gameVersion}/${seasonSlug}`; pins resolve by gameVersion.
  const gameVersion = catalogVersion.includes("/")
    ? catalogVersion.slice(0, catalogVersion.indexOf("/"))
    : catalogVersion;
  if (gameVersion === RETAIL_ABILITY_CATALOG.version.gameVersion) {
    return { catalog: RETAIL_ABILITY_CATALOG, incompatible: false };
  }
  const versioned = getCatalogByVersion(gameVersion);
  if (versioned == null) {
    return { catalog: null, incompatible: true };
  }
  return { catalog: versioned, incompatible: false };
}

/**
 * List eligible offensive cooldowns for a participant class/spec.
 * Skips rather than penalizes unsupported / ambiguous entries.
 */
export function resolveEligibleOffensiveCooldowns(input: {
  classSlug: string | null;
  specSlug: string | null;
  catalogVersion?: string | null;
}): {
  eligible: EligibleOffensiveCooldown[];
  skipped: SkippedOffensiveCooldown[];
  catalogueIncompatible: boolean;
} {
  const { catalog, incompatible } = resolveCatalog(input.catalogVersion);
  if (catalog == null || incompatible) {
    return { eligible: [], skipped: [], catalogueIncompatible: true };
  }

  const eligible: EligibleOffensiveCooldown[] = [];
  const skipped: SkippedOffensiveCooldown[] = [];

  // Class is required for safe eligibility; do not invent cross-class ability sets.
  if (input.classSlug == null || input.classSlug.length === 0) {
    return { eligible: [], skipped: [], catalogueIncompatible: false };
  }

  for (const rule of catalog.rules) {
    if (!isPerformanceCooldownRule(rule)) {
      continue;
    }

    // Other-class rules are irrelevant — omit from diagnostics (do not pollute skips).
    if (rule.classSlug != null && rule.classSlug !== input.classSlug) {
      continue;
    }

    // Spec-gated rules for another spec of the same class.
    if (
      input.specSlug != null &&
      rule.specSlugs.length > 0 &&
      !rule.specSlugs.includes(input.specSlug)
    ) {
      skipped.push({
        canonicalKey: rule.canonicalKey,
        reason: "spec_mismatch",
      });
      continue;
    }

    // Race/shared or talent-dependent abilities require availability evidence digests
    // do not expose. Skip rather than invent race/talent and zero-penalize.
    if (
      rule.availability === "TALENT" ||
      rule.availability === "CHOICE_NODE" ||
      rule.availability === "PET_DEPENDENT" ||
      rule.availability === "FORM_DEPENDENT" ||
      rule.availability === "SHARED" ||
      rule.classSlug == null
    ) {
      skipped.push({
        canonicalKey: rule.canonicalKey,
        reason: "talent_availability_unknown",
      });
      continue;
    }

    const cooldownSeconds = rule.cooldownSeconds;
    if (
      cooldownSeconds == null ||
      !Number.isFinite(cooldownSeconds) ||
      cooldownSeconds <= 0
    ) {
      skipped.push({
        canonicalKey: rule.canonicalKey,
        reason: "malformed_cooldown",
      });
      continue;
    }

    // Activation evidence must be projectable into digest schema (spell/buff IDs).
    const hasActivationIds =
      (rule.activationSpellIds != null && rule.activationSpellIds.length > 0) ||
      (rule.spellIds != null && rule.spellIds.length > 0) ||
      (rule.activationBuffIds != null && rule.activationBuffIds.length > 0);
    if (!hasActivationIds) {
      skipped.push({
        canonicalKey: rule.canonicalKey,
        reason: "unsupported_activation_semantics",
      });
      continue;
    }

    // Charges: only apply when explicitly a positive finite integer.
    // Non-integer / zero / negative → skip as ambiguous.
    let charges: number | null = null;
    if (rule.charges != null) {
      if (
        !Number.isFinite(rule.charges) ||
        !Number.isInteger(rule.charges) ||
        rule.charges < 1
      ) {
        skipped.push({
          canonicalKey: rule.canonicalKey,
          reason: "ambiguous_charge_semantics",
        });
        continue;
      }
      charges = rule.charges;
    }

    eligible.push({
      rule,
      effectiveCooldownMs: cooldownSeconds * 1000,
      charges,
    });
  }

  eligible.sort((a, b) =>
    a.rule.canonicalKey.localeCompare(b.rule.canonicalKey),
  );
  return { eligible, skipped, catalogueIncompatible: false };
}
