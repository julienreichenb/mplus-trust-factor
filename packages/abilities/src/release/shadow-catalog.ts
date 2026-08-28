/**
 * Artifact-backed shadow catalog helpers for parity tooling only.
 * Does not replace production registry functions.
 */

import type {
  AbilityCatalog,
  AbilityCatalogLookup,
  AbilityCatalogUnsupportedReason,
  AbilityRole,
  AbilityRule,
  CatalogSupportState,
  GetAbilityCatalogResult,
} from "../types.js";
import {
  resolveAbilityRuleBySpellId,
  ruleResolvableSpellIds,
  type AbilitySpellIdResolution,
} from "../registry.js";
import { canonicalizeRetailClassSpecIdentity } from "../catalog/classes-matrix.js";
import {
  CATALOG_GAME_VERSION,
  CATALOG_SEASON_SLUG,
  CURRENT_CATALOG_VERSION,
  CURRENT_CATALOG_VERSION_ID,
  HISTORICAL_CATALOG_VERSIONS,
} from "../version.js";
import type { AbilityCatalogReleaseArtifact, ReleaseTopology } from "./types.js";

function ruleAppliesToSpec(rule: AbilityRule, classSlug: string, specSlug: string): boolean {
  if (rule.classSlug == null) return true;
  if (rule.classSlug !== classSlug) return false;
  if (rule.specSlugs.length === 0) return true;
  return rule.specSlugs.includes(specSlug);
}

function ruleAppliesToRole(rule: AbilityRule, role?: AbilityRole): boolean {
  if (!role) return true;
  return rule.roles.includes(role);
}

/** Mirror of registry filterRulesForLookup for artifact rule pools. */
export function filterArtifactRulesForLookup(
  rules: readonly AbilityRule[],
  classSlug: string,
  specSlug: string,
  role: AbilityRole | undefined,
  includeShared: boolean,
  includeRacials: boolean,
): AbilityRule[] {
  return rules.filter((rule) => {
    if (rule.classSlug == null) {
      if (rule.availability === "SHARED" && rule.category === "CONSUMABLE") return includeShared;
      if (rule.canonicalKey.startsWith("shared.racial.")) return includeRacials;
      return includeShared;
    }
    return ruleAppliesToSpec(rule, classSlug, specSlug) && ruleAppliesToRole(rule, role);
  });
}

function findClass(topology: ReleaseTopology, classSlug: string) {
  return topology.classes.find((c) => c.slug === classSlug);
}

function findSpec(topology: ReleaseTopology, classSlug: string, specSlug: string) {
  return findClass(topology, classSlug)?.specs.find((s) => s.slug === specSlug);
}

function emptyUnsupported(
  classSlug: string | null,
  specSlug: string | null,
  reason: AbilityCatalogUnsupportedReason,
  supportState: CatalogSupportState | undefined,
  consumables: AbilityRule[],
): AbilityCatalog {
  return {
    version: CURRENT_CATALOG_VERSION,
    catalogVersion: "unsupported",
    classSlug,
    specSlug,
    supported: false,
    supportState,
    unsupportedReason: reason,
    rules: consumables,
  };
}

/**
 * Shadow of resolveAbilityCatalog using artifact topology + rules.
 * Game-version checks still use CURRENT_CATALOG_VERSION / HISTORICAL pins for Bootstrap parity.
 */
export function resolveAbilityCatalogFromArtifact(
  artifact: AbilityCatalogReleaseArtifact,
  lookup: AbilityCatalogLookup,
): GetAbilityCatalogResult {
  const identity = canonicalizeRetailClassSpecIdentity({
    classSlug: lookup.classSlug,
    specSlug: lookup.specSlug,
  });
  const classSlug = identity.classSlug ?? "";
  const specSlug = identity.specSlug ?? "";
  const role = lookup.role ?? undefined;
  const { gameVersion, includeShared = true, includeRacials = false } = lookup;

  if (!classSlug || !specSlug) {
    return {
      ok: false,
      reason: "CLASS_SPEC_UNKNOWN",
      classSlug: classSlug || "unknown",
      specSlug: specSlug || "unknown",
      role,
      gameVersion: gameVersion ?? undefined,
    };
  }

  if (gameVersion && !HISTORICAL_CATALOG_VERSIONS.some((v) => v.gameVersion === gameVersion)) {
    return {
      ok: false,
      reason: "UNSUPPORTED_VERSION",
      classSlug,
      specSlug,
      role,
      gameVersion,
    };
  }

  const classDef = findClass(artifact.topology, classSlug);
  if (!classDef) {
    return {
      ok: false,
      reason: "UNKNOWN_CLASS",
      classSlug,
      specSlug,
      role,
      gameVersion: gameVersion ?? undefined,
    };
  }

  const specDef = findSpec(artifact.topology, classSlug, specSlug);
  if (!specDef) {
    return {
      ok: false,
      reason: "UNKNOWN_SPEC",
      classSlug,
      specSlug,
      role,
      gameVersion: gameVersion ?? undefined,
    };
  }

  if (specDef.supportState === "UNSUPPORTED" || classDef.supportState === "UNSUPPORTED") {
    return {
      ok: false,
      reason: "UNSUPPORTED_SPEC",
      classSlug,
      specSlug,
      role,
      gameVersion: gameVersion ?? undefined,
    };
  }

  const rules = filterArtifactRulesForLookup(
    artifact.rules,
    classSlug,
    specSlug,
    role,
    includeShared,
    includeRacials,
  );

  const catalogVersion =
    gameVersion && gameVersion !== CATALOG_GAME_VERSION
      ? `${gameVersion}/${CATALOG_SEASON_SLUG}`
      : CURRENT_CATALOG_VERSION_ID;

  return {
    ok: true,
    supportState: specDef.supportState,
    catalog: {
      version: CURRENT_CATALOG_VERSION,
      catalogVersion,
      classSlug,
      specSlug,
      supported: true,
      supportState: specDef.supportState,
      rules,
    },
  };
}

export function getAbilityCatalogFromArtifact(
  artifact: AbilityCatalogReleaseArtifact,
  lookup: AbilityCatalogLookup,
): AbilityCatalog {
  const resolved = resolveAbilityCatalogFromArtifact(artifact, lookup);
  if (resolved.ok) return resolved.catalog;

  const identity = canonicalizeRetailClassSpecIdentity({
    classSlug: lookup.classSlug,
    specSlug: lookup.specSlug,
  });
  const classSlug = identity.classSlug;
  const specSlug = identity.specSlug;
  const specDef =
    classSlug && specSlug ? findSpec(artifact.topology, classSlug, specSlug) : undefined;
  const consumables = artifact.rules.filter(
    (r) => r.availability === "SHARED" && r.category === "CONSUMABLE",
  );

  return emptyUnsupported(
    classSlug,
    specSlug,
    resolved.reason,
    specDef?.supportState,
    consumables,
  );
}

export function resolveAbilityRuleBySpellIdFromArtifact(
  artifact: AbilityCatalogReleaseArtifact,
  options: {
    spellId: number;
    classSlug?: string | null;
    specSlug?: string | null;
  },
): AbilitySpellIdResolution {
  const identity = canonicalizeRetailClassSpecIdentity({
    classSlug: options.classSlug,
    specSlug: options.specSlug,
  });
  return resolveAbilityRuleBySpellId({
    spellId: options.spellId,
    classSlug: identity.classSlug,
    specSlug: identity.specSlug,
    rules: artifact.rules,
  });
}

export function allResolvableSpellIdsFromRules(rules: readonly AbilityRule[]): number[] {
  const ids = new Set<number>();
  for (const rule of rules) {
    for (const id of ruleResolvableSpellIds(rule)) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}
