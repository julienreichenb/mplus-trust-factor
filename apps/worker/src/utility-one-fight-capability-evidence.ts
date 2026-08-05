/**
 * Select capability-scoped evidence pages for Utility one-fight extraction.
 *
 * Prefer ability-filtered party-wide scopes (capability acquisition) over the
 * legacy unfiltered full-Buffs / full-Casts streams that stop at MAX_PAGES.
 * Merge ability-filter batches; never prefer verified-empty ability+actor
 * combined filters.
 */
export type UtilityEvidencePageRow = {
  artifactId: string;
  pageIndex: number;
  eventCount: number;
  scopeFingerprint: string;
};

export type UtilityDatasetScopeKind =
  | "CAPABILITY_ABILITY_FILTER_BATCHES"
  | "CAPABILITY_UNFILTERED_PARTY"
  | "LEGACY_UNFILTERED_PARTY"
  | "SINGLE_ACTOR"
  | "EMPTY_OR_MISSING";

export interface UtilityDatasetScopeSelection {
  kind: UtilityDatasetScopeKind;
  pages: UtilityEvidencePageRow[];
  scopeFingerprints: string[];
  limitations: string[];
}

function isPartyWide(scope: string): boolean {
  return scope.includes("|a:all|");
}

function filterExpression(scope: string): string {
  const match = /\|fe:([^|]*)\|/.exec(scope);
  return match?.[1] ?? "none";
}

function isAbilityFiltered(scope: string): boolean {
  const fe = filterExpression(scope);
  return fe.includes("ability.id");
}

/** Verified-empty: ability.id combined with source.id/target.id in one Buffs/Casts filter. */
function isBrokenAbilityActorCombo(scope: string): boolean {
  const fe = filterExpression(scope);
  return (
    fe.includes("ability.id") &&
    (fe.includes("source.id") || fe.includes("target.id"))
  );
}

function isCapabilityNoneTag(scope: string): boolean {
  const fe = filterExpression(scope);
  return fe === "cap:NONE" || fe.startsWith("cap:NONE|") || fe.startsWith("cap:NONE;");
}

function isUnfiltered(scope: string): boolean {
  const fe = filterExpression(scope);
  if (fe === "none" || fe === "") return true;
  // Deaths/DamageTaken resource streams without ability filters.
  if (fe === "+resources" || fe.startsWith("+resources;")) return true;
  return false;
}

function groupByScope(
  pages: readonly UtilityEvidencePageRow[],
): Map<string, UtilityEvidencePageRow[]> {
  const byScope = new Map<string, UtilityEvidencePageRow[]>();
  for (const page of pages) {
    const list = byScope.get(page.scopeFingerprint) ?? [];
    list.push(page);
    byScope.set(page.scopeFingerprint, list);
  }
  return byScope;
}

function flattenSorted(pages: UtilityEvidencePageRow[]): UtilityEvidencePageRow[] {
  return [...pages].sort(
    (a, b) =>
      a.scopeFingerprint.localeCompare(b.scopeFingerprint) ||
      a.pageIndex - b.pageIndex,
  );
}

/**
 * Choose pages for one Utility dataset from all persisted scopes for that fight.
 */
export function selectUtilityCapabilityEvidencePages(input: {
  datasetKey: string;
  pages: readonly UtilityEvidencePageRow[];
}): UtilityDatasetScopeSelection {
  const { datasetKey, pages } = input;
  if (pages.length === 0) {
    return {
      kind: "EMPTY_OR_MISSING",
      pages: [],
      scopeFingerprints: [],
      limitations: [`DATASET_MISSING:${datasetKey}`],
    };
  }

  const byScope = groupByScope(pages);
  const partyScopes = [...byScope.entries()].filter(([scope]) => isPartyWide(scope));

  const abilityBatches = partyScopes.filter(
    ([scope]) => isAbilityFiltered(scope) && !isBrokenAbilityActorCombo(scope),
  );
  const brokenCombos = partyScopes.filter(([scope]) => isBrokenAbilityActorCombo(scope));
  const capabilityNone = partyScopes.filter(([scope]) => isCapabilityNoneTag(scope));
  const legacyUnfiltered = partyScopes.filter(([scope]) => isUnfiltered(scope));

  const catalogFilteredDatasets = new Set(["Casts", "Buffs", "Debuffs"]);

  if (catalogFilteredDatasets.has(datasetKey) && abilityBatches.length > 0) {
    const selected = flattenSorted(abilityBatches.flatMap(([, list]) => list));
    const limitations: string[] = [];
    if (brokenCombos.length > 0) {
      limitations.push(
        `IGNORED_EMPTY_ABILITY_ACTOR_COMBO_SCOPES:${brokenCombos.length}`,
      );
    }
    if (legacyUnfiltered.length > 0) {
      limitations.push(
        `IGNORED_LEGACY_UNFILTERED_SCOPE:${datasetKey}:prefer_capability_ability_filters`,
      );
    }
    return {
      kind: "CAPABILITY_ABILITY_FILTER_BATCHES",
      pages: selected,
      scopeFingerprints: abilityBatches.map(([scope]) => scope).sort(),
      limitations,
    };
  }

  // Interrupts / Dispels / CombatantInfo / Deaths: party-wide capability NONE tag first.
  if (capabilityNone.length > 0) {
    const best = capabilityNone.sort((a, b) => {
      const aEvents = a[1].reduce((s, p) => s + p.eventCount, 0);
      const bEvents = b[1].reduce((s, p) => s + p.eventCount, 0);
      return bEvents - aEvents || b[1].length - a[1].length;
    })[0]!;
    return {
      kind: "CAPABILITY_UNFILTERED_PARTY",
      pages: flattenSorted(best[1]),
      scopeFingerprints: [best[0]],
      limitations: [],
    };
  }

  if (legacyUnfiltered.length > 0) {
    const best = legacyUnfiltered.sort((a, b) => {
      const aEvents = a[1].reduce((s, p) => s + p.eventCount, 0);
      const bEvents = b[1].reduce((s, p) => s + p.eventCount, 0);
      return bEvents - aEvents || b[1].length - a[1].length;
    })[0]!;
    const limitations =
      catalogFilteredDatasets.has(datasetKey)
        ? [
            `FALLBACK_LEGACY_UNFILTERED:${datasetKey}:no_capability_ability_filter_scopes`,
          ]
        : [];
    return {
      kind: "LEGACY_UNFILTERED_PARTY",
      pages: flattenSorted(best[1]),
      scopeFingerprints: [best[0]],
      limitations,
    };
  }

  // Last resort: any single-actor scope with most events.
  const any = [...byScope.entries()].sort((a, b) => {
    const aEvents = a[1].reduce((s, p) => s + p.eventCount, 0);
    const bEvents = b[1].reduce((s, p) => s + p.eventCount, 0);
    return bEvents - aEvents || b[1].length - a[1].length;
  })[0]!;
  return {
    kind: "SINGLE_ACTOR",
    pages: flattenSorted(any[1]),
    scopeFingerprints: [any[0]],
    limitations: [`FALLBACK_SINGLE_ACTOR_SCOPE:${datasetKey}`],
  };
}
