import type { AbilityRule } from "../types.js";
import type { ReleaseTopology } from "./types.js";

/** Spell ids that participate in duplicate-spell validation for a rule. */
export function collectRuleSpellIds(rule: AbilityRule): number[] {
  return [
    ...new Set([
      ...rule.spellIds,
      ...(rule.aliases ?? []),
      ...(rule.activationSpellIds ?? []),
    ]),
  ];
}

/** Keep only race slugs present in release topology (excludes EXTERNAL_ONLY races). */
export function filterRaceSlugsForTopology(
  raceSlugs: readonly string[] | undefined,
  topology: ReleaseTopology,
): string[] | undefined {
  if (!raceSlugs?.length) return undefined;
  const allowed = new Set(topology.races.map((race) => race.slug));
  const filtered = [...raceSlugs].filter((slug) => allowed.has(slug)).sort();
  if (filtered.length === 0) return undefined;
  return filtered;
}

/** Project a curated draft rule onto publishable release topology. */
export function projectDraftRuleForRelease(
  rule: AbilityRule,
  topology: ReleaseTopology,
): AbilityRule {
  const original = [...(rule.raceSlugs ?? [])].sort();
  const filtered = filterRaceSlugsForTopology(rule.raceSlugs, topology) ?? [];
  if (original.join(",") === filtered.join(",")) return rule;
  const next = { ...rule };
  if (filtered.length > 0) {
    next.raceSlugs = filtered;
  } else {
    delete next.raceSlugs;
  }
  return next;
}

export function findActiveRuleOwningSpell(
  rules: readonly AbilityRule[],
  spellId: number,
): AbilityRule | undefined {
  return rules.find(
    (rule) => !rule.validToBuild && collectRuleSpellIds(rule).includes(spellId),
  );
}

/**
 * NEW_ABILITY adds whose primary spell ids are already owned by another live rule
 * (e.g. Heroism 32182 alias on shaman.bloodlust.bloodlust) are publish no-ops.
 */
export function isRedundantAddAgainstActiveCatalog(
  candidate: AbilityRule,
  activeRules: readonly AbilityRule[],
): boolean {
  if (
    activeRules.some(
      (rule) => rule.canonicalKey === candidate.canonicalKey && !rule.validToBuild,
    )
  ) {
    return false;
  }
  if (candidate.spellIds.length === 0) return false;
  return candidate.spellIds.every((spellId) => {
    const owner = findActiveRuleOwningSpell(activeRules, spellId);
    return owner != null && owner.canonicalKey !== candidate.canonicalKey;
  });
}

export function formatArtifactValidationIssue(
  issue: { code: string; message: string; canonicalKey?: string },
): string {
  const key = issue.canonicalKey ? ` | ${issue.canonicalKey}` : "";
  return `${issue.code}${key}: ${issue.message}`;
}
