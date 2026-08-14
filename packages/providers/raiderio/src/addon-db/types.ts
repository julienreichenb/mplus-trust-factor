export const MYTHICPLUS_RECORD_SIZE_BYTES = 30;
export const MYTHICPLUS_DUNGEON_SLOTS = 8;
export const MYTHICPLUS_ENCODING_ORDER = [1, 2, 5, 6, 9, 10, 11, 12, 14, 15] as const;
export const MYTHICPLUS_MILESTONES = [15, 12, 10, 7, 4, 2] as const;
export const MAX_KEY_LEVEL = 63;

export class AddonDbFormatError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AddonDbFormatError";
    this.code = code;
  }
}

export interface RioAddonDungeon {
  index: number;
  id: number;
  keystoneInstance: number;
  instanceMapId: number;
  name: string;
  shortName: string;
}

export interface PackedMythicPlusRecord {
  currentScore: number;
  dungeonLevels: number[];
  dungeonChests: number[];
  warbandDungeonLevels: number[];
}

export interface AddonProviderHeader {
  region: string;
  date: string;
  currentSeasonId: number;
  numCharacters: number;
  recordSizeInBytes: number;
  encodingOrder: number[];
  keystoneMilestoneLevels: number[];
}

export interface SeasonDungeonIdentity {
  slug: string;
  name: string;
  mapId: number | null;
  raiderioSlug: string | null;
}
