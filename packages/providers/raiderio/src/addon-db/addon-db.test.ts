import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeMythicPlusRecord, sliceRecord } from "./decode-record.js";
import { encodeMythicPlusRecord, buildLookupLua, buildCharactersLua, buildDungeonsLua } from "./fixture.js";
import { ingestMythicPlusAddonFiles } from "./ingest.js";
import { AddonDbFormatError } from "./types.js";
import { loadLookupBuffer } from "./parse-characters.js";
import { accumulateEligibleMedianHistogram, lookupRecordDataOffset, oneBasedRecordSliceOffset } from "./histogram.js";
import { mapRioDungeonsToSeasonPool } from "./map-dungeons.js";
import { parseDbDungeonsLua } from "./parse-lua-meta.js";

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
});

describe("lookup record offsets", () => {
  it("detects one-byte live lookup prefix from non-divisible blob length", () => {
    expect(lookupRecordDataOffset(new Uint8Array(31))).toBe(1);
    expect(lookupRecordDataOffset(new Uint8Array(30))).toBe(0);
    expect(oneBasedRecordSliceOffset(0, 1)).toBe(2);
    expect(oneBasedRecordSliceOffset(61712, 1)).toBe(61714);
    expect(oneBasedRecordSliceOffset(0, 0)).toBe(1);
  });
});

describe("eligible histogram", () => {
  it("excludes missing level 0 and includes 8/8 including .5 medians", () => {
    const complete = encodeMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 17] });
    const missing = encodeMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 0] });
    const lookup = new Uint8Array(60);
    lookup.set(complete, 0);
    lookup.set(missing, 30);
    const result = accumulateEligibleMedianHistogram(lookup, [{ byteOffset: 0 }, { byteOffset: 30 }]);
    expect(result.indexedCharacters).toBe(2);
    expect(result.eligibleCharacters).toBe(1);
    expect(result.histogram.get(13.5)).toBe(1);
  });

  it("accepts prefixed lookup blobs with trailing bytes when every named offset fits", () => {
    const complete = encodeMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 17] });
    const lookup = new Uint8Array(32);
    lookup[0] = 0xff;
    lookup.set(complete, 1);
    const result = accumulateEligibleMedianHistogram(lookup, [{ byteOffset: 0 }]);
    expect(result.eligibleCharacters).toBe(1);
    expect(lookup.length % 30).not.toBe(0);
  });

  it("rejects truncated lookup when a named offset extends past the blob", () => {
    const lookup = new Uint8Array(29);
    expect(() => accumulateEligibleMedianHistogram(lookup, [{ byteOffset: 0 }])).toThrow(AddonDbFormatError);
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
  it("computes locked percentiles from a tiny synthetic population", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rio-addon-"));
    const levelsFor = (medianPair: [number, number]) => {
      const [a, b] = medianPair;
      return [a, a, a, a, b, b, b, b];
    };
    const records = [
      ...Array.from({ length: 6 }, () => encodeMythicPlusRecord({ dungeonLevels: levelsFor([14, 14]) })),
      ...Array.from({ length: 3 }, () => encodeMythicPlusRecord({ dungeonLevels: levelsFor([16, 16]) })),
      encodeMythicPlusRecord({ dungeonLevels: levelsFor([18, 18]) }),
    ];
    await writeFile(path.join(dir, "lookup.lua"), buildLookupLua(records));
    await writeFile(
      path.join(dir, "chars.lua"),
      buildCharactersLua({ names: records.map((_, i) => `Char${i}`) }),
    );
    await writeFile(path.join(dir, "dungeons.lua"), buildDungeonsLua());
    const result = await ingestMythicPlusAddonFiles({
      regionCode: "EU",
      lookupLuaPath: path.join(dir, "lookup.lua"),
      charactersLuaPath: path.join(dir, "chars.lua"),
      dungeonsLuaPath: path.join(dir, "dungeons.lua"),
      expectedDungeons,
      releaseTag: "v202608140600",
      assetName: "RaiderIO-v202608140600.zip",
      assetSha256: "abc",
    });
    expect(result.population.eligibleCharacters).toBe(10);
    expect(result.points.map((p) => p.percentileBps)).toEqual([6000, 7500, 9000, 9900, 9990]);
    expect(result.points.find((p) => p.percentileBps === 6000)?.medianKeyThreshold).toBe(14);
    expect(result.points.find((p) => p.percentileBps === 7500)?.medianKeyThreshold).toBe(16);
    expect(result.points.find((p) => p.percentileBps === 9000)?.medianKeyThreshold).toBe(16);
    expect(result.points.find((p) => p.percentileBps === 9900)?.medianKeyThreshold).toBe(18);
    expect(result.contentHash).toHaveLength(64);
    const again = await ingestMythicPlusAddonFiles({
      regionCode: "EU",
      lookupLuaPath: path.join(dir, "lookup.lua"),
      charactersLuaPath: path.join(dir, "chars.lua"),
      dungeonsLuaPath: path.join(dir, "dungeons.lua"),
      expectedDungeons,
      releaseTag: "v202608140600",
      assetName: "RaiderIO-v202608140600.zip",
      assetSha256: "abc",
    });
    expect(again.contentHash).toBe(result.contentHash);
  });

  it("fails on unexpected encoding format", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rio-addon-bad-"));
    const rec = encodeMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 17] });
    await writeFile(path.join(dir, "lookup.lua"), buildLookupLua([rec]));
    await writeFile(
      path.join(dir, "chars.lua"),
      buildCharactersLua({ names: ["A"] }).replace("encodingOrder = {1, 2, 5, 6, 9, 10, 11, 12, 14, 15}", "encodingOrder = {1}"),
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
    const rec = encodeMythicPlusRecord({ dungeonLevels: [10, 11, 12, 13, 14, 15, 16, 17] });
    await writeFile(path.join(dir, "lookup.lua"), buildLookupLua([rec]));
    await writeFile(
      path.join(dir, "chars.lua"),
      buildCharactersLua({ names: ["A"], region: "US" }),
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
