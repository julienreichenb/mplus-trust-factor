import { writeBits } from "./packed-bits.js";
import { encodeLuaByteString } from "./lua-strings.js";
import {
  CURRENT_MYTHICPLUS_LAYOUT,
  ENCODER_MYTHICPLUS_FIELDS,
  LEGACY_MYTHICPLUS_LAYOUT,
  mythicPlusFieldBitWidth,
  packedMythicPlusRecordSizeBytes,
  PACKED_DUNGEON_CHEST_FIELD_BITS,
  PACKED_DUNGEON_KEY_FIELD_BITS,
  type MythicPlusPackedLayout,
} from "./packed-layout.js";
import { MYTHICPLUS_MILESTONES } from "./types.js";

export function encodeMythicPlusRecord(
  input: {
    currentScore?: number;
    dungeonLevels: number[];
    dungeonChests?: number[];
    warbandDungeonLevels?: number[];
  },
  layout: MythicPlusPackedLayout = LEGACY_MYTHICPLUS_LAYOUT,
): Uint8Array {
  const recordSize = packedMythicPlusRecordSizeBytes(layout);
  const buf = new Uint8Array(recordSize);
  let bit = 0;
  for (const field of layout.encodingOrder) {
    if (field === ENCODER_MYTHICPLUS_FIELDS.CURRENT_SCORE) {
      bit = writeBits(buf, bit, 13, input.currentScore ?? 0);
      continue;
    }
    if (field === ENCODER_MYTHICPLUS_FIELDS.DUNGEON_LEVELS) {
      bit = writeDungeonSlots(buf, bit, layout.dungeonCount, input.dungeonLevels, input.dungeonChests);
      continue;
    }
    if (field === ENCODER_MYTHICPLUS_FIELDS.WARBAND_DUNGEON_LEVELS) {
      bit = writeDungeonSlots(buf, bit, layout.dungeonCount, input.warbandDungeonLevels ?? [], undefined);
      continue;
    }
    bit = writeBits(buf, bit, mythicPlusFieldBitWidth(field, layout), 0);
  }
  return buf;
}

export function encodeCurrentMythicPlusRecord(input: {
  currentScore?: number;
  dungeonLevels: number[];
  dungeonChests?: number[];
  warbandDungeonLevels?: number[];
}): Uint8Array {
  return encodeMythicPlusRecord(input, CURRENT_MYTHICPLUS_LAYOUT);
}

export function buildLookupLua(
  records: Uint8Array[],
  layout: MythicPlusPackedLayout = LEGACY_MYTHICPLUS_LAYOUT,
  extra: { region?: string; includeProviderHeader?: boolean } = {},
): string {
  const recordSize = packedMythicPlusRecordSizeBytes(layout);
  const joined = new Uint8Array(records.length * recordSize);
  records.forEach((rec, i) => joined.set(rec, i * recordSize));
  const payload = `provider.lookup[1] = "${encodeLuaByteString(joined)}"\n`;
  if (extra.includeProviderHeader === false) return payload;
  const region = (extra.region ?? "EU").toLowerCase();
  const order = layout.encodingOrder.join(",");
  const milestones = MYTHICPLUS_MILESTONES.join(",");
  return [
    `local provider={name=...,data=1,region="${region}",date="2026-08-31T07:33:22Z",currentSeasonId=0,numCharacters=${records.length},keystoneMilestoneLevels={${milestones}},lookup={},recordSizeInBytes=${recordSize},encodingOrder={${order}}}`,
    payload,
  ].join("\n");
}

export function buildCharactersLua(input: {
  date?: string;
  names: string[];
  region?: string;
  recordSizeInBytes?: number;
  encodingOrder?: readonly number[];
}): string {
  const quoted = input.names.map((n) => `"${n}"`).join(",");
  const recordSize = input.recordSizeInBytes ?? packedMythicPlusRecordSizeBytes(LEGACY_MYTHICPLUS_LAYOUT);
  const order = (input.encodingOrder ?? LEGACY_MYTHICPLUS_LAYOUT.encodingOrder).join(", ");
  return [
    `ns.region = "${(input.region ?? "EU").toUpperCase()}"`,
    `ns.date = "${input.date ?? "2026-08-14T00:00:00Z"}"`,
    `ns.currentSeasonId = 0`,
    `ns.numCharacters = ${input.names.length}`,
    `ns.recordSizeInBytes = ${recordSize}`,
    `ns.encodingOrder = {${order}}`,
    `ns.keystoneMilestoneLevels = {${MYTHICPLUS_MILESTONES.join(", ")}}`,
    `provider.db["TestRealm"]={0,${quoted}} end F()`,
    "",
  ].join("\n");
}

export function buildDungeonsLua(names: string[] = [
  "Ara-Kara, City of Echoes",
  "Dawnbreaker",
  "Eco-Dome Aldani",
  "Halls of Atonement",
  "Operation: Floodgate",
  "Priory of the Sacred Flame",
  "Tazavesh: So'leah's Gambit",
  "Tazavesh: Streets of Wonder",
]): string {
  const rows = names.map((name, i) => {
    const mapId = 2600 + i;
    return `{ id = ${100 + i}, keystone_instance = ${200 + i}, instance_map_id = ${mapId}, lfd_activity_ids = {1}, name = "${name}", shortName = "D${i + 1}" },`;
  });
  return `ns.dungeons = {\n${rows.join("\n")}\n}\n`;
}

function writeDungeonSlots(
  buf: Uint8Array,
  bit: number,
  dungeonCount: number,
  levels: readonly number[],
  chests: readonly number[] | undefined,
): number {
  let offset = bit;
  for (let i = 0; i < dungeonCount; i++) {
    offset = writeBits(buf, offset, PACKED_DUNGEON_KEY_FIELD_BITS, levels[i] ?? 0);
    offset = writeBits(buf, offset, PACKED_DUNGEON_CHEST_FIELD_BITS, chests?.[i] ?? 0);
  }
  return offset;
}
