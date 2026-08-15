import { describe, expect, it } from "vitest";
import { filterFaqEntries, faqEntryMatchesQuery } from "./faqSearch";

const sample = [
  { id: "1", title: "How is Trust Score calculated?", description: "Four public skill dimensions.", position: 1 },
  { id: "2", title: "Where does data come from?", description: "Blizzard, Raider.IO and Warcraft Logs.", position: 2 },
];

describe("faqSearch", () => {
  it("matches title case-insensitively", () => {
    expect(faqEntryMatchesQuery(sample[0]!, "trust score")).toBe(true);
    expect(faqEntryMatchesQuery(sample[0]!, "TRUST SCORE")).toBe(true);
  });

  it("matches description", () => {
    expect(faqEntryMatchesQuery(sample[1]!, "warcraft logs")).toBe(true);
  });

  it("is accent insensitive", () => {
    expect(faqEntryMatchesQuery({ title: "Café", description: "Résumé" }, "cafe")).toBe(true);
    expect(faqEntryMatchesQuery({ title: "Cafe", description: "x" }, "café")).toBe(true);
  });

  it("returns all entries for an empty query", () => {
    expect(filterFaqEntries(sample, "   ")).toEqual(sample);
  });
});
