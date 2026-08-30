import { normalizeRetailClassSlug } from "../catalog/classes-matrix.js";
import { normalizeRaceSlug } from "../race.js";
import { assessCatalogEligibility } from "./eligibility.js";
import { dedupeBindings } from "./bindings.js";
import {
  deriveAvailabilityFromSimcMembership,
  mergeSimcMembership,
} from "./extract/simc-availability.js";
import type {
  CatalogRelevance,
  ExternalAbilityCandidate,
  ExternalSourceRecord,
  ExternalSourceSnapshot,
  RefreshCertainty,
  SourceObservation,
} from "./types.js";

function candidateKeyFor(record: ExternalSourceRecord, fallbackClass: string | null): string {
  if (record.proposedCanonicalKey?.trim()) return record.proposedCanonicalKey.trim();
  const cls = fallbackClass ?? "shared";
  const slug = record.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${cls}.refresh.${slug || "spell"}-${record.spellId}`;
}

function relevanceFor(record: ExternalSourceRecord): CatalogRelevance {
  if (record.catalogRelevant === true) return "ACTIVE_CANDIDATE";
  if (record.isPassive === true) return "PASSIVE_DISCOVERED";
  if (record.catalogRelevant === false) return "UNCLASSIFIED";
  if (record.isPassive === false) return "ACTIVE_CANDIDATE";
  return "UNCLASSIFIED";
}

function observationFor(
  snapshot: ExternalSourceSnapshot,
  record: ExternalSourceRecord,
): SourceObservation {
  const specInventory = snapshot.inventories.find(
    (i) =>
      i.kind === "SPEC" &&
      i.classSlug === (record.classSlug ?? null) &&
      record.specSlugs?.some((s) => s === i.specSlug),
  );
  const raceInventory = snapshot.inventories.find(
    (i) => i.kind === "RACE" && record.raceSlugs?.some((r) => r === i.raceSlug),
  );
  const identityInventory = snapshot.inventories.find((i) => i.kind === "SPELL_IDENTITY");
  let state: SourceObservation["state"] = "PRESENT";
  if (snapshot.identity.source === "BLIZZARD" && !specInventory?.claimsCompleteToolkit) {
    state = identityInventory || snapshot.inventories.some((i) => i.kind === "SPELL_IDENTITY")
      ? "IDENTITY_ONLY"
      : specInventory
        ? "PRESENT"
        : "IDENTITY_ONLY";
  }
  if (raceInventory && !specInventory) state = "PRESENT";
  return {
    source: snapshot.identity.source,
    state,
    identity: snapshot.identity,
    notes: record.notes,
  };
}

export function normalizeRecord(
  snapshot: ExternalSourceSnapshot,
  record: ExternalSourceRecord,
): ExternalAbilityCandidate {
  const classSlug = record.classSlug == null ? null : normalizeRetailClassSlug(record.classSlug);
  const specSlugs = [...new Set((record.specSlugs ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean))].sort();
  const raceSlugs = [
    ...new Set(
      (record.raceSlugs ?? [])
        .map((s) => normalizeRaceSlug(s))
        .filter((s): s is string => s != null),
    ),
  ].sort();
  const bindings = dedupeBindings(
    (record.bindings?.length
      ? record.bindings
      : [
          {
            spellId: record.spellId,
            role: "PRIMARY_ACTIVATION" as const,
            source: snapshot.identity.source,
            certainty: "unverified" as const,
            evidence: "primary-record-spell-id",
          },
        ]
    ).map((b) => ({
      ...b,
      source: b.source ?? snapshot.identity.source,
      certainty: b.certainty ?? ("unverified" as RefreshCertainty),
    })),
  );

  const eligibility = assessCatalogEligibility({
    candidateKey: candidateKeyFor(record, classSlug),
    name: record.name,
    primarySpellId: record.spellId,
    classSlug,
    specSlugs,
    raceSlugs,
    cooldownSeconds: record.cooldownSeconds ?? null,
    charges: record.charges ?? null,
    isPassive: record.isPassive ?? null,
    catalogRelevance: relevanceFor(record),
    bindings,
    sourceObservations: [],
    certainty: "unverified",
    notes: [],
  });

  const simcMembership = record.simcMembership;
  const availability = simcMembership
    ? deriveAvailabilityFromSimcMembership(simcMembership, eligibility.ownershipKind)
    : null;

  return {
    candidateKey: candidateKeyFor(record, classSlug),
    name: record.name,
    primarySpellId: record.spellId,
    classSlug,
    specSlugs,
    raceSlugs,
    cooldownSeconds: record.cooldownSeconds ?? null,
    charges: record.charges ?? null,
    stacks: record.stacks ?? null,
    isPassive: record.isPassive ?? null,
    catalogRelevance: relevanceFor(record),
    category: "UNKNOWN",
    bindings,
    sourceObservations: [observationFor(snapshot, record)],
    certainty: "unverified",
    validFromBuild: snapshot.identity.validFromBuild,
    validToBuild: snapshot.identity.validToBuild,
    notes: [...(record.notes ?? [])],
    simcMembership,
    availability,
    ...eligibility,
  };
}

export function mergeCandidates(candidates: ExternalAbilityCandidate[]): ExternalAbilityCandidate[] {
  const bySpell = new Map<number, ExternalAbilityCandidate>();
  for (const c of candidates) {
    const existing = bySpell.get(c.primarySpellId);
    if (!existing) {
      bySpell.set(c.primarySpellId, c);
      continue;
    }
    const observations = [...existing.sourceObservations];
    for (const obs of c.sourceObservations) {
      if (!observations.some((o) => o.source === obs.source && o.state === obs.state)) {
        observations.push(obs);
      }
    }
    const sources = new Set(observations.map((o) => o.source));
    const certainty: RefreshCertainty =
      sources.size > 1 && observations.some((o) => o.state === "ABSENT_FROM_SCOPED_INVENTORY")
        ? "conflicting"
        : existing.certainty;
    const classSlug = existing.classSlug ?? c.classSlug;
    const catalogRelevance: CatalogRelevance =
      existing.catalogRelevance === "ACTIVE_CANDIDATE" || c.catalogRelevance === "ACTIVE_CANDIDATE"
        ? "ACTIVE_CANDIDATE"
        : existing.catalogRelevance === "PASSIVE_DISCOVERED" || c.catalogRelevance === "PASSIVE_DISCOVERED"
          ? "PASSIVE_DISCOVERED"
          : existing.catalogRelevance;
    const simcMembership = mergeSimcMembership(existing.simcMembership, c.simcMembership);
    const mergedBase: ExternalAbilityCandidate = {
      ...existing,
      candidateKey: classSlug ? existing.candidateKey.replace(/^shared\./, `${classSlug}.`) : existing.candidateKey,
      classSlug,
      specSlugs: [...new Set([...existing.specSlugs, ...c.specSlugs])].sort(),
      raceSlugs: [...new Set([...existing.raceSlugs, ...c.raceSlugs])].sort(),
      bindings: dedupeBindings([...existing.bindings, ...c.bindings]),
      sourceObservations: observations,
      certainty,
      catalogRelevance,
      notes: [...new Set([...existing.notes, ...c.notes])],
      cooldownSeconds: existing.cooldownSeconds ?? c.cooldownSeconds,
      charges: existing.charges ?? c.charges,
      stacks: existing.stacks ?? c.stacks,
      isPassive: existing.isPassive ?? c.isPassive,
      simcMembership,
      eligibilityState: existing.eligibilityState,
      eligibilityReasons: existing.eligibilityReasons,
      ownershipKind: existing.ownershipKind,
    };
    const assessed = assessCatalogEligibility(mergedBase);
    bySpell.set(c.primarySpellId, {
      ...mergedBase,
      ...assessed,
      availability: deriveAvailabilityFromSimcMembership(simcMembership, assessed.ownershipKind),
    });
  }
  return [...bySpell.values()].sort((a, b) => a.candidateKey.localeCompare(b.candidateKey));
}

function recordCoversCandidate(record: ExternalSourceRecord, candidate: ExternalAbilityCandidate): boolean {
  if (record.proposedCanonicalKey && record.proposedCanonicalKey === candidate.candidateKey) return true;
  if (record.spellId === candidate.primarySpellId) return true;
  return record.bindings?.some((b) => b.spellId === candidate.primarySpellId) ?? false;
}

function inventoryCoversCandidate(
  inv: ExternalSourceSnapshot["inventories"][number],
  candidate: ExternalAbilityCandidate,
): boolean {
  if (!inv.claimsCompleteToolkit || inv.completeness !== "COMPLETE") return false;
  if (inv.kind === "SPEC") {
    return (
      inv.classSlug === candidate.classSlug &&
      (candidate.specSlugs.length === 0 || (inv.specSlug != null && candidate.specSlugs.includes(inv.specSlug)))
    );
  }
  if (inv.kind === "RACE") {
    return inv.raceSlug != null && candidate.raceSlugs.includes(inv.raceSlug);
  }
  return false;
}

function inventoryQueryCoversCandidate(
  inv: ExternalSourceSnapshot["inventories"][number],
  candidate: ExternalAbilityCandidate,
): boolean {
  if (inv.queryClaim !== "COMPLETE_FOR_QUERY" || inv.completeness !== "COMPLETE") return false;
  if (inv.kind === "CLASS") return inv.classSlug === candidate.classSlug;
  if (inv.kind === "SPEC") {
    return (
      inv.classSlug === candidate.classSlug &&
      (candidate.specSlugs.length === 0 || (inv.specSlug != null && candidate.specSlugs.includes(inv.specSlug)))
    );
  }
  if (inv.kind === "RACE") {
    return inv.raceSlug != null && candidate.raceSlugs.includes(inv.raceSlug);
  }
  return false;
}

/** Query-complete inventories that lack a spell are NOT_OBSERVED, never catalog-toolkit absence. */
export function attachAbsenceObservations(
  candidates: ExternalAbilityCandidate[],
  snapshots: ExternalSourceSnapshot[],
): ExternalAbilityCandidate[] {
  return candidates.map((candidate) => {
    const observations = [...candidate.sourceObservations];
    for (const snap of snapshots) {
      const covers = snap.inventories.some((inv) => inventoryCoversCandidate(inv, candidate));
      if (covers) {
        const present = snap.records.some((r) => recordCoversCandidate(r, candidate));
        if (
          !present &&
          !observations.some(
            (o) => o.source === snap.identity.source && o.identity.sourceRevision === snap.identity.sourceRevision,
          )
        ) {
          observations.push({
            source: snap.identity.source,
            state: "ABSENT_FROM_SCOPED_INVENTORY",
            identity: snap.identity,
            notes: [
              "Absent from a source that claims a closed catalog-relevant toolkit. Review required; still not an automatic delete.",
            ],
          });
        }
      }
      const queryCovers = snap.inventories.some((inv) => inventoryQueryCoversCandidate(inv, candidate));
      if (queryCovers) {
        const present = snap.records.some((r) => recordCoversCandidate(r, candidate));
        if (
          !present &&
          !observations.some(
            (o) =>
              o.source === snap.identity.source &&
              o.state === "NOT_OBSERVED_IN_CURRENT_SOURCE_QUERY" &&
              o.identity.sourceRevision === snap.identity.sourceRevision,
          )
        ) {
          observations.push({
            source: snap.identity.source,
            state: "NOT_OBSERVED_IN_CURRENT_SOURCE_QUERY",
            identity: snap.identity,
            notes: ["Not observed in the current source query. This is not removal evidence."],
          });
        }
      }
    }
    const certainty =
      observations.some((o) => o.state === "ABSENT_FROM_SCOPED_INVENTORY") &&
      observations.some((o) => o.state === "PRESENT" || o.state === "IDENTITY_ONLY")
        ? "conflicting"
        : candidate.certainty;
    return { ...candidate, sourceObservations: observations, certainty };
  });
}

export function normalizeSnapshots(
  snapshots: ExternalSourceSnapshot[],
  options: { includePassiveDiscoveries?: boolean } = {},
): ExternalAbilityCandidate[] {
  const includePassive = options.includePassiveDiscoveries ?? false;
  const normalized = snapshots.flatMap((snap) => snap.records.map((r) => normalizeRecord(snap, r)));
  const merged = attachAbsenceObservations(mergeCandidates(normalized), snapshots);
  if (includePassive) return merged;
  return merged.filter((c) => c.catalogRelevance !== "PASSIVE_DISCOVERED");
}
