import { RETAIL_CLASS_MATRIX } from "../catalog/classes-matrix.js";
import { normalizeRetailClassSlug } from "../catalog/classes-matrix.js";
import { normalizeRaceSlug, raceSlugFromBlizzardRaceId } from "../race.js";
import type { RetailTopologyDiff, ScopedInventory } from "./types.js";

const NON_RETAIL_MARKERS = [
  "classic",
  "classic-era",
  "era",
  "hardcore",
  "season-of-discovery",
  "sod",
  "burning-crusade",
  "tbc",
  "wrath",
  "wotlk",
  "cataclysm-classic",
  "mists-classic",
  "mop-classic",
  "vanilla",
];

const KNOWN_RACE_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36, 37, 52, 70,
  84, 85,
];

export function knownRetailRaceSlugs(): string[] {
  return [
    ...new Set(
      KNOWN_RACE_IDS.map((id) => raceSlugFromBlizzardRaceId(id)).filter((s): s is string => s != null),
    ),
  ].sort();
}

export function isKnownRetailRaceSlug(slug: string): boolean {
  const normalized = normalizeRaceSlug(slug);
  return normalized != null && knownRetailRaceSlugs().includes(normalized);
}

export function isKnownRetailClassSlug(slug: string): boolean {
  const normalized = normalizeRetailClassSlug(slug);
  return normalized != null && RETAIL_CLASS_MATRIX.some((c) => c.slug === normalized);
}

export function isKnownRetailSpec(classSlug: string, specSlug: string): boolean {
  const cls = normalizeRetailClassSlug(classSlug);
  if (!cls) return false;
  const def = RETAIL_CLASS_MATRIX.find((c) => c.slug === cls);
  return def?.specs.some((s) => s.slug === specSlug) ?? false;
}

export function detectNonRetailNamespace(value: string | undefined): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  for (const marker of NON_RETAIL_MARKERS) {
    if (lower.includes(marker)) return marker;
  }
  return null;
}

export function isRetailStaticNamespace(namespace: string): boolean {
  if (detectNonRetailNamespace(namespace)) return false;
  return /^static-(us|eu|kr|tw)$/i.test(namespace.trim());
}

export function specIdentityKey(classSlug: string, specSlug: string): string {
  return `${classSlug}/${specSlug}`;
}

export function compareRetailTopology(inventories: ScopedInventory[]): RetailTopologyDiff {
  const matrixClasses = RETAIL_CLASS_MATRIX.map((c) => c.slug).sort();
  const matrixSpecs = RETAIL_CLASS_MATRIX.flatMap((c) =>
    c.specs.map((s) => specIdentityKey(c.slug, s.slug)),
  ).sort();

  const snapshotClasses = [
    ...new Set(
      inventories
        .map((i) => i.classSlug)
        .filter((s): s is string => typeof s === "string" && s.length > 0),
    ),
  ].sort();
  const snapshotSpecs = [
    ...new Set(
      inventories
        .filter(
          (i) =>
            i.classSlug &&
            i.specSlug &&
            (i.scopeClassification == null || i.scopeClassification === "PLAYABLE_SPEC"),
        )
        .map((i) => specIdentityKey(i.classSlug!, i.specSlug!)),
    ),
  ].sort();

  return {
    matrixClassCount: matrixClasses.length,
    matrixSpecCount: matrixSpecs.length,
    snapshotClassCount: snapshotClasses.length,
    snapshotSpecCount: snapshotSpecs.length,
    addedClasses: snapshotClasses.filter((c) => !matrixClasses.includes(c)),
    removedClasses: matrixClasses.filter((c) => !snapshotClasses.includes(c)),
    addedSpecs: snapshotSpecs.filter((s) => !matrixSpecs.includes(s)),
    removedSpecs: matrixSpecs.filter((s) => !snapshotSpecs.includes(s)),
    nonRetailRejected: [],
  };
}
