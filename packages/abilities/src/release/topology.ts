import { RETAIL_CLASS_MATRIX } from "../catalog/classes-matrix.js";
import { raceSlugFromBlizzardRaceId } from "../race.js";
import type { ReleaseRaceTopology, ReleaseTopology } from "./types.js";
import { normalizeTopologyForContent } from "./normalize.js";

/**
 * Blizzard playable-race IDs currently recognized by production race helpers.
 * Must stay aligned with packages/abilities/src/refresh/topology.ts KNOWN_RACE_IDS
 * (Bootstrap = current runtime, not external latest). No Haranir.
 */
const BOOTSTRAP_RACE_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36, 37, 52, 70,
  84, 85,
] as const;

function buildRaceTopology(): ReleaseRaceTopology[] {
  const bySlug = new Map<string, number[]>();
  for (const id of BOOTSTRAP_RACE_IDS) {
    const slug = raceSlugFromBlizzardRaceId(id);
    if (!slug) continue;
    const list = bySlug.get(slug) ?? [];
    list.push(id);
    bySlug.set(slug, list);
  }
  return [...bySlug.entries()].map(([slug, blizzardRaceIds]) => ({
    slug,
    blizzardRaceIds: [...blizzardRaceIds].sort((a, b) => a - b),
  }));
}

/** Canonical static topology used by Bootstrap Release 0 (current runtime). */
export function currentStaticReleaseTopology(): ReleaseTopology {
  return normalizeTopologyForContent({
    classes: RETAIL_CLASS_MATRIX.map((cls) => ({
      slug: cls.slug,
      name: cls.name,
      supportState: cls.supportState,
      blizzardClassId: cls.blizzardClassId,
      ...(cls.notes !== undefined ? { notes: cls.notes } : {}),
      specs: cls.specs.map((spec) => ({
        slug: spec.slug,
        name: spec.name,
        role: spec.role,
        supportState: spec.supportState,
        blizzardSpecId: spec.blizzardSpecId,
        ...(spec.notes !== undefined ? { notes: spec.notes } : {}),
      })),
    })),
    races: buildRaceTopology(),
  });
}

export function topologyCounts(topology: ReleaseTopology): {
  classCount: number;
  specCount: number;
  raceCount: number;
} {
  return {
    classCount: topology.classes.length,
    specCount: topology.classes.reduce((n, c) => n + c.specs.length, 0),
    raceCount: topology.races.length,
  };
}
