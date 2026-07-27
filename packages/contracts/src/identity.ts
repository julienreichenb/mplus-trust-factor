/** ISO-8601 timestamp string at API/DTO boundaries. */
export type IsoDateTime = string;

export type RegionCode = "EU" | "US" | "KR" | "TW" | string;

export interface CharacterIdentityInput {
  region: RegionCode;
  realmSlug: string;
  name: string;
}

export interface CharacterRef {
  region: RegionCode;
  realmSlug: string;
  normalizedName: string;
}

export interface CanonicalCharacter {
  id: string;
  region: RegionCode;
  realmSlug: string;
  normalizedName: string;
  displayName: string;
  classSlug: string | null;
  specSlug: string | null;
  role: "DPS" | "TANK" | "HEALER" | null;
  /** Character level when Blizzard profile provides it. */
  level?: number | null;
  /** Faction label when Blizzard profile provides it (e.g. Alliance / Horde). */
  faction?: string | null;
  blizzardCharacterId: string | null;
  wclCanonicalId: string | null;
  raiderioProfileUrl: string | null;
  lastSeenAt: IsoDateTime | null;
  lastPublicRefreshAt: IsoDateTime | null;
}

export interface CharacterSnapshotDTO {
  id: string;
  characterId: string;
  capturedAt: IsoDateTime;
  itemLevelEquipped: number | null;
  activeSpecSlug: string | null;
  role: "DPS" | "TANK" | "HEALER" | null;
  mythicRating: number | null;
  sourcePayloadId: string | null;
}

export interface EquipmentSnapshotDTO {
  id: string;
  characterSnapshotId: string;
  capturedAt: IsoDateTime;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  items: unknown;
  keyItems: unknown;
  sourcePayloadId: string | null;
}

export interface TalentSnapshotDTO {
  id: string;
  characterSnapshotId: string;
  specializationSlug: string | null;
  loadoutCode: string | null;
  talents: unknown;
  sourcePayloadId: string | null;
}
