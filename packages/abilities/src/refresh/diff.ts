import type { AbilityRule } from "../types.js";
import { compareBindingRoles, projectCurrentRuleBindings } from "./bindings.js";
import { matchCandidatesToCurrent } from "./match.js";
import { candidateMetadataForDiff } from "./review/draft-prefill.js";
import type {
  CatalogDiffEntry,
  CatalogDiffStatus,
  ExternalAbilityCandidate,
  ExternalSourceSnapshot,
  SourceObservation,
} from "./types.js";

function sorted(values: string[]): string[] {
  return [...values].sort();
}

function applicabilityChanges(candidate: ExternalAbilityCandidate, rule: AbilityRule): string[] {
  const changes: string[] = [];
  if ((candidate.classSlug ?? null) !== (rule.classSlug ?? null)) {
    changes.push(`class:${rule.classSlug ?? "null"}→${candidate.classSlug ?? "null"}`);
  }
  const specA = sorted(rule.specSlugs).join(",");
  const specB = sorted(candidate.specSlugs).join(",");
  if (specA !== specB) changes.push(`spec:${specA || "*"}→${specB || "*"}`);
  const raceA = sorted(rule.raceSlugs ?? []).join(",");
  const raceB = sorted(candidate.raceSlugs).join(",");
  if (raceA !== raceB) changes.push(`race:${raceA || "*"}→${raceB || "*"}`);
  return changes;
}

function metadataChanges(candidate: ExternalAbilityCandidate, rule: AbilityRule): string[] {
  const changes: string[] = [];
  if (candidate.name !== rule.name) changes.push(`name:${rule.name}→${candidate.name}`);
  if (
    candidate.cooldownSeconds != null &&
    rule.cooldownSeconds != null &&
    candidate.cooldownSeconds !== rule.cooldownSeconds
  ) {
    changes.push(`cooldown:${rule.cooldownSeconds}→${candidate.cooldownSeconds}`);
  }
  if (candidate.charges != null && rule.charges != null && candidate.charges !== rule.charges) {
    changes.push(`charges:${rule.charges}→${candidate.charges}`);
  }
  return changes;
}

function queryCoversRule(inv: ExternalSourceSnapshot["inventories"][number], rule: AbilityRule): boolean {
  if (inv.queryClaim !== "COMPLETE_FOR_QUERY" || inv.completeness !== "COMPLETE") return false;
  if (inv.kind === "CLASS") return inv.classSlug === rule.classSlug;
  if (inv.kind === "SPEC") {
    return (
      inv.classSlug === rule.classSlug &&
      inv.specSlug != null &&
      rule.specSlugs.includes(inv.specSlug)
    );
  }
  if (inv.kind === "RACE") {
    return inv.raceSlug != null && (rule.raceSlugs ?? []).includes(inv.raceSlug);
  }
  return false;
}

function recordMatchesRule(snap: ExternalSourceSnapshot, rule: AbilityRule): boolean {
  return snap.records.some((r) => {
    if (r.spellId === rule.spellIds[0]) return true;
    if (r.proposedCanonicalKey === rule.canonicalKey) return true;
    return r.bindings?.some((b) => rule.spellIds.includes(b.spellId)) ?? false;
  });
}

function observationsForUnmatchedCurrent(
  rule: AbilityRule,
  snapshots: ExternalSourceSnapshot[],
): SourceObservation[] {
  const observations: SourceObservation[] = [];
  for (const snap of snapshots) {
    const scoped = snap.inventories.filter((inv) => queryCoversRule(inv, rule));
    if (scoped.length === 0) continue;
    const present = recordMatchesRule(snap, rule);
    observations.push({
      source: snap.identity.source,
      state: present ? "PRESENT" : "NOT_OBSERVED_IN_CURRENT_SOURCE_QUERY",
      identity: snap.identity,
      notes: [
        present
          ? "Observed in current source snapshot."
          : "Not observed in current source queries. This is not evidence the ability was removed.",
        ...scoped.map((s) => `${s.kind}:${s.classSlug ?? s.raceSlug}/${s.specSlug ?? ""}`),
      ],
    });
  }
  return observations;
}

function pickStatus(entry: {
  bindingChanged: boolean;
  applicabilityChanged: boolean;
  metadataChanged: boolean;
  conflict: boolean;
}): CatalogDiffStatus {
  if (entry.conflict) return "SOURCE_CONFLICT";
  if (entry.bindingChanged) return "SPELL_BINDING_CHANGED";
  if (entry.applicabilityChanged) return "APPLICABILITY_CHANGED";
  if (entry.metadataChanged) return "METADATA_CHANGED";
  return "UNCHANGED";
}

function hasConflict(observations: SourceObservation[]): boolean {
  const bySource = new Map(observations.map((o) => [o.source, o.state]));
  const blizzard = bySource.get("BLIZZARD");
  const simc = bySource.get("SIMULATIONCRAFT");
  if (!blizzard || !simc) {
    return observations.some((o) => o.state === "ABSENT_FROM_SCOPED_INVENTORY") &&
      observations.some((o) => o.state === "PRESENT" || o.state === "IDENTITY_ONLY");
  }
  const presentish = (s: SourceObservation["state"]) => s === "PRESENT" || s === "IDENTITY_ONLY";
  return presentish(blizzard) && simc === "ABSENT_FROM_SCOPED_INVENTORY";
}

export function diffCandidateCatalog(input: {
  candidates: ExternalAbilityCandidate[];
  currentRules: AbilityRule[];
  snapshots: ExternalSourceSnapshot[];
  removalReviewSpellIds?: Set<number>;
}): CatalogDiffEntry[] {
  const removalIds = input.removalReviewSpellIds ?? new Set<number>();
  const { pairs, ambiguous, unmatchedCandidates, unmatchedCurrent } = matchCandidatesToCurrent(
    input.candidates,
    input.currentRules,
  );
  const entries: CatalogDiffEntry[] = [];

  for (const item of ambiguous) {
    entries.push({
      status: "AMBIGUOUS",
      candidateKey: item.candidate?.candidateKey ?? item.candidates?.[0]?.candidateKey,
      currentCanonicalKey: item.current?.canonicalKey ?? item.currents?.[0]?.canonicalKey,
      name: item.candidate?.name ?? item.current?.name ?? "ambiguous",
      primarySpellId: item.candidate?.primarySpellId ?? item.current?.spellIds[0],
      classSlug: item.candidate?.classSlug ?? item.current?.classSlug ?? null,
      specSlugs: item.candidate?.specSlugs ?? item.current?.specSlugs ?? [],
      raceSlugs: item.candidate?.raceSlugs ?? item.current?.raceSlugs ?? [],
      sourceObservations: item.candidate?.sourceObservations ?? [],
      ...(item.candidate ? candidateMetadataForDiff(item.candidate) : {}),
      ambiguousCurrentKeys: (item.currents ?? []).map((r) => r.canonicalKey),
      ambiguousCandidateKeys: (item.candidates ?? (item.candidate ? [item.candidate] : [])).map(
        (c) => c.candidateKey,
      ),
      notes: ["Matching collided; no silent winner."],
    });
  }

  for (const { candidate, current } of pairs) {
    const bindingChanges = compareBindingRoles(
      projectCurrentRuleBindings(current),
      candidate.bindings,
    );
    const appl = applicabilityChanges(candidate, current);
    const meta = metadataChanges(candidate, current);
    const conflict =
      candidate.certainty === "conflicting" || hasConflict(candidate.sourceObservations);
    const removal = removalIds.has(current.spellIds[0] ?? 0);
    entries.push({
      status: removal
        ? "REMOVAL_REVIEW_CANDIDATE"
        : pickStatus({
            bindingChanged: bindingChanges.length > 0,
            applicabilityChanged: appl.length > 0,
            metadataChanged: meta.length > 0,
            conflict,
          }),
      candidateKey: candidate.candidateKey,
      currentCanonicalKey: current.canonicalKey,
      name: candidate.name,
      primarySpellId: candidate.primarySpellId,
      classSlug: candidate.classSlug,
      specSlugs: candidate.specSlugs,
      raceSlugs: candidate.raceSlugs,
      sourceObservations: candidate.sourceObservations,
      ...candidateMetadataForDiff(candidate),
      bindingChanges: bindingChanges.length > 0 ? bindingChanges : undefined,
      metadataChanges: meta.length > 0 ? meta : undefined,
      applicabilityChanges: appl.length > 0 ? appl : undefined,
      notes: conflict
        ? ["Sources disagree; review required. Absence is not a delete."]
        : [],
    });
  }

  for (const candidate of unmatchedCandidates) {
    if (candidate.eligibilityState !== "STRONG_REVIEW_CANDIDATE") continue;
    const conflict = hasConflict(candidate.sourceObservations);
    entries.push({
      status: conflict ? "SOURCE_CONFLICT" : "MISSING_FROM_CURRENT_CATALOG",
      candidateKey: candidate.candidateKey,
      name: candidate.name,
      primarySpellId: candidate.primarySpellId,
      classSlug: candidate.classSlug,
      specSlugs: candidate.specSlugs,
      raceSlugs: candidate.raceSlugs,
      sourceObservations: candidate.sourceObservations,
      ...candidateMetadataForDiff(candidate),
      notes: [
        "STRONG catalog-review candidate not represented in the current AbilityRule catalog. External discovery is not a scoring-category decision. No automatic insert.",
        ...candidate.notes.filter(
          (n) =>
            n.startsWith("racial-variant-") ||
            n.startsWith("current-retail-ids:") ||
            n.startsWith("historical-ids-excluded:") ||
            n.startsWith("ambiguous-ids:") ||
            n.startsWith("variant:") ||
            n.startsWith("sole-conceptual-"),
        ),
      ],
    });
  }

  for (const rule of unmatchedCurrent) {
    const observations = observationsForUnmatchedCurrent(rule, input.snapshots);
    if (observations.length === 0) continue;
    const primary = rule.spellIds[0] ?? 0;
    const removal = removalIds.has(primary);
    entries.push({
      status: removal ? "REMOVAL_REVIEW_CANDIDATE" : "NOT_OBSERVED_IN_CURRENT_QUERIES",
      currentCanonicalKey: rule.canonicalKey,
      name: rule.name,
      primarySpellId: primary,
      classSlug: rule.classSlug,
      specSlugs: rule.specSlugs,
      raceSlugs: rule.raceSlugs ?? [],
      sourceObservations: observations,
      notes: removal
        ? [
            "Present in a previous equivalent pinned source snapshot and absent now. Removal review only — not an automatic delete.",
          ]
        : [
            "Current rule was not observed in the current source queries. This does not mean obsolete, removed, or safe to delete.",
          ],
    });
  }

  return entries.sort((a, b) => {
    const ak = a.currentCanonicalKey ?? a.candidateKey ?? "";
    const bk = b.currentCanonicalKey ?? b.candidateKey ?? "";
    return ak.localeCompare(bk) || a.status.localeCompare(b.status);
  });
}
