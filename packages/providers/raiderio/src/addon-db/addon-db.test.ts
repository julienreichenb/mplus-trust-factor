import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeMythicPlusRecord, sliceRecord } from "./decode-record.js";
import {
  buildCharactersLua,
  buildDungeonsLua,
  buildLookupLua,
  encodeCurrentMythicPlusRecord,
  encodeMythicPlusRecord,
} from "./fixture.js";
import { ingestMythicPlusAddonFiles } from "./ingest.js";
import { AddonDbFormatError } from "./types.js";
import { loadLookupBuffer } from "./parse-characters.js";
import { accumulateEligibleMedianHistogram } from "./histogram.js";
import { mapRioDungeonsToSeasonPool } from "./map-dungeons.js";
import { parseDbDungeonsLua } from "./parse-lua-meta.js";
import {
  CURRENT_MYTHICPLUS_LAYOUT,
  LEGACY_MYTHICPLUS_LAYOUT,
  packedMythicPlusRecordSizeBytes,
} from "./packed-layout.js";
import { pointsFromHistogram, validatePackedDungeonKeyDistribution } from "@mplus/scoring";
import { KEY_CONTEXT_PERCENTILE_BPS } from "@mplus/contracts";

const expectedDungeons = Array.from({ length: 8 }, (_, i) => ({
  slug: `d${i + 1}`,
  name: [
    "Ara-Kara, City of Echoes",
    "Dawnbreaker",
    "Eco-Dome Aldani",
    "Halls of Atonement",
    "Operation: Floodgate",
    "Priory of the Sacred Flame",
    "Tazavesh: So'leah's Gambit",
    "Tazavesh: Streets of Wonder",
  ][i]!,
  mapId: 2600 + i,
  raiderioSlug: `D${i + 1}`,
}));

const CURRENT_SIZE = packedMythicPlusRecordSizeBytes(CURRENT_MYTHICPLUS_LAYOUT);

/**
 * First EU packed record from RaiderIO-v202608310600 (38-byte current encodingOrder).
 * Decodes to score 2192 and dungeon levels [4, 9, 9, 9, 10, 6, 9, 8].
 */
const LIVE_EU_RECORD0_LUA = `local provider={name=...,data=1,region="eu",date="2026-08-31T07:33:22Z",currentSeasonId=1,numCharacters=1,keystoneMilestoneLevels={15,12,10,7,4,2},lookup={},recordSizeInBytes=38,encodingOrder={1,2,3,4,5,6,7,8,9,10,11,12,14,15,13,16}}
provider.lookup[1] = "\\144(\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\2\\10\\10\\4\\136\\18\\19\\19\\149\\140\\18\\144\\8\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0:"
`;

describe("Raider.IO addon packed decoder", () => {
  it("decodes 8 character dungeon levels and ignores warband overlay", () => {
    const rec = encodeMythicPlusRecord({
      dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 17],
      dungeonChests: [0, 1, 2, 3, 0, 1, 2, 3],
      warbandDungeonLevels: [20, 20, 20, 20, 20, 20, 20, 20],
    });
    const decoded = decodeMythicPlusRecord(rec);
    expect(decoded.dungeonLevels).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);
    expect(decoded.dungeonChests).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(decoded.warbandDungeonLevels).toEqual([20, 20, 20, 20, 20, 20, 20, 20]);
  });

  it("does not erase key level when chests are set", () => {
    const rec = encodeMythicPlusRecord({
      dungeonLevels: [12, 12, 12, 12, 12, 12, 12, 12],
      dungeonChests: [3, 3, 3, 3, 3, 3, 3, 3],
    });
    expect(decodeMythicPlusRecord(rec).dungeonLevels.every((lv) => lv === 12)).toBe(true);
  });

  it("rejects malformed record length", () => {
    expect(() => decodeMythicPlusRecord(new Uint8Array(10))).toThrow(AddonDbFormatError);
  });

  it("rejects truncated lookup slices", () => {
    const lookup = encodeMythicPlusRecord({ dungeonLevels: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(() => sliceRecord(lookup, 2)).toThrow(/outside lookup/);
  });

  it("decodes a current 38-byte Raider.IO packed record fixture to dungeon key levels", () => {
    expect(CURRENT_SIZE).toBe(38);
    const rec = encodeCurrentMythicPlusRecord({
      currentScore: 3049,
      dungeonLevels: [13, 13, 13, 13, 13, 12, 13, 12],
      dungeonChests: [1, 1, 1, 1, 1, 2, 2, 1],
    });
    expect(rec.length).toBe(38);
    const decoded = decodeMythicPlusRecord(rec, CURRENT_MYTHICPLUS_LAYOUT);
    expect(decoded.currentScore).toBe(3049);
    expect(decoded.dungeonLevels).toEqual([13, 13, 13, 13, 13, 12, 13, 12]);
    expect(decoded.dungeonChests).toEqual([1, 1, 1, 1, 1, 2, 2, 1]);
  });

  it("decodes the live v202608310600 EU record-0 fixture", () => {
    const buf = loadLookupBuffer(LIVE_EU_RECORD0_LUA);
    const rec = buf.subarray(0, CURRENT_SIZE);
    expect(rec.length).toBe(38);
    const decoded = decodeMythicPlusRecord(rec, CURRENT_MYTHICPLUS_LAYOUT);
    expect(decoded.currentScore).toBe(2192);
    expect(decoded.dungeonLevels).toEqual([4, 9, 9, 9, 10, 6, 9, 8]);
  });
});

describe("eligible histogram", () => {
  it("excludes missing level 0 and includes 8/8 including .5 medians", () => {
    const complete = encodeCurrentMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 17] });
    const missing = encodeCurrentMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 0] });
    const lookup = new Uint8Array(CURRENT_SIZE * 2);
    lookup.set(complete, 0);
    lookup.set(missing, CURRENT_SIZE);
    const result = accumulateEligibleMedianHistogram(
      lookup,
      [{ byteOffset: 0 }, { byteOffset: CURRENT_SIZE }],
      CURRENT_MYTHICPLUS_LAYOUT,
    );
    expect(result.indexedCharacters).toBe(2);
    expect(result.eligibleCharacters).toBe(1);
    expect(result.histogram.get(13.5)).toBe(1);
  });

  it("rejects lookup blobs whose length is not divisible by record size", () => {
    const complete = encodeCurrentMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 17] });
    const lookup = new Uint8Array(CURRENT_SIZE + 1);
    lookup.set(complete, 0);
    expect(() =>
      accumulateEligibleMedianHistogram(lookup, [{ byteOffset: 0 }], CURRENT_MYTHICPLUS_LAYOUT),
    ).toThrow(/not divisible/);
  });

  it("rejects truncated lookup when a named offset extends past the blob", () => {
    const lookup = new Uint8Array(CURRENT_SIZE - 1);
    expect(() =>
      accumulateEligibleMedianHistogram(lookup, [{ byteOffset: 0 }], CURRENT_MYTHICPLUS_LAYOUT),
    ).toThrow(AddonDbFormatError);
  });

  it("rejects 6-bit field saturation instead of publishing ~57–63 keys", () => {
    const rec = encodeCurrentMythicPlusRecord({ dungeonLevels: [61, 61, 61, 61, 62, 62, 63, 63] });
    const lookup = new Uint8Array(CURRENT_SIZE);
    lookup.set(rec, 0);
    expect(() =>
      accumulateEligibleMedianHistogram(lookup, [{ byteOffset: 0 }], CURRENT_MYTHICPLUS_LAYOUT),
    ).toThrow(AddonDbFormatError);
  });
});

describe("season dungeon mapping", () => {
  it("fails when current-season dungeon set does not match", () => {
    const lua = buildDungeonsLua();
    const rio = parseDbDungeonsLua(lua, 0);
    expect(() =>
      mapRioDungeonsToSeasonPool(
        rio,
        expectedDungeons.map((d, i) =>
          i === 0
            ? { slug: "wrong", name: "Wrong Dungeon", mapId: 1, raiderioSlug: "ZZ" }
            : d,
        ),
      ),
    ).toThrow(AddonDbFormatError);
  });

  it("reads current-season ns.dungeons when expansion history is present", () => {
    const current = buildDungeonsLua();
    const expansion = buildDungeonsLua([
      "Pit of Saron",
      "Skyreach",
      "Seat of the Triumvirate",
      "Algeth'ar Academy",
      "Windrunner Spire",
      "Magisters' Terrace",
      "Maisara Caverns",
      "Nexus-Point Xenas",
    ]).replace("ns.dungeons", "ns.expansionDungeons");
    const rio = parseDbDungeonsLua(`${current}\n${expansion}`, 1);
    expect(rio.map((d) => d.name)).toEqual([
      "Ara-Kara, City of Echoes",
      "Dawnbreaker",
      "Eco-Dome Aldani",
      "Halls of Atonement",
      "Operation: Floodgate",
      "Priory of the Sacred Flame",
      "Tazavesh: So'leah's Gambit",
      "Tazavesh: Streets of Wonder",
    ]);
  });
});

describe("ingestMythicPlusAddonFiles", () => {
  it("computes realistic percentiles from current-format packed records", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rio-addon-"));
    const levelsFor = (medianPair: [number, number]) => {
      const [a, b] = medianPair;
      return [a, a, a, a, b, b, b, b];
    };
    const records = [
      ...Array.from({ length: 6 }, () => encodeCurrentMythicPlusRecord({ dungeonLevels: levelsFor([10, 10]) })),
      ...Array.from({ length: 3 }, () => encodeCurrentMythicPlusRecord({ dungeonLevels: levelsFor([12, 12]) })),
      encodeCurrentMythicPlusRecord({ dungeonLevels: levelsFor([15, 15]) }),
    ];
    await writeFile(path.join(dir, "lookup.lua"), buildLookupLua(records, CURRENT_MYTHICPLUS_LAYOUT));
    await writeFile(
      path.join(dir, "chars.lua"),
      buildCharactersLua({
        names: records.map((_, i) => `Char${i}`),
        recordSizeInBytes: CURRENT_SIZE,
        encodingOrder: CURRENT_MYTHICPLUS_LAYOUT.encodingOrder,
      }),
    );
    await writeFile(path.join(dir, "dungeons.lua"), buildDungeonsLua());
    const result = await ingestMythicPlusAddonFiles({
      regionCode: "EU",
      lookupLuaPath: path.join(dir, "lookup.lua"),
      charactersLuaPath: path.join(dir, "chars.lua"),
      dungeonsLuaPath: path.join(dir, "dungeons.lua"),
      expectedDungeons,
      releaseTag: "v202608310600",
      assetName: "RaiderIO-v202608310600.zip",
      assetSha256: "abc",
    });
    expect(result.population.eligibleCharacters).toBe(10);
    expect(result.points.map((p) => p.percentileBps)).toEqual([6000, 7500, 9000, 9900, 9990]);
    expect(result.points.find((p) => p.percentileBps === 6000)?.medianKeyThreshold).toBe(10);
    expect(result.points.find((p) => p.percentileBps === 7500)?.medianKeyThreshold).toBe(12);
    expect(result.points.find((p) => p.percentileBps === 9000)?.medianKeyThreshold).toBe(12);
    expect(result.points.find((p) => p.percentileBps === 9900)?.medianKeyThreshold).toBe(15);
    expect(result.points.every((p: { medianKeyThreshold: number }) => p.medianKeyThreshold <= 16)).toBe(true);
    expect(result.sourceMetadata.recordSizeInBytes).toBe(38);
    expect(result.contentHash).toHaveLength(64);
  });

  it("fails closed when lookup encodingOrder is missing or incompatible", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rio-addon-bad-"));
    const rec = encodeCurrentMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 17] });
    await writeFile(
      path.join(dir, "lookup.lua"),
      buildLookupLua([rec], CURRENT_MYTHICPLUS_LAYOUT).replace(
        "encodingOrder={1,2,3,4,5,6,7,8,9,10,11,12,14,15,13,16}",
        "encodingOrder={1}",
      ),
    );
    await writeFile(
      path.join(dir, "chars.lua"),
      buildCharactersLua({
        names: ["A"],
        recordSizeInBytes: CURRENT_SIZE,
        encodingOrder: CURRENT_MYTHICPLUS_LAYOUT.encodingOrder,
      }),
    );
    await writeFile(path.join(dir, "dungeons.lua"), buildDungeonsLua());
    await expect(
      ingestMythicPlusAddonFiles({
        regionCode: "EU",
        lookupLuaPath: path.join(dir, "lookup.lua"),
        charactersLuaPath: path.join(dir, "chars.lua"),
        dungeonsLuaPath: path.join(dir, "dungeons.lua"),
        expectedDungeons,
        releaseTag: "v1",
        assetName: "x.zip",
        assetSha256: "x",
      }),
    ).rejects.toBeInstanceOf(AddonDbFormatError);
  });

  it("rejects the legacy 30-byte layout when the provider header declares 38-byte records", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rio-addon-legacy-"));
    const rec = encodeMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 17] }, LEGACY_MYTHICPLUS_LAYOUT);
    await writeFile(path.join(dir, "lookup.lua"), buildLookupLua([rec], CURRENT_MYTHICPLUS_LAYOUT));
    await writeFile(
      path.join(dir, "chars.lua"),
      buildCharactersLua({
        names: ["A"],
        recordSizeInBytes: CURRENT_SIZE,
        encodingOrder: CURRENT_MYTHICPLUS_LAYOUT.encodingOrder,
      }),
    );
    await writeFile(path.join(dir, "dungeons.lua"), buildDungeonsLua());
    await expect(
      ingestMythicPlusAddonFiles({
        regionCode: "EU",
        lookupLuaPath: path.join(dir, "lookup.lua"),
        charactersLuaPath: path.join(dir, "chars.lua"),
        dungeonsLuaPath: path.join(dir, "dungeons.lua"),
        expectedDungeons,
        releaseTag: "v1",
        assetName: "x.zip",
        assetSha256: "x",
      }),
    ).rejects.toBeInstanceOf(AddonDbFormatError);
  });

  it("E/F: same ingest implementation for US and fails closed on region mismatch", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rio-addon-us-"));
    const rec = encodeCurrentMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 17] });
    await writeFile(path.join(dir, "lookup.lua"), buildLookupLua([rec], CURRENT_MYTHICPLUS_LAYOUT, { region: "US" }));
    await writeFile(
      path.join(dir, "chars.lua"),
      buildCharactersLua({
        names: ["A"],
        region: "US",
        recordSizeInBytes: CURRENT_SIZE,
        encodingOrder: CURRENT_MYTHICPLUS_LAYOUT.encodingOrder,
      }),
    );
    await writeFile(path.join(dir, "dungeons.lua"), buildDungeonsLua());
    const us = await ingestMythicPlusAddonFiles({
      regionCode: "US",
      lookupLuaPath: path.join(dir, "lookup.lua"),
      charactersLuaPath: path.join(dir, "chars.lua"),
      dungeonsLuaPath: path.join(dir, "dungeons.lua"),
      expectedDungeons,
      releaseTag: "v1",
      assetName: "x.zip",
      assetSha256: "x",
    });
    expect(us.region).toBe("US");
    await expect(
      ingestMythicPlusAddonFiles({
        regionCode: "EU",
        lookupLuaPath: path.join(dir, "lookup.lua"),
        charactersLuaPath: path.join(dir, "chars.lua"),
        dungeonsLuaPath: path.join(dir, "dungeons.lua"),
        expectedDungeons,
        releaseTag: "v1",
        assetName: "x.zip",
        assetSha256: "x",
      }),
    ).rejects.toBeInstanceOf(AddonDbFormatError);
  });
});

describe("packed key distribution validation", () => {
  it("accepts realistic current-season percentiles", () => {
    const histogram = new Map([
      [10, 6],
      [12, 3],
      [15, 1],
    ]);
    const points = pointsFromHistogram(histogram, KEY_CONTEXT_PERCENTILE_BPS);
    expect(validatePackedDungeonKeyDistribution(points).ok).toBe(true);
    expect(points.find((p) => p.percentileBps === 9000)?.medianKeyThreshold).toBe(12);
  });

  it("rejects previously observed absurd ~57–63 thresholds", () => {
    expect(
      validatePackedDungeonKeyDistribution([
        { percentileBps: 6000, medianKeyThreshold: 26 },
        { percentileBps: 7500, medianKeyThreshold: 46 },
        { percentileBps: 9000, medianKeyThreshold: 57 },
        { percentileBps: 9900, medianKeyThreshold: 61 },
        { percentileBps: 9990, medianKeyThreshold: 61 },
      ]).ok,
    ).toBe(false);
  });
});

describe("lookup lua round-trip", () => {
  it("loads adjacent lua strings", () => {
    const rec = encodeMythicPlusRecord({ dungeonLevels: [8, 8, 8, 8, 8, 8, 8, 8] });
    const lua = buildLookupLua([rec]);
    const buf = loadLookupBuffer(lua);
    expect(buf.length).toBe(30);
    expect([...decodeMythicPlusRecord(buf).dungeonLevels]).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
  });
});

describe("parseGithubAssetDigest", () => {
  it("parses sha256 hex from GitHub digest and rejects other formats", async () => {
    const { parseGithubAssetDigest } = await import("./github-releases.js");
    expect(parseGithubAssetDigest("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(parseGithubAssetDigest("md5:abc")).toBeNull();
    expect(parseGithubAssetDigest(null)).toBeNull();
  });
});
