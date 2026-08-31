import { describe, expect, it } from "vitest";
import {
  percentileBpsToTopPercent,
  topPercentToPercentileBps,
} from "./admin-relevant-refresh-service.js";

describe("admin relevant refresh percentile helpers", () => {
  it("converts 9000 bps ↔ Top 10%", () => {
    expect(percentileBpsToTopPercent(9000)).toBe(10);
    expect(topPercentToPercentileBps(10)).toBe(9000);
  });

  it("converts 9900 bps ↔ Top 1%", () => {
    expect(percentileBpsToTopPercent(9900)).toBe(1);
    expect(topPercentToPercentileBps(1)).toBe(9900);
  });
});
