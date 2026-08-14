import { writeBits } from "./packed-bits.js";
import { encodeLuaByteString } from "./lua-strings.js";
import {
  MYTHICPLUS_DUNGEON_SLOTS,
  MYTHICPLUS_MILESTONES,
  MYTHICPLUS_RECORD_SIZE_BYTES,
} from "./types.js";

export function encodeMythicPlusRecord(input: {
  currentScore?: number;
  dungeonLevels: number[];
  dungeonChests?: number[];
  warbandDungeonLevels?: number[];
}): Uint8Array {
  const buf = new Uint8Array(MYTHICPLUS_RECORD_SIZE_BYTES);
  let bit = 0;
  bit = writeBits(buf, bit, 13, input.currentScore ?? 0);
  bit = writeBits(buf, bit, 7, 0);
  bit = writeBits(buf, bit, 13, 0);
  bit = writeBits(buf, bit, 7, 0);
  for (let i = 0; i < MYTHICPLUS_MILESTONES.length; i++) bit = writeBits(buf, bit, 8, 0);
  for (let i = 0; i < MYTHICPLUS_DUNGEON_SLOTS; i++) {
    bit = writeBits(buf, bit, 6, input.dungeonLevels[i] ?? 0);
    bit = writeBits(buf, bit, 2, input.dungeonChests?.[i] ?? 0);
  }
  bit = writeBits(buf, bit, 4, 0);
  bit = writeBits(buf, bit, 13, 0);
  for (let i = 0; i < MYTHICPLUS_DUNGEON_SLOTS; i++) {
    bit = writeBits(buf, bit, 6, input.warbandDungeonLevels?.[i] ?? 0);
    bit = writeBits(buf, bit, 2, 0);
  }
  writeBits(buf, bit, 7, 0);
  return buf;
}

export function buildLookupLua(records: Uint8Array[]): string {
  const joined = new Uint8Array(records.length * MYTHICPLUS_RECORD_SIZE_BYTES);
  records.forEach((rec, i) => joined.set(rec, i * MYTHICPLUS_RECORD_SIZE_BYTES));
  return `provider.lookup[1] = "${encodeLuaByteString(joined)}"\n`;
}

export function buildCharactersLua(input: {
  date?: string;
  names: string[];
}): string {
  const quoted = input.names.map((n) => `"${n}"`).join(",");
  return [
    `ns.region = "EU"`,
    `ns.date = "${input.date ?? "2026-08-14T00:00:00Z"}"`,
    `ns.currentSeasonId = 0`,
    `ns.numCharacters = ${input.names.length}`,
    `ns.recordSizeInBytes = 30`,
    `ns.encodingOrder = {1, 2, 5, 6, 9, 10, 11, 12, 14, 15}`,
    `ns.keystoneMilestoneLevels = {15, 12, 10, 7, 4, 2}`,
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
