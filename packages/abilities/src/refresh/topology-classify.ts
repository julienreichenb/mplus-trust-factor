import { RETAIL_CLASS_MATRIX } from "../catalog/classes-matrix.js";
import { knownRetailRaceSlugs, specIdentityKey } from "./topology.js";
import type { RetailTopologyDiff } from "./types.js";

export type TopologyIdentityKind = "MATCHED" | "EXTERNAL_ONLY" | "CURRENT_MATRIX_ONLY";

export interface TopologyIdentityRow {
  key: string;
  kind: TopologyIdentityKind;
}

export interface TopologyClassification {
  classes: TopologyIdentityRow[];
  specs: TopologyIdentityRow[];
  races: TopologyIdentityRow[];
}

export function classifyTopology(diff: RetailTopologyDiff, discoveredRaces: string[]): TopologyClassification {
  const matrixClasses = RETAIL_CLASS_MATRIX.map((c) => c.slug);
  const matrixSpecs = RETAIL_CLASS_MATRIX.flatMap((c) =>
    c.specs.map((s) => specIdentityKey(c.slug, s.slug)),
  );
  const snapshotClasses = [
    ...new Set([
      ...matrixClasses.filter((c) => !diff.removedClasses.includes(c)),
      ...diff.addedClasses,
    ]),
  ];
  const snapshotSpecs = [
    ...new Set([
      ...matrixSpecs.filter((s) => !diff.removedSpecs.includes(s)),
      ...diff.addedSpecs,
    ]),
  ];

  const classRows: TopologyIdentityRow[] = [
    ...snapshotClasses
      .filter((c) => matrixClasses.includes(c))
      .map((key) => ({ key, kind: "MATCHED" as const })),
    ...diff.addedClasses.map((key) => ({ key, kind: "EXTERNAL_ONLY" as const })),
    ...diff.removedClasses.map((key) => ({ key, kind: "CURRENT_MATRIX_ONLY" as const })),
  ].sort((a, b) => a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind));

  const specRows: TopologyIdentityRow[] = [
    ...snapshotSpecs
      .filter((s) => matrixSpecs.includes(s))
      .map((key) => ({ key, kind: "MATCHED" as const })),
    ...diff.addedSpecs.map((key) => ({ key, kind: "EXTERNAL_ONLY" as const })),
    ...diff.removedSpecs.map((key) => ({ key, kind: "CURRENT_MATRIX_ONLY" as const })),
  ].sort((a, b) => a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind));

  const matrixRaces = knownRetailRaceSlugs();
  const races = [...new Set(discoveredRaces)].sort();
  const raceRows: TopologyIdentityRow[] = [
    ...races.filter((r) => matrixRaces.includes(r)).map((key) => ({ key, kind: "MATCHED" as const })),
    ...races.filter((r) => !matrixRaces.includes(r)).map((key) => ({ key, kind: "EXTERNAL_ONLY" as const })),
    ...matrixRaces
      .filter((r) => !races.includes(r))
      .map((key) => ({ key, kind: "CURRENT_MATRIX_ONLY" as const })),
  ].sort((a, b) => a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind));

  return { classes: classRows, specs: specRows, races: raceRows };
}
