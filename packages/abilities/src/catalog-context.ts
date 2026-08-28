/**
 * Explicit ability catalog resolution context for scoring / replay.
 * Production callers without a context continue to use registry defaults.
 */

import type {
  AbilityCatalog,
  AbilityCatalogLookup,
  AbilityCatalogUnsupportedReason,
  AbilityRole,
  AbilityRule,
  CatalogSupportState,
  GetAbilityCatalogResult,
} from "./types.js";
import {
  CURRENT_CATALOG_VERSION,
  CURRENT_CATALOG_VERSION_ID,
  CATALOG_GAME_VERSION,
  CATALOG_SEASON_SLUG,
  HISTORICAL_CATALOG_VERSIONS,
} from "./version.js";
import {
  getAbilityCatalog,
  getAllRegisteredRules,
  resolveAbilityCatalog,
  resolveAbilityRuleBySpellId,
  type AbilitySpellIdResolution,
} from "./registry.js";
import {
  RETAIL_CLASS_MATRIX,
  canonicalizeRetailClassSpecIdentity,
} from "./catalog/classes-matrix.js";
import { SHARED_CONSUMABLE_RULES } from "./catalog/shared/consumables.js";
import { SHARED_RACIAL_RULES } from "./catalog/shared/racials.js";

export type AbilityCatalogContextIdentity =
  | {
      kind: "static";
      catalogVersion: string;
    }
  | {
      kind: "release";
      releaseKey: string;
      contentDigest: string;
      releaseId?: string;
    };

export interface AbilityCatalogTopologyView {
  classes: ReadonlyArray<{
    slug: string;
    supportState: CatalogSupportState;
    specs: ReadonlyArray<{
      slug: string;
      role: AbilityRole;
      supportState: CatalogSupportState;
    }>;
  }>;
  races: ReadonlyArray<{ slug: string }>;
}

export interface AbilityCatalogContext {
  readonly identity: AbilityCatalogContextIdentity;
  /** Full rule pool for this context (including shared / racials). */
  allRules(): readonly AbilityRule[];
  topology(): AbilityCatalogTopologyView;
  resolveBySpellId(options: {
    spellId: number;
    classSlug?: string | null;
    specSlug?: string | null;
  }): AbilitySpellIdResolution;
  resolveCatalog(lookup: AbilityCatalogLookup): GetAbilityCatalogResult;
  getCatalog(lookup: AbilityCatalogLookup): AbilityCatalog;
}

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

/** Shared lookup filter for static and release-backed rule pools. */
export function filterRulesForCatalogContext(
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

function staticTopologyView(): AbilityCatalogTopologyView {
  const raceSlugs = new Set<string>();
  for (const rule of SHARED_RACIAL_RULES) {
    for (const slug of rule.raceSlugs ?? []) raceSlugs.add(slug);
  }
  return {
    classes: RETAIL_CLASS_MATRIX.map((c) => ({
      slug: c.slug,
      supportState: c.supportState,
      specs: c.specs.map((s) => ({
        slug: s.slug,
        role: s.role,
        supportState: s.supportState,
      })),
    })),
    races: [...raceSlugs].sort().map((slug) => ({ slug })),
  };
}

class StaticAbilityCatalogContext implements AbilityCatalogContext {
  readonly identity: AbilityCatalogContextIdentity = {
    kind: "static",
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
  };

  allRules(): readonly AbilityRule[] {
    return getAllRegisteredRules();
  }

  topology(): AbilityCatalogTopologyView {
    return staticTopologyView();
  }

  resolveBySpellId(options: {
    spellId: number;
    classSlug?: string | null;
    specSlug?: string | null;
  }): AbilitySpellIdResolution {
    return resolveAbilityRuleBySpellId(options);
  }

  resolveCatalog(lookup: AbilityCatalogLookup): GetAbilityCatalogResult {
    return resolveAbilityCatalog(lookup);
  }

  getCatalog(lookup: AbilityCatalogLookup): AbilityCatalog {
    return getAbilityCatalog(lookup);
  }
}

let staticSingleton: AbilityCatalogContext | null = null;

/** Production default — always the current static TypeScript registry. */
export function createStaticAbilityCatalogContext(): AbilityCatalogContext {
  if (!staticSingleton) staticSingleton = new StaticAbilityCatalogContext();
  return staticSingleton;
}

/**
 * Rules + topology backed context (release artifact shadow / synthetic tests).
 * Does not import Node-only CAS helpers.
 */
export function createRulesAbilityCatalogContext(input: {
  identity: AbilityCatalogContextIdentity;
  rules: readonly AbilityRule[];
  topology: AbilityCatalogTopologyView;
}): AbilityCatalogContext {
  const rules = input.rules;
  const topology = input.topology;
  const consumables = rules.filter(
    (r) => r.availability === "SHARED" && r.category === "CONSUMABLE",
  );

  function findClass(classSlug: string) {
    return topology.classes.find((c) => c.slug === classSlug);
  }
  function findSpec(classSlug: string, specSlug: string) {
    return findClass(classSlug)?.specs.find((s) => s.slug === specSlug);
  }

  return {
    identity: input.identity,
    allRules: () => rules,
    topology: () => topology,
    resolveBySpellId(options) {
      return resolveAbilityRuleBySpellId({
        spellId: options.spellId,
        classSlug: options.classSlug,
        specSlug: options.specSlug,
        rules,
      });
    },
    resolveCatalog(lookup) {
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

      const classDef = findClass(classSlug);
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
      const specDef = findSpec(classSlug, specSlug);
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

      const filtered = filterRulesForCatalogContext(
        rules,
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
          rules: filtered,
        },
      };
    },
    getCatalog(lookup) {
      const resolved = this.resolveCatalog(lookup);
      if (resolved.ok) return resolved.catalog;
      const identity = canonicalizeRetailClassSpecIdentity({
        classSlug: lookup.classSlug,
        specSlug: lookup.specSlug,
      });
      const classSlug = identity.classSlug;
      const specSlug = identity.specSlug;
      const specDef =
        classSlug && specSlug ? findSpec(classSlug, specSlug) : undefined;
      return emptyUnsupported(
        classSlug,
        specSlug,
        resolved.reason,
        specDef?.supportState,
        consumables.length ? [...consumables] : [...SHARED_CONSUMABLE_RULES],
      );
    },
  };
}
