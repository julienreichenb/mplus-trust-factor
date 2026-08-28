import type {
  AbilityAvailability,
  AbilityCategory,
  AbilityDimensionTag,
  SourceOwnership,
} from "../../types.js";
import { isKnownRetailClassSlug, isKnownRetailRaceSlug, isKnownRetailSpec } from "../topology.js";
import { getAllRegisteredRules } from "../../registry.js";
import { isValidCanonicalKeyFormat } from "./import-plan.js";

export type AbilitySpellBindingRole =
  | "PRIMARY_ACTIVATION"
  | "CAST_ALIAS"
  | "ACTIVATION_AURA"
  | "STACK_AURA"
  | "TRIGGERED_EFFECT"
  | "SUMMON";

export interface DraftBinding {
  spellId: number;
  role: AbilitySpellBindingRole;
}

export interface CuratedDraftRuleInput {
  canonicalKey?: string | null;
  name: string;
  spellIds: number[];
  bindings: DraftBinding[];
  iconName?: string | null;
  classSlug?: string | null;
  specSlugs?: string[];
  raceSlugs?: string[];
  category?: AbilityCategory | null;
  dimensionTags?: AbilityDimensionTag[];
  availability?: AbilityAvailability | null;
  cooldownSeconds?: number | null;
  charges?: number | null;
  sourceOwnership?: SourceOwnership | null;
  provenance?: Record<string, unknown> | null;
  validityBuild?: string | null;
  validFromBuild?: string | null;
  validToBuild?: string | null;
  notes?: string | null;
}

export interface DraftValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  field?: string;
}

export interface DraftValidationResult {
  readyForPublishReview: boolean;
  status: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW";
  /** Structured codes for UI (errors + readiness blockers). */
  reasonCodes: string[];
  errors: DraftValidationIssue[];
  warnings: DraftValidationIssue[];
}

export const DRAFT_ABILITY_CATEGORIES = [
  "INTERRUPT",
  "HARD_CC",
  "SOFT_CC",
  "DISPEL",
  "PURGE",
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
  "SELF_HEAL",
  "EXTERNAL_DEFENSIVE",
  "GROUP_UTILITY",
  "MOVEMENT_UTILITY",
  "BATTLE_REZ",
  "BLOODLUST",
  "CONSUMABLE",
  "OFFENSIVE_MAJOR",
  "OFFENSIVE_MINOR",
] as const satisfies readonly AbilityCategory[];

export const DRAFT_DIMENSION_TAGS = [
  "PERFORMANCE_OFFENSIVE_COOLDOWN",
  "SURVIVAL_PERSONAL_DEFENSIVE",
  "SURVIVAL_RECOVERY",
  "UTILITY_INTERRUPT",
  "UTILITY_DISPEL",
  "UTILITY_CROWD_CONTROL",
  "UTILITY_EXTERNAL",
  "UTILITY_COMBAT_RES",
] as const satisfies readonly AbilityDimensionTag[];

export const DRAFT_AVAILABILITIES = [
  "BASELINE",
  "TALENT",
  "PET_DEPENDENT",
  "FORM_DEPENDENT",
  "CHOICE_NODE",
  "SHARED",
] as const satisfies readonly AbilityAvailability[];

export const DRAFT_SOURCE_OWNERSHIPS = [
  "PLAYER",
  "PET",
  "GUARDIAN",
  "ANY_OWNED",
] as const satisfies readonly SourceOwnership[];

export const DRAFT_BINDING_ROLES = [
  "PRIMARY_ACTIVATION",
  "CAST_ALIAS",
  "ACTIVATION_AURA",
  "STACK_AURA",
  "TRIGGERED_EFFECT",
  "SUMMON",
] as const satisfies readonly AbilitySpellBindingRole[];

const CATEGORIES = new Set<string>(DRAFT_ABILITY_CATEGORIES);
const DIMENSION_TAGS = new Set<string>(DRAFT_DIMENSION_TAGS);
const AVAILABILITIES = new Set<string>(DRAFT_AVAILABILITIES);
const OWNERSHIPS = new Set<string>(DRAFT_SOURCE_OWNERSHIPS);
const BINDING_ROLES = new Set<string>(DRAFT_BINDING_ROLES);

export function validateCuratedDraftRule(
  draft: CuratedDraftRuleInput,
  options: {
    existingCanonicalKeys?: Set<string>;
    otherDraftCanonicalKeys?: Set<string>;
  } = {},
): DraftValidationResult {
  const errors: DraftValidationIssue[] = [];
  const warnings: DraftValidationIssue[] = [];
  const runtimeKeys =
    options.existingCanonicalKeys ?? new Set(getAllRegisteredRules().map((r) => r.canonicalKey));
  const draftKeys = options.otherDraftCanonicalKeys ?? new Set<string>();

  if (!draft.name?.trim()) {
    errors.push({
      severity: "error",
      code: "EMPTY_NAME",
      message: "Draft name is required",
      field: "name",
    });
  }
  if (!draft.spellIds?.length) {
    errors.push({
      severity: "error",
      code: "EMPTY_SPELL_IDS",
      message: "At least one spell ID is required",
      field: "spellIds",
    });
  }
  for (const id of draft.spellIds ?? []) {
    if (!Number.isInteger(id) || id <= 0) {
      errors.push({
        severity: "error",
        code: "INVALID_SPELL_ID",
        message: `Invalid spell ID ${id}`,
        field: "spellIds",
      });
    }
  }

  const bindings = draft.bindings ?? [];
  const seenBindings = new Set<string>();
  let primaryCount = 0;
  for (const b of bindings) {
    if (!Number.isInteger(b.spellId) || b.spellId <= 0) {
      errors.push({
        severity: "error",
        code: "INVALID_SPELL_ID",
        message: `Invalid binding spell ID ${b.spellId}`,
        field: "bindings",
      });
    }
    if (!BINDING_ROLES.has(b.role)) {
      errors.push({
        severity: "error",
        code: "INVALID_BINDING_ROLE",
        message: `Invalid binding role ${b.role}`,
        field: "bindings",
      });
    }
    const key = `${b.spellId}:${b.role}`;
    if (seenBindings.has(key)) {
      errors.push({
        severity: "error",
        code: "DUPLICATE_BINDING",
        message: `Duplicate binding ${key}`,
        field: "bindings",
      });
    }
    seenBindings.add(key);
    if (b.role === "PRIMARY_ACTIVATION") primaryCount += 1;
  }
  if (bindings.length === 0) {
    warnings.push({
      severity: "warning",
      code: "MISSING_PRIMARY_BINDING",
      message: "No typed bindings; at least one PRIMARY_ACTIVATION is required before publish review",
      field: "bindings",
    });
  } else if (primaryCount === 0) {
    errors.push({
      severity: "error",
      code: "MISSING_PRIMARY_BINDING",
      message: "Exactly one PRIMARY_ACTIVATION binding is required when bindings are present",
      field: "bindings",
    });
  } else if (primaryCount > 1) {
    errors.push({
      severity: "error",
      code: "MULTIPLE_PRIMARY_BINDING",
      message: "Only one PRIMARY_ACTIVATION binding is allowed",
      field: "bindings",
    });
  }

  if (draft.canonicalKey) {
    if (!isValidCanonicalKeyFormat(draft.canonicalKey)) {
      errors.push({
        severity: "error",
        code: "INVALID_CANONICAL_KEY",
        message: `canonicalKey ${draft.canonicalKey} does not match required format`,
        field: "canonicalKey",
      });
    }
    if (runtimeKeys.has(draft.canonicalKey) || draftKeys.has(draft.canonicalKey)) {
      errors.push({
        severity: "error",
        code: "CANONICAL_KEY_COLLISION",
        message: `canonicalKey ${draft.canonicalKey} collides with runtime or another draft`,
        field: "canonicalKey",
      });
    }
  } else {
    warnings.push({
      severity: "warning",
      code: "MISSING_CANONICAL_KEY",
      message: "canonicalKey not finalized; draft remains NEEDS_METADATA",
      field: "canonicalKey",
    });
  }

  if (draft.classSlug && !isKnownRetailClassSlug(draft.classSlug)) {
    errors.push({
      severity: "error",
      code: "UNKNOWN_CLASS",
      message: `Unknown class ${draft.classSlug}`,
      field: "classSlug",
    });
  }
  for (const spec of draft.specSlugs ?? []) {
    if (draft.classSlug && !isKnownRetailSpec(draft.classSlug, spec)) {
      errors.push({
        severity: "error",
        code: "INVALID_SPEC",
        message: `Unknown spec ${draft.classSlug}/${spec}`,
        field: "specSlugs",
      });
    }
  }
  for (const race of draft.raceSlugs ?? []) {
    if (!isKnownRetailRaceSlug(race)) {
      warnings.push({
        severity: "warning",
        code: "UNKNOWN_RACE_TO_RUNTIME",
        message: `Race ${race} is not in the current runtime race table (draft topology may accept it separately)`,
        field: "raceSlugs",
      });
    }
  }

  if (draft.category != null && !CATEGORIES.has(draft.category)) {
    errors.push({
      severity: "error",
      code: "INVALID_CATEGORY",
      message: `Invalid category ${draft.category}`,
      field: "category",
    });
  }
  if (!draft.category) {
    warnings.push({
      severity: "warning",
      code: "MISSING_CATEGORY",
      message: "Category not curated; required before READY_FOR_PUBLISH_REVIEW",
      field: "category",
    });
  }

  for (const tag of draft.dimensionTags ?? []) {
    if (!DIMENSION_TAGS.has(tag)) {
      errors.push({
        severity: "error",
        code: "INVALID_DIMENSION_TAG",
        message: `Invalid dimension tag ${tag}`,
        field: "dimensionTags",
      });
    }
  }

  if (draft.availability != null && !AVAILABILITIES.has(draft.availability)) {
    errors.push({
      severity: "error",
      code: "INVALID_AVAILABILITY",
      message: `Invalid availability ${draft.availability}`,
      field: "availability",
    });
  }
  if (!draft.availability) {
    warnings.push({
      severity: "warning",
      code: "MISSING_AVAILABILITY",
      message: "Availability not curated; required before READY_FOR_PUBLISH_REVIEW",
      field: "availability",
    });
  }

  if (draft.sourceOwnership != null && !OWNERSHIPS.has(draft.sourceOwnership)) {
    errors.push({
      severity: "error",
      code: "INVALID_SOURCE_OWNERSHIP",
      message: `Invalid sourceOwnership ${draft.sourceOwnership}`,
      field: "sourceOwnership",
    });
  }

  const provenance = draft.provenance ?? {};
  if (!provenance.source || !provenance.verifiedAt || !provenance.gameVersion) {
    warnings.push({
      severity: "warning",
      code: "MISSING_PROVENANCE",
      message: "Draft provenance incomplete for publication (source, verifiedAt, gameVersion)",
      field: "provenance",
    });
  }

  const readinessBlockers = new Set<string>();
  for (const issue of errors) readinessBlockers.add(issue.code);
  for (const issue of warnings) {
    if (
      issue.code === "MISSING_CANONICAL_KEY" ||
      issue.code === "MISSING_CATEGORY" ||
      issue.code === "MISSING_AVAILABILITY" ||
      issue.code === "MISSING_PROVENANCE" ||
      issue.code === "MISSING_PRIMARY_BINDING"
    ) {
      readinessBlockers.add(issue.code);
    }
  }

  const blockingForReady = readinessBlockers.size > 0;

  return {
    readyForPublishReview: !blockingForReady,
    status: blockingForReady ? "NEEDS_METADATA" : "READY_FOR_PUBLISH_REVIEW",
    reasonCodes: [...readinessBlockers].sort(),
    errors,
    warnings,
  };
}
