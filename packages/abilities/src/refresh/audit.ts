import type { AbilityRule } from "../types.js";
import { SHARED_RACIAL_RULES } from "../catalog/shared/racials.js";
import { projectCurrentRuleBindings } from "./bindings.js";
import type {
  CatalogDiffEntry,
  CatalogDiffStatus,
  ExternalAbilityCandidate,
  ExternalSourceSnapshot,
} from "./types.js";

export interface CurrentRuleAuditRow {
  canonicalKey: string;
  name: string;
  primarySpellId: number;
  classSlug: string | null;
  specSlugs: string[];
  matchStatus: CatalogDiffStatus | "NOT_IN_DIFF";
  hasPrimaryIdentity: boolean;
  hasApplicabilityEvidence: boolean;
  hasCooldown: boolean;
  hasBindingEvidence: boolean;
  activePassive: "active" | "passive" | "unknown" | "unobserved";
  sourceDisagreement: boolean;
}

export interface RacialAuditRow {
  raceSlug: string;
  activeCandidates: string[];
  passiveDiscoveries: string[];
  matchedCurrentKeys: string[];
  missingCurrentActive: string[];
  currentMissingExternally: string[];
  multiRaceMappings: string[];
  ambiguous: string[];
}

export function auditCurrentRules(input: {
  rules: AbilityRule[];
  candidates: ExternalAbilityCandidate[];
  diff: CatalogDiffEntry[];
}): CurrentRuleAuditRow[] {
  const byKey = new Map(input.diff.filter((d) => d.currentCanonicalKey).map((d) => [d.currentCanonicalKey!, d]));
  const candById = new Map<number, ExternalAbilityCandidate[]>();
  for (const c of input.candidates) {
    const list = candById.get(c.primarySpellId) ?? [];
    list.push(c);
    candById.set(c.primarySpellId, list);
  }
  return [...input.rules]
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey))
    .map((rule) => {
      const primary = rule.spellIds[0] ?? 0;
      const hits = candById.get(primary) ?? [];
      const diff = byKey.get(rule.canonicalKey);
      const candidate = hits[0];
      return {
        canonicalKey: rule.canonicalKey,
        name: rule.name,
        primarySpellId: primary,
        classSlug: rule.classSlug,
        specSlugs: [...rule.specSlugs].sort(),
        matchStatus: diff?.status ?? (hits.length ? "UNCHANGED" : "NOT_IN_DIFF"),
        hasPrimaryIdentity: hits.length > 0,
        hasApplicabilityEvidence:
          hits.some((c) => c.classSlug === rule.classSlug) ||
          hits.some((c) => c.raceSlugs.some((r) => (rule.raceSlugs ?? []).includes(r))),
        hasCooldown: candidate?.cooldownSeconds != null || rule.cooldownSeconds != null,
        hasBindingEvidence: (candidate?.bindings.length ?? projectCurrentRuleBindings(rule).length) > 0,
        activePassive:
          candidate == null
            ? "unobserved"
            : candidate.isPassive === true
              ? "passive"
              : candidate.isPassive === false
                ? "active"
                : "unknown",
        sourceDisagreement:
          diff?.status === "SOURCE_CONFLICT" || candidate?.certainty === "conflicting",
      };
    });
}

export function auditRacials(input: {
  candidates: ExternalAbilityCandidate[];
  diff: CatalogDiffEntry[];
  snapshots: ExternalSourceSnapshot[];
}): RacialAuditRow[] {
  const races = [
    ...new Set(
      input.snapshots.flatMap((s) => s.inventories.map((i) => i.raceSlug).filter((r): r is string => !!r)),
    ),
  ].sort();
  const current = SHARED_RACIAL_RULES;
  return races.map((raceSlug) => {
    const cands = input.candidates.filter((c) => c.raceSlugs.includes(raceSlug));
    const active = cands.filter((c) => c.catalogRelevance === "ACTIVE_CANDIDATE");
    const passive = cands.filter((c) => c.catalogRelevance === "PASSIVE_DISCOVERED");
    const matched = current.filter((r) => (r.raceSlugs ?? []).includes(raceSlug));
    const missingCurrent = active.filter(
      (c) => !matched.some((r) => r.spellIds.includes(c.primarySpellId) || r.canonicalKey === c.candidateKey),
    );
    const currentMissing = matched.filter(
      (r) =>
        input.diff.some(
          (d) =>
            d.currentCanonicalKey === r.canonicalKey &&
            (d.status === "NOT_OBSERVED_IN_CURRENT_QUERIES" || d.status === "REMOVAL_REVIEW_CANDIDATE"),
        ),
    );
    const multi = cands.filter((c) => c.raceSlugs.length > 1);
    const ambiguous = input.diff
      .filter((d) => d.status === "AMBIGUOUS" && (d.raceSlugs ?? []).includes(raceSlug))
      .map((d) => d.candidateKey ?? d.currentCanonicalKey ?? "");
    return {
      raceSlug,
      activeCandidates: active.map((c) => c.candidateKey).sort(),
      passiveDiscoveries: passive.map((c) => c.candidateKey).sort(),
      matchedCurrentKeys: matched.map((r) => r.canonicalKey).sort(),
      missingCurrentActive: missingCurrent.map((c) => c.candidateKey).sort(),
      currentMissingExternally: currentMissing.map((r) => r.canonicalKey).sort(),
      multiRaceMappings: multi.map((c) => `${c.candidateKey}:${c.raceSlugs.join("+")}`).sort(),
      ambiguous: ambiguous.filter(Boolean).sort(),
    };
  });
}

export function diffTotals(diff: CatalogDiffEntry[]): Record<CatalogDiffStatus, number> {
  const totals: Record<CatalogDiffStatus, number> = {
    UNCHANGED: 0,
    MISSING_FROM_CURRENT_CATALOG: 0,
    MISSING_FROM_EXTERNAL_SOURCES: 0,
    NOT_OBSERVED_IN_CURRENT_QUERIES: 0,
    REMOVAL_REVIEW_CANDIDATE: 0,
    METADATA_CHANGED: 0,
    APPLICABILITY_CHANGED: 0,
    SPELL_BINDING_CHANGED: 0,
    AMBIGUOUS: 0,
    SOURCE_CONFLICT: 0,
  };
  for (const row of diff) totals[row.status] += 1;
  return totals;
}
