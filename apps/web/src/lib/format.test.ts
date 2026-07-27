import { describe, expect, it } from "vitest";
import { canonicalCharacterPath, validateCompareCount, RADAR_DIMENSIONS } from "../lib/format";

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

  it("keeps stable radar dimension order", () => {
    expect([...RADAR_DIMENSIONS]).toEqual([
      "PERFORMANCE",
      "SURVIVAL",
      "UTILITY",
      "EXPERIENCE",
      "RAID",
    ]);
  });

  it("exposes four core trust dimensions", async () => {
    const { CORE_TRUST_DIMENSIONS } = await import("../lib/format");
    expect([...CORE_TRUST_DIMENSIONS]).toEqual([
      "PERFORMANCE",
      "SURVIVAL",
      "UTILITY",
      "EXPERIENCE",
    ]);
  });
});
