/**
 * Build simple factual cooldown usage rows from Survival/Utility fact sets + ability catalog.
 * No opportunity, efficiency, or good/bad judgments.
 */
import type {
  ExplainabilityV2CooldownUsageAdminDTO,
  ExplainabilityV2CooldownUsagePublicDTO,
} from "@mplus/contracts";
import { toPublicCooldownUsage } from "@mplus/contracts";
import { getAbilityCatalog } from "@mplus/abilities";

export interface CooldownUsageFactInput {
  dungeonSlug: string;
  slotIndex: 0 | 1;
  keyLevel: number | null;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  classSlug: string | null;
  specSlug: string | null;
  catalogVersion: string | null;
  extractorVersion: string | null;
  evidenceCoverageState: string;
  sourceDataset: string | null;
  /** Map canonicalKey → observed use count (from extractor facts). */
  useCountsByCanonicalKey: Record<string, number>;
  /** Map canonicalKey → observed spell id when known. */
  observedSpellIdByCanonicalKey?: Record<string, number | null>;
  unmappedSpellIds?: number[];
  truncationWarnings?: string[];
  coverageWarnings?: string[];
}

const SURVIVAL_CATEGORIES = new Set([
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
  "SELF_HEAL",
  "HEALTH_POTION",
  "PERSONAL_DEFENSIVE",
]);

const UTILITY_CATEGORIES = new Set([
  "INTERRUPT",
  "HARD_CC",
  "SOFT_CC",
  "DISPEL",
  "PURGE",
  "EXTERNAL",
  "GROUP_UTILITY",
  "BATTLE_RESURRECTION",
  "BLOODLUST",
]);

function dimensionForCategory(category: string): "SURVIVAL" | "UTILITY" | null {
  if (SURVIVAL_CATEGORIES.has(category)) return "SURVIVAL";
  if (UTILITY_CATEGORIES.has(category)) return "UTILITY";
  // Heuristic fallbacks for catalog naming variants.
  if (category.includes("DEFENSIVE") || category.includes("IMMUNITY") || category.includes("HEAL")) {
    return "SURVIVAL";
  }
  if (
    category.includes("INTERRUPT") ||
    category.includes("CC") ||
    category.includes("DISPEL") ||
    category.includes("UTILITY")
  ) {
    return "UTILITY";
  }
  return null;
}

export function buildCooldownUsageAdminRows(
  input: CooldownUsageFactInput,
): ExplainabilityV2CooldownUsageAdminDTO[] {
  if (!input.classSlug || !input.specSlug) return [];
  const catalog = getAbilityCatalog({
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });
  if (!catalog.supported) return [];

  const rows: ExplainabilityV2CooldownUsageAdminDTO[] = [];
  for (const rule of catalog.rules) {
    const dimension = dimensionForCategory(rule.category);
    if (!dimension) continue;
    const useCount = input.useCountsByCanonicalKey[rule.canonicalKey] ?? 0;
    rows.push({
      canonicalKey: rule.canonicalKey,
      displayName: rule.name,
      category: rule.category,
      dimension,
      observedSpellId:
        input.observedSpellIdByCanonicalKey?.[rule.canonicalKey] ?? rule.spellIds[0] ?? null,
      useCount,
      dungeonSlug: input.dungeonSlug,
      slotIndex: input.slotIndex,
      keyLevel: input.keyLevel,
      catalogVersion: input.catalogVersion ?? catalog.catalogVersion,
      evidenceCoverageState: input.evidenceCoverageState,
      reportCode: input.reportCode,
      fightId: input.fightId,
      reportRevision: input.reportRevision,
      sourceDataset: input.sourceDataset,
      extractorVersion: input.extractorVersion,
      unmappedSpellIds: input.unmappedSpellIds ?? [],
      truncationWarnings: input.truncationWarnings ?? [],
      coverageWarnings: input.coverageWarnings ?? [],
    });
  }
  return rows;
}

export function buildCooldownUsagePublicRows(
  adminRows: ExplainabilityV2CooldownUsageAdminDTO[],
): ExplainabilityV2CooldownUsagePublicDTO[] {
  return adminRows.map(toPublicCooldownUsage);
}
