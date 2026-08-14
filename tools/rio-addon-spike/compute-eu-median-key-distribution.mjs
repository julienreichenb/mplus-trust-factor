/**
 * Exploratory (non-production) decoder for the official Raider.IO addon
 * Mythic+ EU character database.
 *
 * Source: GitHub release asset RaiderIO-vYYYYMMDDHHMM.zip
 * Does not write SeasonMedianKeyDistributionSnapshot.
 * Does not convert Mythic+ score cutoffs into key levels.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTRACT = path.join(__dirname, "extract");
const LOOKUP = path.join(EXTRACT, "db_mythicplus_eu_lookup.lua");
const CHARS = path.join(EXTRACT, "db_mythicplus_eu_characters.lua");
const DUNGEONS = path.join(EXTRACT, "db_dungeons.lua");

const RECORD_SIZE = 30;
const DUNGEON_COUNT = 8;
const ENCODING_ORDER = [1, 2, 5, 6, 9, 10, 11, 12, 14, 15];
const MILESTONES = [15, 12, 10, 7, 4, 2];

function unescapeLuaString(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== "\\") {
      out.push(src.charCodeAt(i) & 0xff);
      continue;
    }
    const n = src[i + 1];
    if (n === undefined) break;
    if (n >= "0" && n <= "9") {
      let digits = n;
      let consumed = 1;
      if (src[i + 2] >= "0" && src[i + 2] <= "9") {
        digits += src[i + 2];
        consumed = 2;
        if (src[i + 3] >= "0" && src[i + 3] <= "9") {
          digits += src[i + 3];
          consumed = 3;
        }
      }
      out.push(Number(digits) & 0xff);
      i += consumed;
      continue;
    }
    const map = { n: 10, r: 13, t: 9, a: 7, b: 8, f: 12, v: 11, "\\": 92, '"': 34, "'": 39 };
    out.push(map[n] ?? n.charCodeAt(0));
    i += 1;
  }
  return Buffer.from(out);
}

function readBits(buf, bitOffset, length) {
  let value = 0;
  let readOffset = 0;
  const firstByteShift = bitOffset % 8;
  const bytesToRead = Math.ceil((length + firstByteShift) / 8);
  while (readOffset < length) {
    const byteIndex = Math.floor((bitOffset + readOffset) / 8);
    const byte = buf[byteIndex] ?? 0;
    let bitsRead = 0;
    if (readOffset === 0) {
      if (bytesToRead === 1) {
        const availableBits = length - readOffset;
        value = (byte >>> firstByteShift) & ((1 << availableBits) - 1);
        bitsRead = length;
      } else {
        value = byte >>> firstByteShift;
        bitsRead = 8 - firstByteShift;
      }
    } else {
      const availableBits = length - readOffset;
      if (availableBits < 8) {
        value += (byte & ((1 << availableBits) - 1)) << readOffset;
        bitsRead = availableBits;
      } else {
        value += byte << readOffset;
        bitsRead = Math.min(8, length);
      }
    }
    readOffset += bitsRead;
  }
  return { value, bitOffset: bitOffset + length };
}

function decodeRecord(buf, byteOffset0) {
  let bitOffset = byteOffset0 * 8;
  const rec = {
    currentScore: 0,
    currentRoleOrdinal: 0,
    mainCurrentScore: 0,
    dungeonLevels: /** @type {number[]} */ ([]),
    dungeonChests: /** @type {number[]} */ ([]),
    warbandDungeonLevels: /** @type {number[]} */ ([]),
    maxDungeonIndex: 0,
    warbandCurrentScore: 0,
  };
  for (const field of ENCODING_ORDER) {
    if (field === 1) {
      const r = readBits(buf, bitOffset, 13);
      rec.currentScore = r.value;
      bitOffset = r.bitOffset;
    } else if (field === 2 || field === 6 || field === 15) {
      const r = readBits(buf, bitOffset, 7);
      if (field === 2) rec.currentRoleOrdinal = 1 + r.value;
      bitOffset = r.bitOffset;
    } else if (field === 5) {
      const r = readBits(buf, bitOffset, 13);
      rec.mainCurrentScore = r.value;
      bitOffset = r.bitOffset;
    } else if (field === 9) {
      for (let i = 0; i < MILESTONES.length; i++) {
        const r = readBits(buf, bitOffset, 8);
        bitOffset = r.bitOffset;
      }
    } else if (field === 10 || field === 14) {
      const levels = [];
      const chests = [];
      for (let i = 0; i < DUNGEON_COUNT; i++) {
        const lv = readBits(buf, bitOffset, 6);
        const ch = readBits(buf, lv.bitOffset, 2);
        levels.push(lv.value);
        chests.push(ch.value);
        bitOffset = ch.bitOffset;
      }
      if (field === 10) {
        rec.dungeonLevels = levels;
        rec.dungeonChests = chests;
      } else rec.warbandDungeonLevels = levels;
    } else if (field === 11) {
      const r = readBits(buf, bitOffset, 4);
      rec.maxDungeonIndex = 1 + r.value;
      bitOffset = r.bitOffset;
    } else if (field === 12) {
      const r = readBits(buf, bitOffset, 13);
      rec.warbandCurrentScore = r.value;
      bitOffset = r.bitOffset;
    }
  }
  return rec;
}

function characterMedian(levels) {
  const sorted = [...levels].sort((a, b) => a - b);
  return (sorted[3] + sorted[4]) / 2;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  const mixed = sorted[lo] * (1 - t) + sorted[hi] * t;
  return mixed;
}

function nearestHalf(value) {
  return Math.round(value * 2) / 2;
}

function parseDungeons(src) {
  const names = [];
  const re = /\["name"\]\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) && names.length < 8) names.push(m[1]);
  const season = src.match(/Dungeons for this season \(([^)]+)\)/);
  return { seasonSlug: season?.[1] ?? null, names };
}

function parseAdjacentLuaStrings(text, quoteStart) {
  const parts = [];
  let i = quoteStart;
  while (i < text.length) {
    while (i < text.length && (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t")) i += 1;
    if (text[i] !== '"') break;
    i += 1;
    let raw = "";
    while (i < text.length) {
      if (text[i] === "\\") {
        raw += text[i] + (text[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (text[i] === '"') {
        i += 1;
        break;
      }
      raw += text[i];
      i += 1;
    }
    parts.push(unescapeLuaString(raw));
  }
  return Buffer.concat(parts);
}

function loadLookupBuffer() {
  const text = readFileSync(LOOKUP, "utf8");
  const marker = "provider.lookup[1] = ";
  const start = text.indexOf(marker);
  if (start < 0) throw new Error("lookup[1] assignment not found");
  const quote = text.indexOf('"', start + marker.length);
  const buf = parseAdjacentLuaStrings(text, quote);
  return buf;
}

async function loadCharacters() {
  const realms = [];
  const rl = createInterface({ input: createReadStream(CHARS, { encoding: "utf8" }) });
  for await (const line of rl) {
    const m = line.match(/provider\.db\["((?:\\.|[^"\\])*)"\]=\{(\d+),(.+)\} end F\(\)/);
    if (!m) continue;
    const realm = m[1];
    const offset = Number(m[2]);
    const namesPart = m[3];
    const names = [];
    const nameRe = /"((?:\\.|[^"\\])*)"/g;
    let nm;
    while ((nm = nameRe.exec(namesPart))) names.push(nm[1]);
    realms.push({ realm, offset, names });
  }
  return realms;
}

function main() {
  if (!existsSync(LOOKUP) || !existsSync(CHARS)) {
    throw new Error(
      `Extract missing. Download https://github.com/RaiderIO/raiderio-addon/releases/latest/download/RaiderIO-v*.zip and extract db_mythicplus_eu_{lookup,characters}.lua into ${EXTRACT}`,
    );
  }
  const dungeons = parseDungeons(readFileSync(DUNGEONS, "utf8"));
  const header = readFileSync(CHARS, "utf8").slice(0, 500);
  const meta = {
    region: "eu",
    date: header.match(/date="([^"]+)"/)?.[1] ?? null,
    currentSeasonId: Number(header.match(/currentSeasonId=(\d+)/)?.[1] ?? -1),
    numCharactersHeader: Number(header.match(/numCharacters=(\d+)/)?.[1] ?? -1),
    recordSizeInBytes: RECORD_SIZE,
    encodingOrder: ENCODING_ORDER,
    dungeonSeasonSlug: dungeons.seasonSlug,
    dungeonNames: dungeons.names,
    source: "github.com/RaiderIO/raiderio-addon releases",
    artifact: "RaiderIO-v202608140600.zip",
    tag: "v202608140600",
  };

  const lookup = loadLookupBuffer();
  const expected = meta.numCharactersHeader * RECORD_SIZE;
  console.log(`lookup bytes=${lookup.length} expected=${expected}`);

  return loadCharacters().then((realms) => {
    const named = realms.reduce((n, r) => n + r.names.length, 0);
    const medians = [];
    let withAllEight = 0;
    let withAnyKey = 0;
    let withScore = 0;
    let missingDungeonSlots = 0;
    const samples = [];
    const completeness = new Array(9).fill(0);

    for (const realm of realms) {
      for (let i = 0; i < realm.names.length; i++) {
        const byteOffset = realm.offset + i * RECORD_SIZE;
        if (byteOffset + RECORD_SIZE > lookup.length) continue;
        const rec = decodeRecord(lookup, byteOffset);
        const present = rec.dungeonLevels.filter((lv) => lv > 0).length;
        completeness[present] += 1;
        if (rec.currentScore > 0) withScore += 1;
        if (present > 0) withAnyKey += 1;
        if (present < 8) missingDungeonSlots += 8 - present;
        if (present === 8) {
          withAllEight += 1;
          medians.push(characterMedian(rec.dungeonLevels));
          if (samples.length < 8) {
            samples.push({
              realm: realm.realm,
              name: realm.names[i],
              currentScore: rec.currentScore,
              levels: rec.dungeonLevels,
              chests: rec.dungeonChests,
              median: characterMedian(rec.dungeonLevels),
            });
          }
        }
      }
    }

    medians.sort((a, b) => a - b);
    const pct = (p) => {
      const v = percentile(medians, p);
      return v == null ? null : { raw: v, nearestHalf: nearestHalf(v) };
    };
    const summary = {
      provenance: meta,
      lookupBytes: lookup.length,
      namedCharacters: named,
      eligibleRule:
        "EU addon-indexed characters with a current-season key level > 0 on all 8 ns.dungeons slots. Median = average of sorted positions 4 and 5 (1-based). Character dungeon levels, not warband overlay. Timed/untimed not required. No local CharacterScore. No score-to-key conversion.",
      counts: {
        namedCharacters: named,
        headerNumCharacters: meta.numCharactersHeader,
        lookupRecordSlots: Math.floor(lookup.length / RECORD_SIZE),
        headerNumCharactersNote:
          "provider.numCharacters on the EU file (1880464) does not equal named EU rows; named rows match lookupBytes/recordSizeInBytes. Treat named EU rows as the regional population size.",
        currentScoreGt0: withScore,
        anyDungeonKey: withAnyKey,
        eligibleAllEight: withAllEight,
        completeness0to8: completeness,
      },
      samplesAllEight: samples,
      distributionEligibleAllEight: medians.length
        ? {
            min: medians[0],
            max: medians[medians.length - 1],
            P50: pct(50),
            P60: pct(60),
            P75: pct(75),
            P90: pct(90),
            P95: pct(95),
            P99: pct(99),
            P99_9: pct(99.9),
          }
        : null,
    };
    mkdirSync(__dirname, { recursive: true });
    const out = path.join(__dirname, "poc-eu-summary.json");
    writeFileSync(out, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    console.log(`wrote ${out}`);
  });
}

await main();
