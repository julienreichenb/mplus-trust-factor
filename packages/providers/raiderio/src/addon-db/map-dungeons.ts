import { AddonDbFormatError, type RioAddonDungeon, type SeasonDungeonIdentity } from "./types.js";

export interface DungeonMapping {
  rio: RioAddonDungeon;
  expected: SeasonDungeonIdentity;
}

export function mapRioDungeonsToSeasonPool(
  rioDungeons: readonly RioAddonDungeon[],
  expected: readonly SeasonDungeonIdentity[],
): DungeonMapping[] {
  if (expected.length !== 8) {
    throw new AddonDbFormatError(
      "SEASON_DUNGEON_COUNT",
      `Scoring season must have exactly 8 dungeons, found ${expected.length}`,
    );
  }
  if (rioDungeons.length !== 8) {
    throw new AddonDbFormatError(
      "DUNGEON_COUNT",
      `Addon current-season list must have exactly 8 dungeons, found ${rioDungeons.length}`,
    );
  }

  const usedExpected = new Set<string>();
  const mappings: DungeonMapping[] = [];
  for (const rio of rioDungeons) {
    const match = expected.find((dungeon) => !usedExpected.has(dungeon.slug) && dungeonMatches(rio, dungeon));
    if (!match) {
      throw new AddonDbFormatError(
        "DUNGEON_MAP",
        `No unique platform dungeon for Raider.IO ${rio.name} (map ${rio.instanceMapId})`,
      );
    }
    usedExpected.add(match.slug);
    mappings.push({ rio, expected: match });
  }
  if (usedExpected.size !== 8) {
    throw new AddonDbFormatError("DUNGEON_MAP", "Season dungeon mapping was not bijective");
  }
  return mappings;
}

function dungeonMatches(rio: RioAddonDungeon, expected: SeasonDungeonIdentity): boolean {
  if (expected.mapId != null && expected.mapId === rio.instanceMapId) return true;
  if (expected.raiderioSlug && normalize(expected.raiderioSlug) === normalize(rio.shortName)) return true;
  if (normalize(expected.name) === normalize(rio.name)) return true;
  if (normalize(expected.slug) === normalize(rio.shortName) || normalize(expected.slug) === normalize(rio.name)) {
    return true;
  }
  return false;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function assertRequestedAddonRegion(headerRegion: string, requestedRegion: string): void {
  if (headerRegion.toUpperCase() !== requestedRegion.toUpperCase()) {
    throw new AddonDbFormatError(
      "REGION",
      `Expected ${requestedRegion.toUpperCase()} Mythic+ module, got ${headerRegion}`,
    );
  }
}

/** @deprecated Use assertRequestedAddonRegion */
export function assertEuRegion(region: string): void {
  assertRequestedAddonRegion(region, "EU");
}
