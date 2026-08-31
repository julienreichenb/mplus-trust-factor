import { describe, expect, it } from "vitest";
import {
  formatTopPercentLabel,
  percentileBpsToTopPercent,
  topPercentToPercentileBps,
} from "./relevantPopulationPercentile";

describe("relevant population percentile conversion", () => {
  it("maps 9000 bps ↔ Top 10%", () => {
    expect(percentileBpsToTopPercent(9000)).toBe(10);
    expect(topPercentToPercentileBps(10)).toBe(9000);
    expect(formatTopPercentLabel(9000)).toBe("Top 10%");
  });

  it("maps 9900 bps ↔ Top 1%", () => {
    expect(percentileBpsToTopPercent(9900)).toBe(1);
    expect(topPercentToPercentileBps(1)).toBe(9900);
    expect(formatTopPercentLabel(9900)).toBe("Top 1%");
  });

  it("maps 9500 bps ↔ Top 5%", () => {
    expect(percentileBpsToTopPercent(9500)).toBe(5);
    expect(topPercentToPercentileBps(5)).toBe(9500);
  });
});
