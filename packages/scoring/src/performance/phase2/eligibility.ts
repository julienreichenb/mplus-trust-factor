/**
 * Offensive cooldown eligibility for Performance Phase 2.
 * Authoritative gate: catalogue rules authored via performanceCooldownRule
 * (OFFENSIVE_* + PERFORMANCE_OFFENSIVE_COOLDOWN), not category alone.
 *
 * Conditional availability semantics:
 * - observed use proves availability for that run;
 * - CombatantInfo loadout spell IDs prove selected talent/choice nodes;
 * - unresolved availability is skipped (never a fabricated missed-use penalty).
 */

import {
  dimensionTagsForRule,
  getCatalogByVersion,
  RETAIL_ABILITY_CATALOG,
  ruleResolvableSpellIds,
  type AbilityCatalog,
  type AbilityRule,
} from "@mplus/abilities";

export type CooldownEligibilitySkipReason =
  | "not_offensive_cooldown_rule"
  | "class_mismatch"
  | "spec_mismatch"
  | "talent_availability_unknown"
  | "conditional_not_selected"
  | "malformed_cooldown"
  | "catalogue_incompatible"
  | "unsupported_activation_semantics"
  | "ambiguous_charge_semantics";

export type CooldownAvailabilityReason =
  | "baseline"
  | "observed_use"
  | "loadout_selected"
  | "pet_present"
  | "skipped";

export interface EligibleOffensiveCooldown {
  rule: AbilityRule;
  effectiveCooldownMs: number;
  charges: number | null;
  availabilityReason: Exclude<CooldownAvailabilityReason, "skipped">;
}

export interface SkippedOffensiveCooldown {
  canonicalKey: string;
  reason: CooldownEligibilitySkipReason;
}

export interface OffensiveCooldownAvailabilityEvidence {
  /** CombatantInfo talent spell IDs when PRESENT; null when absent/unparseable. */
  loadoutTalentSpellIds: ReadonlySet<number> | null;
  loadoutEvidenceState: "PRESENT" | "ABSENT" | "UNPARSEABLE";
  /** Canonical keys observed in this run's offensive activations. */
  observedCanonicalKeys: ReadonlySet<string>;
  /** Spell IDs observed in this run's offensive activations. */
  observedSpellIds: ReadonlySet<number>;
  ownedPetActorIds: readonly number[];
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

function ruleMatchesLoadout(
  rule: AbilityRule,
  loadoutSpellIds: ReadonlySet<number>,
): boolean {
  for (const id of ruleResolvableSpellIds(rule)) {
    if (loadoutSpellIds.has(id)) return true;
  }
  if (rule.talentRequirements?.length) {
    return rule.talentRequirements.every((req) => loadoutSpellIds.has(req));
  }
  return false;
}

function resolveConditionalAvailability(
  rule: AbilityRule,
  evidence: OffensiveCooldownAvailabilityEvidence | undefined,
):
  | { status: "eligible"; reason: Exclude<CooldownAvailabilityReason, "skipped"> }
  | { status: "skip"; reason: CooldownEligibilitySkipReason } {
  const observed =
    evidence != null &&
    (evidence.observedCanonicalKeys.has(rule.canonicalKey) ||
      ruleResolvableSpellIds(rule).some((id) => evidence.observedSpellIds.has(id)));

  if (observed) {
    return { status: "eligible", reason: "observed_use" };
  }

  if (rule.availability === "BASELINE") {
    return { status: "eligible", reason: "baseline" };
  }

  if (rule.availability === "PET_DEPENDENT") {
    if (evidence != null && evidence.ownedPetActorIds.length > 0) {
      return { status: "eligible", reason: "pet_present" };
    }
    return { status: "skip", reason: "talent_availability_unknown" };
  }

  if (
    rule.availability === "TALENT" ||
    rule.availability === "CHOICE_NODE" ||
    rule.availability === "FORM_DEPENDENT" ||
    rule.availability === "SHARED" ||
    rule.classSlug == null
  ) {
    if (evidence == null) {
      return { status: "skip", reason: "talent_availability_unknown" };
    }
    if (
      evidence.loadoutEvidenceState === "PRESENT" &&
      evidence.loadoutTalentSpellIds != null &&
      evidence.loadoutTalentSpellIds.size > 0
    ) {
      if (ruleMatchesLoadout(rule, evidence.loadoutTalentSpellIds)) {
        return { status: "eligible", reason: "loadout_selected" };
      }
      // Spell-keyed loadout present and ability not selected — do not score as missed use.
      if (
        rule.availability === "TALENT" ||
        rule.availability === "CHOICE_NODE"
      ) {
        return { status: "skip", reason: "conditional_not_selected" };
      }
    }
    // PRESENT with only tree-node IDs (no spell IDs) cannot prove selection for
    // spell-keyed AbilityRules — remain unresolved rather than inventing absence.
    return { status: "skip", reason: "talent_availability_unknown" };
  }

  return { status: "eligible", reason: "baseline" };
}

/**
 * List eligible offensive cooldowns for a participant class/spec.
 * Skips rather than penalizes unsupported / ambiguous / unresolved entries.
 */
export function resolveEligibleOffensiveCooldowns(input: {
  classSlug: string | null;
  specSlug: string | null;
  catalogVersion?: string | null;
  availabilityEvidence?: OffensiveCooldownAvailabilityEvidence;
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

    // Spec-gated rules require a known spec — do not invent all-spec eligibility.
    if (rule.specSlugs.length > 0 && (input.specSlug == null || input.specSlug.length === 0)) {
      skipped.push({
        canonicalKey: rule.canonicalKey,
        reason: "spec_mismatch",
      });
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

    const conditional = resolveConditionalAvailability(
      rule,
      input.availabilityEvidence,
    );
    if (conditional.status === "skip") {
      skipped.push({
        canonicalKey: rule.canonicalKey,
        reason: conditional.reason,
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
      availabilityReason: conditional.reason,
    });
  }

  eligible.sort((a, b) =>
    a.rule.canonicalKey.localeCompare(b.rule.canonicalKey),
  );
  return { eligible, skipped, catalogueIncompatible: false };
}
