/**
 * Interrupt-priority mechanic catalog coverage for Utility opportunity severity.
 * Unknown hostile casts stay neutral — never guess severity.
 */
import type { MechanicCatalog, MechanicRule } from "@mplus/mechanics";
import { createEmptyCatalog } from "@mplus/mechanics";

export const INTERRUPT_CATALOG_PREP_VERSION = "0.2.0-prep";

export interface InterruptCatalogCoverage {
  catalogVersion: string;
  seasonSlug: string | null;
  observedHostileSpellIds: number[];
  knownPriorityInterruptSpellIds: number[];
  coveredSpellIds: number[];
  uncoveredSpellIds: number[];
  coverageRatio: number;
  verificationStatus: "seed" | "partial" | "verified" | "empty";
  notes: string[];
}

export function priorityInterruptRules(catalog: MechanicCatalog): MechanicRule[] {
  return catalog.rules.filter(
    (r) => r.active && (r.ruleType === "PRIORITY_INTERRUPT" || r.ruleType === "CROWD_CONTROL"),
  );
}

export function measureInterruptCatalogCoverage(input: {
  catalog: MechanicCatalog;
  observedHostileSpellIds: number[];
}): InterruptCatalogCoverage {
  const priority = priorityInterruptRules(input.catalog);
  const known = [...new Set(priority.map((r) => r.spellId))];
  const observed = [...new Set(input.observedHostileSpellIds.filter((id) => Number.isFinite(id)))];
  const knownSet = new Set(known);
  const covered = observed.filter((id) => knownSet.has(id));
  const uncovered = observed.filter((id) => !knownSet.has(id));
  const coverageRatio = observed.length === 0 ? 1 : covered.length / observed.length;

  let verificationStatus: InterruptCatalogCoverage["verificationStatus"] = "empty";
  if (priority.length === 0) verificationStatus = "empty";
  else if (priority.every((r) => r.source === "seed")) verificationStatus = "seed";
  else if (uncovered.length > 0) verificationStatus = "partial";
  else verificationStatus = "verified";

  return {
    catalogVersion: input.catalog.catalogVersion,
    seasonSlug: input.catalog.seasonSlug,
    observedHostileSpellIds: observed,
    knownPriorityInterruptSpellIds: known,
    coveredSpellIds: covered,
    uncoveredSpellIds: uncovered,
    coverageRatio: Math.round(coverageRatio * 1000) / 1000,
    verificationStatus,
    notes: [
      "Uncovered hostile spells remain severity-neutral (default 0.55 in opportunity engine).",
      "Do not invent PRIORITY_INTERRUPT rules from cast volume alone.",
    ],
  };
}

/** Prepared active-season catalog shell — populate rules via verified sources only. */
export function prepareActiveSeasonInterruptCatalog(input: {
  seasonSlug: string;
  rules?: MechanicRule[];
}): MechanicCatalog {
  const base = createEmptyCatalog(INTERRUPT_CATALOG_PREP_VERSION);
  return {
    ...base,
    catalogVersion: INTERRUPT_CATALOG_PREP_VERSION,
    seasonSlug: input.seasonSlug,
    rules: input.rules ?? [],
  };
}

export function toUtilityMechanicCatalog(catalog: MechanicCatalog): {
  rules: Array<{
    spellId: number;
    dungeonSlug: string;
    ruleType: string;
    severity: number;
    active: boolean;
  }>;
  catalogVersion: string;
} {
  return {
    catalogVersion: catalog.catalogVersion,
    rules: catalog.rules.map((r) => ({
      spellId: r.spellId,
      dungeonSlug: r.dungeonSlug,
      ruleType: r.ruleType,
      severity: r.severity * 20, // MechanicCatalog severity is small ints; engine expects ~0–100 scale
      active: r.active,
    })),
  };
}
