import { RETAIL_CLASS_MATRIX } from "../catalog/classes-matrix.js";
import { specIdentityKey } from "./topology.js";
import type {
  CatalogDiffEntry,
  CatalogRefreshCoverageReport,
  ExternalAbilityCandidate,
  ExternalSourceSnapshot,
  InventoryScopeRow,
  RetailTopologyDiff,
  SnapshotDatasetKind,
} from "./types.js";
import { compareRetailTopology } from "./topology.js";

export function buildShadowCoverageReport(input: {
  snapshots: ExternalSourceSnapshot[];
  candidates: ExternalAbilityCandidate[];
  currentRuleCount: number;
  diff: CatalogDiffEntry[];
  topologyOverride?: RetailTopologyDiff;
}): CatalogRefreshCoverageReport {
  const classes = new Set<string>();
  const specs = new Set<string>();
  const races = new Set<string>();
  const byClass: Record<string, number> = {};
  const bySpec: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  for (const snap of input.snapshots) {
    for (const inv of snap.inventories) {
      if (inv.classSlug) classes.add(inv.classSlug);
      if (inv.classSlug && inv.specSlug) specs.add(specIdentityKey(inv.classSlug, inv.specSlug));
      if (inv.raceSlug) races.add(inv.raceSlug);
    }
  }
  for (const c of input.candidates) {
    if (c.classSlug) {
      classes.add(c.classSlug);
      byClass[c.classSlug] = (byClass[c.classSlug] ?? 0) + 1;
    }
    for (const spec of c.specSlugs) {
      const key = specIdentityKey(c.classSlug ?? "shared", spec);
      specs.add(key);
      bySpec[key] = (bySpec[key] ?? 0) + 1;
    }
    for (const race of c.raceSlugs) races.add(race);
    const cat = c.category ?? "UNKNOWN";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  const inventoryScopes: InventoryScopeRow[] = input.snapshots.flatMap((snap) =>
    snap.inventories.map((inv) => ({
      source: snap.identity.source,
      datasetKind: snap.identity.datasetKind,
      kind: inv.kind,
      classSlug: inv.classSlug,
      specSlug: inv.specSlug,
      raceSlug: inv.raceSlug,
      completeness: inv.completeness,
      claimsCompleteToolkit: inv.claimsCompleteToolkit,
      queryClaim: inv.queryClaim,
      scopeClassification: inv.scopeClassification,
    })),
  );
  const kinds = [...new Set(input.snapshots.map((s) => s.identity.datasetKind))];
  const datasetKind: SnapshotDatasetKind | "MIXED" =
    kinds.length === 1 ? kinds[0]! : kinds.length === 0 ? "PINNED" : "MIXED";
  const claimedCompleteInventories = inventoryScopes.filter(
    (s) => s.claimsCompleteToolkit && s.completeness === "COMPLETE",
  ).length;
  const partialOrUnknownInventories = inventoryScopes.filter(
    (s) => !s.claimsCompleteToolkit || s.completeness !== "COMPLETE",
  ).length;

  const count = (status: CatalogDiffEntry["status"]) =>
    input.diff.filter((d) => d.status === status).length;

  return {
    datasetKind,
    classesDiscovered: [...classes].sort(),
    specsDiscovered: [...specs].sort(),
    racesDiscovered: [...races].sort(),
    candidateAbilities: input.candidates.length,
    candidateActiveAbilities: input.candidates.filter((c) => c.catalogRelevance === "ACTIVE_CANDIDATE")
      .length,
    candidatePassiveAbilities: input.candidates.filter((c) => c.catalogRelevance === "PASSIVE_DISCOVERED")
      .length,
    candidateUnknownAbilities: input.candidates.filter((c) => c.catalogRelevance === "UNCLASSIFIED").length,
    racialCandidates: input.candidates.filter((c) => c.raceSlugs.length > 0 && c.classSlug == null)
      .length,
    candidatesByClass: Object.fromEntries(Object.entries(byClass).sort()),
    candidatesBySpec: Object.fromEntries(Object.entries(bySpec).sort()),
    candidatesByCategory: Object.fromEntries(Object.entries(byCategory).sort()),
    currentCatalogEntries: input.currentRuleCount,
    missingFromCurrentCatalog: count("MISSING_FROM_CURRENT_CATALOG"),
    missingFromExternalSources: count("MISSING_FROM_EXTERNAL_SOURCES"),
    changedBindings: count("SPELL_BINDING_CHANGED"),
    ambiguities: count("AMBIGUOUS"),
    sourceConflicts: count("SOURCE_CONFLICT"),
    claimedCompleteInventories,
    partialOrUnknownInventories,
    inventoryScopes,
    topology: input.topologyOverride ?? compareRetailTopology(input.snapshots.flatMap((s) => s.inventories)),
  };
}

export function formatShadowCoverageReport(report: CatalogRefreshCoverageReport): string {
  const lines = [
    "Ability catalog shadow refresh (no publication)",
    `datasetKind: ${report.datasetKind}`,
    `Inventories claiming complete catalog toolkit: ${report.claimedCompleteInventories} (must stay 0 for SimC SpellQuery)`,
    `Partial/unknown/identity inventories: ${report.partialOrUnknownInventories}`,
    `Retail matrix: ${RETAIL_CLASS_MATRIX.length} classes / ${report.topology.matrixSpecCount} specs`,
    `Discovered classes: ${report.classesDiscovered.length} specs: ${report.specsDiscovered.length} races: ${report.racesDiscovered.length}`,
    `RAW DISCOVERY: ${report.candidateAbilities} (active ${report.candidateActiveAbilities}, passive ${report.candidatePassiveAbilities}, racial ${report.racialCandidates})`,
    `Current catalog entries: ${report.currentCatalogEntries}`,
    `STRONG MISSING_FROM_CURRENT_CATALOG: ${report.missingFromCurrentCatalog}`,
    `MISSING_FROM_EXTERNAL_SOURCES: ${report.missingFromExternalSources} (legacy; query absence is NOT_OBSERVED, not this status)`,
    `SPELL_BINDING_CHANGED: ${report.changedBindings}`,
    `AMBIGUOUS: ${report.ambiguities}`,
    `SOURCE_CONFLICT: ${report.sourceConflicts}`,
  ];
  if (report.topology.addedSpecs.length) {
    lines.push(`Topology added specs: ${report.topology.addedSpecs.join(", ")}`);
  }
  if (report.topology.removedSpecs.length) {
    lines.push(`Topology missing vs matrix: ${report.topology.removedSpecs.join(", ")}`);
  }
  return lines.join("\n");
}
