import type { AbilityCatalog, AbilityCategory, AbilityRule } from "./ability-types.js";
import { resolveEffectiveCooldownMs } from "./ability-types.js";

/** Utility score contributors that may be dropped per-spec and renormalized. */
export const UTILITY_CONTRIBUTOR_KEYS = [
  "interrupts",
  "crowd_control",
  "group_support",
  "dispels",
] as const;

export type UtilityContributorKey = (typeof UTILITY_CONTRIBUTOR_KEYS)[number];

export interface UtilityCapability {
  interrupts: boolean;
  crowdControl: boolean;
  groupSupport: boolean;
  defensiveDispels: boolean;
  offensiveDispels: boolean;
  /** True when either defensive or offensive dispel capability exists. */
  dispels: boolean;
  catalogCoverage: {
    interruptSpellIds: number[];
    crowdControlSpellIds: number[];
    groupSupportSpellIds: number[];
    defensiveDispelSpellIds: number[];
    offensiveDispelSpellIds: number[];
  };
}

export interface ResolvedInterrupt {
  spellIds: number[];
  effectiveCooldownMs: number | null;
  petRequirement: string | null;
  /** How the active interrupt was chosen. */
  resolution: "catalog" | "pet_filtered" | "talent_filtered" | "unresolved";
  notes: string | null;
  rules: AbilityRule[];
}

function ruleMatchesIdentity(
  rule: AbilityRule,
  classSlug: string | null | undefined,
  specSlug: string | null | undefined,
): boolean {
  if (rule.classSlug !== "*" && classSlug && rule.classSlug !== classSlug) return false;
  if (rule.specSlugs && specSlug && !rule.specSlugs.includes(specSlug)) return false;
  return true;
}

function ruleMeetsTalents(rule: AbilityRule, talentIds: ReadonlySet<number>): boolean {
  if (!rule.talentRequirements || rule.talentRequirements.length === 0) return true;
  return rule.talentRequirements.every((id) => talentIds.has(id));
}

function rulesForCategory(
  catalog: AbilityCatalog,
  category: AbilityCategory,
  classSlug: string | null | undefined,
  specSlug: string | null | undefined,
): AbilityRule[] {
  return catalog.rules.filter(
    (rule) =>
      rule.categories.includes(category) && ruleMatchesIdentity(rule, classSlug, specSlug),
  );
}

/**
 * Resolve which interrupt ability is available from class/spec/talents/pet.
 * Spell IDs stay in the catalog — callers never hard-code them.
 */
export function resolveInterruptAbility(input: {
  abilityCatalog: AbilityCatalog;
  classSlug?: string | null;
  specSlug?: string | null;
  talentIds?: ReadonlySet<number>;
  /** Active pet slug when known (e.g. "felhunter", "imp"). */
  activePet?: string | null;
}): ResolvedInterrupt {
  const talentIds = input.talentIds ?? new Set<number>();
  const candidates = rulesForCategory(
    input.abilityCatalog,
    "interrupt",
    input.classSlug,
    input.specSlug,
  ).filter((rule) => ruleMeetsTalents(rule, talentIds));

  if (candidates.length === 0) {
    return {
      spellIds: [],
      effectiveCooldownMs: null,
      petRequirement: null,
      resolution: "unresolved",
      notes: "no_interrupt_rule_for_class_spec_talents",
      rules: [],
    };
  }

  const petKnown = input.activePet != null && input.activePet !== "";
  let filtered = candidates;
  let resolution: ResolvedInterrupt["resolution"] = "catalog";

  if (petKnown) {
    const petMatched = candidates.filter(
      (rule) => !rule.petRequirement || rule.petRequirement === input.activePet,
    );
    if (petMatched.length === 0) {
      // Spec still has an interrupt via another pet; keep catalog CDs for window estimates.
      filtered = candidates;
      resolution = "pet_filtered";
      return {
        spellIds: [...new Set(candidates.map((r) => r.spellId))],
        effectiveCooldownMs: minCooldown(candidates, talentIds),
        petRequirement: input.activePet ?? null,
        resolution,
        notes: `active_pet_${input.activePet}_lacks_interrupt_using_catalog_fallback`,
        rules: candidates,
      };
    }
    filtered = petMatched;
    resolution = "pet_filtered";
  } else if (candidates.some((r) => r.talentRequirements?.length)) {
    resolution = "talent_filtered";
  }

  const petRequirement =
    filtered.find((r) => r.petRequirement)?.petRequirement ??
    candidates.find((r) => r.petRequirement)?.petRequirement ??
    null;

  return {
    spellIds: [...new Set(filtered.map((r) => r.spellId))],
    effectiveCooldownMs: minCooldown(filtered, talentIds),
    petRequirement,
    resolution,
    notes: filtered[0]?.notes ?? null,
    rules: filtered,
  };
}

function minCooldown(rules: AbilityRule[], talentIds: ReadonlySet<number>): number | null {
  let effectiveKickCooldownMs: number | null = null;
  for (const rule of rules) {
    const cd = resolveEffectiveCooldownMs(rule, talentIds);
    if (cd != null) {
      effectiveKickCooldownMs =
        effectiveKickCooldownMs == null ? cd : Math.min(effectiveKickCooldownMs, cd);
    }
  }
  return effectiveKickCooldownMs;
}

/**
 * Spec-level capability matrix from the ability catalog.
 * Pet gates do not remove a category: Demo can swap Felhunter/Imp mid-key.
 * Unsupported contributors (no catalog rules) are false so scoring drops + renormalizes.
 */
export function resolveUtilityCapability(input: {
  abilityCatalog: AbilityCatalog;
  classSlug?: string | null;
  specSlug?: string | null;
  talentIds?: ReadonlySet<number>;
}): UtilityCapability {
  const talentIds = input.talentIds ?? new Set<number>();

  const interruptRules = rulesForCategory(
    input.abilityCatalog,
    "interrupt",
    input.classSlug,
    input.specSlug,
  ).filter((r) => ruleMeetsTalents(r, talentIds));

  const crowdControl = rulesForCategory(
    input.abilityCatalog,
    "crowd_control",
    input.classSlug,
    input.specSlug,
  ).filter((r) => ruleMeetsTalents(r, talentIds));

  const groupSupport = rulesForCategory(
    input.abilityCatalog,
    "group_support",
    input.classSlug,
    input.specSlug,
  ).filter((r) => ruleMeetsTalents(r, talentIds));

  const defensiveDispels = rulesForCategory(
    input.abilityCatalog,
    "defensive_dispel",
    input.classSlug,
    input.specSlug,
  ).filter((r) => ruleMeetsTalents(r, talentIds));

  const offensiveDispels = rulesForCategory(
    input.abilityCatalog,
    "offensive_dispel",
    input.classSlug,
    input.specSlug,
  ).filter((r) => ruleMeetsTalents(r, talentIds));

  return {
    interrupts: interruptRules.length > 0,
    crowdControl: crowdControl.length > 0,
    groupSupport: groupSupport.length > 0,
    defensiveDispels: defensiveDispels.length > 0,
    offensiveDispels: offensiveDispels.length > 0,
    dispels: defensiveDispels.length > 0 || offensiveDispels.length > 0,
    catalogCoverage: {
      interruptSpellIds: [...new Set(interruptRules.map((r) => r.spellId))],
      crowdControlSpellIds: [...new Set(crowdControl.map((r) => r.spellId))],
      groupSupportSpellIds: [...new Set(groupSupport.map((r) => r.spellId))],
      defensiveDispelSpellIds: [...new Set(defensiveDispels.map((r) => r.spellId))],
      offensiveDispelSpellIds: [...new Set(offensiveDispels.map((r) => r.spellId))],
    },
  };
}

export function availableWindows(
  runDurationMs: number | null | undefined,
  cooldownMs: number | null | undefined,
): number | null {
  if (
    runDurationMs == null ||
    !Number.isFinite(runDurationMs) ||
    runDurationMs <= 0 ||
    cooldownMs == null ||
    !Number.isFinite(cooldownMs) ||
    cooldownMs <= 0
  ) {
    return null;
  }
  return Math.max(1, runDurationMs / cooldownMs);
}
