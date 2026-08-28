import type { CatalogRefreshSourceKind } from "./types.js";

export interface CrossSourceRaceIdentity {
  source: CatalogRefreshSourceKind;
  sourceLocalId: number;
  normalizedSlug: string;
  name: string;
}

/** SimC race numeric IDs are not Blizzard race IDs. Never join on the number. */
export function raceIdentitiesJoinable(
  a: CrossSourceRaceIdentity,
  b: CrossSourceRaceIdentity,
): boolean {
  if (a.source === b.source) {
    return a.sourceLocalId === b.sourceLocalId || a.normalizedSlug === b.normalizedSlug;
  }
  return a.normalizedSlug === b.normalizedSlug;
}

export function detectNumericRaceIdCollision(identities: CrossSourceRaceIdentity[]): string[] {
  const bySourceId = new Map<string, CrossSourceRaceIdentity[]>();
  for (const id of identities) {
    const key = `${id.source}:${id.sourceLocalId}`;
    const list = bySourceId.get(key) ?? [];
    list.push(id);
    bySourceId.set(key, list);
  }
  const collisions: string[] = [];
  for (const [key, list] of bySourceId) {
    const slugs = new Set(list.map((i) => i.normalizedSlug));
    if (slugs.size > 1) {
      collisions.push(`${key} maps to ${[...slugs].sort().join(",")}`);
    }
  }
  return collisions.sort();
}

export function forbidCrossSourceNumericRaceJoin(
  simcRaceId: number,
  blizzardRaceId: number,
): "FORBIDDEN_NUMERIC_CROSS_SOURCE_JOIN" {
  void simcRaceId;
  void blizzardRaceId;
  return "FORBIDDEN_NUMERIC_CROSS_SOURCE_JOIN";
}
