import type { AbilityCatalog, AbilityCategory } from "@mplus/abilities";
import { rulesForSpell, spellIdsForCategory } from "@mplus/abilities";

export type UtilityWclStream =
  | "Interrupts"
  | "Casts"
  | "Dispels"
  | "Buffs"
  | "Debuffs";

export type UtilityCatalogAuditKind =
  | "CATALOG_MATCH"
  | "CROSS_STREAM_MATCH"
  | "ALIAS_MATCH"
  | "UNRESOLVED";

export interface UtilityCatalogSpellAudit {
  spellId: number;
  wclStream: UtilityWclStream;
  kind: UtilityCatalogAuditKind;
  catalogCategory: AbilityCategory | null;
  canonicalKey: string | null;
  canonicalName: string | null;
  note: string | null;
}

const CC_CATEGORIES: AbilityCategory[] = ["HARD_CC", "SOFT_CC"];

/** CC abilities that WCL sometimes emits on the Interrupts stream instead of Casts. */
export const KNOWN_CROSS_STREAM_CC_IN_INTERRUPTS = new Set([710, 30283]);

/**
 * Classify a spell ID observed on a WCL event stream against the ability catalog.
 * Cross-stream matches (e.g. Banish/Shadowfury on Interrupts) are catalog-known but not unmatched.
 */
export function auditCatalogSpellOnStream(
  spellId: number,
  wclStream: UtilityWclStream,
  catalog: AbilityCatalog,
  options: { classSlug?: string | null; specSlug?: string | null } = {},
): UtilityCatalogSpellAudit {
  const rules = rulesForSpell(catalog, spellId).filter((r) => {
    if (r.classSlug != null && options.classSlug && r.classSlug !== options.classSlug) return false;
    if (r.specSlugs.length > 0 && options.specSlug && !r.specSlugs.includes(options.specSlug)) {
      return false;
    }
    return true;
  });

  if (rules.length === 0) {
    return {
      spellId,
      wclStream,
      kind: "UNRESOLVED",
      catalogCategory: null,
      canonicalKey: null,
      canonicalName: null,
      note: "No catalog rule for spell ID",
    };
  }

  const rule = rules[0]!;
  const primaryId = rule.spellIds[0] ?? spellId;
  const isAlias = spellId !== primaryId && (rule.aliases ?? []).includes(spellId);

  if (wclStream === "Interrupts") {
    const interruptIds = spellIdsForCategory(catalog, "INTERRUPT", options);
    if (CC_CATEGORIES.includes(rule.category) || KNOWN_CROSS_STREAM_CC_IN_INTERRUPTS.has(spellId)) {
      return {
        spellId,
        wclStream,
        kind: "CROSS_STREAM_MATCH",
        catalogCategory: rule.category,
        canonicalKey: rule.canonicalKey,
        canonicalName: rule.name,
        note: `Catalog ${rule.category} ability observed on WCL Interrupts stream — not an interrupt for scoring`,
      };
    }
    if (!interruptIds.has(spellId)) {
      return {
        spellId,
        wclStream,
        kind: "UNRESOLVED",
        catalogCategory: rule.category,
        canonicalKey: rule.canonicalKey,
        canonicalName: rule.name,
        note: "Catalog match but not in INTERRUPT toolkit for this character",
      };
    }
  }

  return {
    spellId,
    wclStream,
    kind: isAlias ? "ALIAS_MATCH" : "CATALOG_MATCH",
    catalogCategory: rule.category,
    canonicalKey: rule.canonicalKey,
    canonicalName: rule.name,
    note: isAlias ? `Alias of primary spell ID ${primaryId}` : null,
  };
}

export function collectCatalogAuditsFromNormalizedRun(input: {
  interruptSpellIds: number[];
  dispelSpellIds: number[];
  castSpellIds: number[];
  catalog: AbilityCatalog;
  classSlug: string | null;
  specSlug: string | null;
}): UtilityCatalogSpellAudit[] {
  const seen = new Set<number>();
  const audits: UtilityCatalogSpellAudit[] = [];

  const add = (spellId: number, stream: UtilityWclStream) => {
    if (seen.has(spellId)) return;
    seen.add(spellId);
    audits.push(
      auditCatalogSpellOnStream(spellId, stream, input.catalog, {
        classSlug: input.classSlug,
        specSlug: input.specSlug,
      }),
    );
  };

  for (const id of input.interruptSpellIds) add(id, "Interrupts");
  for (const id of input.dispelSpellIds) add(id, "Dispels");
  for (const id of input.castSpellIds) add(id, "Casts");

  return audits.sort((a, b) => a.spellId - b.spellId);
}
