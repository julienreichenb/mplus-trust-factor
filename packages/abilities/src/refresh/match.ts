import type { AbilityRule } from "../types.js";
import { projectCurrentRuleBindings } from "./bindings.js";
import type { ExternalAbilityCandidate } from "./types.js";

export interface MatchPair {
  status: "matched" | "ambiguous";
  candidate?: ExternalAbilityCandidate;
  current?: AbilityRule;
  candidates?: ExternalAbilityCandidate[];
  currents?: AbilityRule[];
}

function racesCompatible(candidate: ExternalAbilityCandidate, rule: AbilityRule): boolean {
  const raceA = [...(candidate.raceSlugs ?? [])].sort();
  const raceB = [...(rule.raceSlugs ?? [])].sort();
  if (raceA.length === 0 && raceB.length === 0) return true;
  // Overlap is enough for racials (catalog may list allied races together).
  if (raceA.length > 0 && raceB.length > 0) {
    return raceA.some((r) => raceB.includes(r));
  }
  return true;
}

function sameApplicability(candidate: ExternalAbilityCandidate, rule: AbilityRule): boolean {
  if ((candidate.classSlug ?? null) !== (rule.classSlug ?? null)) return false;
  return racesCompatible(candidate, rule);
}

function ruleCoversSpellId(rule: AbilityRule, spellId: number): boolean {
  if (rule.spellIds.includes(spellId)) return true;
  if ((rule.aliases ?? []).includes(spellId)) return true;
  if ((rule.activationSpellIds ?? []).includes(spellId)) return true;
  return projectCurrentRuleBindings(rule).some((b) => b.spellId === spellId);
}

/**
 * Deterministic candidate ↔ current matching.
 * Never silently picks among collisions — those become AMBIGUOUS.
 */
export function matchCandidatesToCurrent(
  candidates: ExternalAbilityCandidate[],
  currentRules: AbilityRule[],
): {
  pairs: Array<{ candidate: ExternalAbilityCandidate; current: AbilityRule }>;
  ambiguous: MatchPair[];
  unmatchedCandidates: ExternalAbilityCandidate[];
  unmatchedCurrent: AbilityRule[];
} {
  const usedCandidates = new Set<string>();
  const usedCurrent = new Set<string>();
  const pairs: Array<{ candidate: ExternalAbilityCandidate; current: AbilityRule }> = [];
  const ambiguous: MatchPair[] = [];

  const byKey = new Map(currentRules.map((r) => [r.canonicalKey, r]));

  for (const candidate of candidates) {
    const keyHit = byKey.get(candidate.candidateKey);
    if (keyHit) {
      const collisions = candidates.filter((c) => c.candidateKey === candidate.candidateKey);
      if (collisions.length > 1) {
        ambiguous.push({
          status: "ambiguous",
          candidates: collisions,
          currents: [keyHit],
        });
        usedCandidates.add(candidate.candidateKey);
        usedCurrent.add(keyHit.canonicalKey);
        continue;
      }
      pairs.push({ candidate, current: keyHit });
      usedCandidates.add(candidate.candidateKey);
      usedCurrent.add(keyHit.canonicalKey);
    }
  }

  for (const candidate of candidates) {
    if (usedCandidates.has(candidate.candidateKey)) continue;
    const idHits = currentRules.filter((rule) => {
      if (usedCurrent.has(rule.canonicalKey)) return false;
      if (!ruleCoversSpellId(rule, candidate.primarySpellId)) return false;
      return sameApplicability(candidate, rule) || rule.classSlug == null || candidate.classSlug == null;
    });

    if (idHits.length === 1) {
      const current = idHits[0]!;
      pairs.push({ candidate, current });
      usedCandidates.add(candidate.candidateKey);
      usedCurrent.add(current.canonicalKey);
    } else if (idHits.length > 1) {
      ambiguous.push({
        status: "ambiguous",
        candidate,
        currents: idHits,
      });
      usedCandidates.add(candidate.candidateKey);
      for (const r of idHits) usedCurrent.add(r.canonicalKey);
    }
  }

  const unmatchedCandidates = candidates.filter((c) => !usedCandidates.has(c.candidateKey));
  const unmatchedCurrent = currentRules.filter((r) => !usedCurrent.has(r.canonicalKey));
  return { pairs, ambiguous, unmatchedCandidates, unmatchedCurrent };
}
