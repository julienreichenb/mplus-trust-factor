import { describe, expect, it } from "vitest";
import {
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

  it("maps live available contributors into positive/risk signals", () => {
    const signals = parseContributorSignals([
      {
        dimension: "PERFORMANCE",
        score: 70,
        confidence: 0.8,
        weight: 0.32,
        state: "AVAILABLE",
        reason: null,
        contributors: {
          available: [
            { metricKey: "performance.peak", normalizedValue: 80 },
            { metricKey: "performance.consistency", normalizedValue: 30 },
          ],
          missing: [{ metricKey: "performance.coverage" }],
        },
      },
    ]);
    expect(signals.some((s) => s.kind === "positive" && s.label.includes("Peak"))).toBe(true);
    expect(signals.some((s) => s.kind === "risk" && s.label.includes("Consistency"))).toBe(true);
    // Missing metrics are data gaps — not weaknesses.
    expect(signals.some((s) => s.label.includes("Missing"))).toBe(false);
  });

  it("excludes UNAVAILABLE dimensions from weaknesses (null is not a zero score)", () => {
    const signals = parseContributorSignals([
      {
        dimension: "UTILITY",
        score: null,
        confidence: 0,
        weight: 0.25,
        state: "UNAVAILABLE",
        reason: "NO_OBSERVATIONS",
        contributors: {
          available: [],
          missing: [
            { metricKey: "utility.interrupts" },
            { metricKey: "utility.crowd_control" },
            { metricKey: "utility.dispels" },
          ],
        },
      },
      {
        dimension: "PERFORMANCE",
        score: 0,
        confidence: 0.9,
        weight: 0.35,
        state: "AVAILABLE",
        reason: null,
        contributors: {
          available: [{ metricKey: "performance.peak", normalizedValue: 0 }],
          missing: [],
        },
      },
    ]);
    expect(signals.every((s) => s.dimensionKey !== "UTILITY")).toBe(true);
    expect(signals.some((s) => s.label.includes("Missing"))).toBe(false);
    // Genuine scored zero remains a risk signal, distinct from unavailable.
    expect(signals.some((s) => s.kind === "risk" && s.dimensionKey === "PERFORMANCE")).toBe(true);
  });
});
