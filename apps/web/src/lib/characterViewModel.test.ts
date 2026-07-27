import { describe, expect, it } from "vitest";
import {
  dimensionRows,
  mapEquipmentSlots,
  parseContributorSignals,
  presentGrade,
  resolveDataConfidence,
  topSignals,
} from "./characterViewModel";
import { FIXTURE_CHARACTERS } from "../api/mock/fixtures";

describe("characterViewModel", () => {
  it("presents letter grades with textual interpretation", () => {
    expect(presentGrade("A")).toMatchObject({
      letter: "A",
      interpretation: "Strong trust profile",
      isUnrated: false,
    });
  });

  it("treats U as unrated rather than a weak tier", () => {
    const u = presentGrade("U");
    expect(u.isUnrated).toBe(true);
    expect(u.title).toBe("Unrated");
    expect(u.interpretation).toMatch(/Insufficient evidence/i);
  });

  it("resolves confidence from profile or score", () => {
    const profile = FIXTURE_CHARACTERS[0]!.profile;
    expect(resolveDataConfidence(profile)).toBe(78);
    expect(
      resolveDataConfidence({
        ...profile,
        dataConfidence: null,
        score: { ...profile.score!, confidence: 0.42 },
      }),
    ).toBe(42);
  });

  it("extracts contributor signals without inventing labels", () => {
    const dims = FIXTURE_CHARACTERS[0]!.profile.score!.dimensions;
    const signals = parseContributorSignals(dims);
    expect(signals.some((s) => s.kind === "positive" && s.label.includes("DPS"))).toBe(true);
    expect(topSignals(signals, "risk", 2)).toHaveLength(2);
  });

  it("maps known equipment slots and leaves others unavailable", () => {
    const slots = mapEquipmentSlots(FIXTURE_CHARACTERS[0]!.profile.equipment);
    const filled = slots.filter((s) => s.filled);
    expect(filled).toHaveLength(2);
    expect(filled.map((s) => s.label)).toEqual(["Trinket 1", "Trinket 2"]);
    expect(slots.find((s) => s.id === "head")?.filled).toBe(false);
  });

  it("marks missing radar dimensions explicitly", () => {
    const rows = dimensionRows([
      {
        dimension: "PERFORMANCE",
        score: 91,
        confidence: 0.8,
        weight: 0.32,
        contributors: null,
      },
    ]);
    expect(rows[0]?.missing).toBe(false);
    expect(rows[1]?.missing).toBe(true);
    expect(rows[1]?.score).toBeNull();
  });
});
