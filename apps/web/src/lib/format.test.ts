import { describe, expect, it } from "vitest";
import { canonicalCharacterPath, validateCompareCount, RADAR_DIMENSIONS, RADAR_DIMENSIONS_V3, resolveRadarDimensions } from "../lib/format";
import { parseCharacterQuery } from "../lib/parseCharacterQuery";

describe("format helpers", () => {
  it("canonicalizes character path params", () => {
    expect(canonicalCharacterPath("eu", "Tarren Mill", " Aleria ")).toEqual({
      region: "EU",
      realm: "tarren-mill",
      name: "Aleria",
    });
  });

  it("validates compare count", () => {
    expect(validateCompareCount(1)).toMatch(/at least 2/);
    expect(validateCompareCount(1, { minimum: false })).toBeNull();
    expect(validateCompareCount(11)).toMatch(/at most 10/);
    expect(validateCompareCount(5)).toBeNull();
  });

  it("keeps stable radar dimension order for legacy models", () => {
    expect([...RADAR_DIMENSIONS]).toEqual([
      "PERFORMANCE",
      "SURVIVAL",
      "UTILITY",
      "EXPERIENCE",
      "RAID",
    ]);
  });

  it("excludes raid for default@3 models", () => {
    expect([...RADAR_DIMENSIONS_V3]).toEqual([
      "PERFORMANCE",
      "SURVIVAL",
      "UTILITY",
      "EXPERIENCE",
    ]);
    expect(resolveRadarDimensions(3).map((d) => d)).not.toContain("RAID");
    expect(resolveRadarDimensions(2).map((d) => d)).toContain("RAID");
  });
});

describe("parseCharacterQuery", () => {
  it("parses Name-Realm queries", () => {
    expect(parseCharacterQuery("Aleria-tarren-mill")).toEqual({
      name: "Aleria",
      realm: "tarren-mill",
    });
    expect(parseCharacterQuery("Wallidrixe-Archimonde")).toEqual({
      name: "Wallidrixe",
      realm: "Archimonde",
    });
  });
});
