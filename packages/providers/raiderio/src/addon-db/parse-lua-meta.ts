import { AddonDbFormatError, type AddonProviderHeader, type RioAddonDungeon } from "./types.js";

export function parseDbDungeonsLua(source: string, currentSeasonId: number): RioAddonDungeon[] {
  const fromTables = parseNsDungeonTables(source).filter((season) => season.length === 8);
  if (fromTables.length > 0) {
    const idx = currentSeasonId;
    if (idx < 0 || idx >= fromTables.length) {
      throw new AddonDbFormatError(
        "SEASON_INDEX",
        `currentSeasonId ${currentSeasonId} is outside ns.dungeons count ${fromTables.length}`,
      );
    }
    const dungeons = fromTables[idx] ?? [];
    if (dungeons.length !== 8) {
      throw new AddonDbFormatError("DUNGEON_COUNT", `Expected 8 current-season dungeons, found ${dungeons.length}`);
    }
    return dungeons;
  }
  const flat = parseDungeonFieldsFlat(source);
  const start = currentSeasonId * 8;
  const sliced = flat.slice(start, start + 8);
  if (sliced.length !== 8) {
    throw new AddonDbFormatError("DUNGEON_COUNT", `Expected 8 current-season dungeons, found ${sliced.length}`);
  }
  return sliced;
}

function parseNsDungeonTables(source: string): RioAddonDungeon[][] {
  const seasons = [...source.matchAll(/ns\.dungeons\s*=\s*\{([\s\S]*?)\n\s*\}/g)];
  return seasons.map((season) => parseDungeonFieldsFlat(season[1] ?? ""));
}

function parseDungeonFieldsFlat(source: string): RioAddonDungeon[] {
  const names = [...source.matchAll(/(?:\["name"\]|name)\s*=\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
  const shortNames = [...source.matchAll(/(?:\["shortName"\]|shortName)\s*=\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
  const mapIds = [...source.matchAll(/(?:\["instance_map_id"\]|instance_map_id)\s*=\s*(\d+)/g)].map((m) => Number(m[1]));
  const ids = [...source.matchAll(/(?:\["id"\]|(?<![A-Za-z_])id)\s*=\s*(\d+)/g)].map((m) => Number(m[1]));
  const keystones = [...source.matchAll(/(?:\["keystone_instance"\]|keystone_instance)\s*=\s*(-?\d+)/g)].map((m) =>
    Number(m[1]),
  );
  const count = Math.min(names.length, mapIds.length);
  const dungeons: RioAddonDungeon[] = [];
  for (let i = 0; i < count; i++) {
    dungeons.push({
      index: i,
      id: ids[i] ?? i,
      keystoneInstance: keystones[i] ?? 0,
      instanceMapId: mapIds[i]!,
      name: names[i]!,
      shortName: shortNames[i] ?? names[i]!,
    });
  }
  return dungeons;
}

function match1(source: string, re: RegExp): string {
  const m = re.exec(source);
  if (!m?.[1]) {
    throw new AddonDbFormatError("HEADER", `Missing header field ${re}`);
  }
  return m[1];
}

function matchOpt(source: string, re: RegExp): string | null {
  return re.exec(source)?.[1] ?? null;
}

export function parseProviderHeader(luaPrefix: string): AddonProviderHeader {
  const region = match1(luaPrefix, /(?:ns\.)?region\s*=\s*"([A-Za-z]+)"/).toUpperCase();
  const date = match1(luaPrefix, /(?:ns\.)?date\s*=\s*"([^"]+)"/);
  const currentSeasonId = Number(match1(luaPrefix, /(?:ns\.)?currentSeasonId\s*=\s*(-?\d+)/));
  const numCharacters = Number(match1(luaPrefix, /(?:ns\.)?numCharacters\s*=\s*(\d+)/));
  const recordSizeRaw = matchOpt(luaPrefix, /(?:ns\.)?recordSizeInBytes\s*=\s*(\d+)/);
  const recordSizeInBytes = recordSizeRaw ? Number(recordSizeRaw) : 30;
  const encodingRaw =
    matchOpt(luaPrefix, /(?:ns\.)?encodingOrder\s*=\s*\{([^}]+)\}/) ?? "1, 2, 5, 6, 9, 10, 11, 12, 14, 15";
  const encodingOrder = encodingRaw.split(",").map((p) => Number(p.trim())).filter((n) => Number.isFinite(n));
  const milestoneRaw =
    matchOpt(luaPrefix, /(?:ns\.)?keystoneMilestoneLevels\s*=\s*\{([^}]+)\}/) ?? "15, 12, 10, 7, 4, 2";
  const keystoneMilestoneLevels = milestoneRaw
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n));
  return {
    region,
    date,
    currentSeasonId,
    numCharacters,
    recordSizeInBytes,
    encodingOrder,
    keystoneMilestoneLevels,
  };
}

