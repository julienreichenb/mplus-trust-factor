import { describe, expect, it } from "vitest";
import { resolveParsePercentileColor } from "./parsePercentileColor";

describe("resolveParsePercentileColor", () => {
  it("returns neutral for null, undefined, NaN and non-finite values", () => {
    expect(resolveParsePercentileColor(null).tier).toBe("neutral");
    expect(resolveParsePercentileColor(undefined).tier).toBe("neutral");
    expect(resolveParsePercentileColor(Number.NaN).tier).toBe("neutral");
    expect(resolveParsePercentileColor(Number.POSITIVE_INFINITY).tier).toBe("neutral");
  });

  it.each([
    [0, "grey"],
    [24, "grey"],
    [24.9, "grey"],
    [25, "green"],
    [49, "green"],
    [49.9, "green"],
    [50, "blue"],
    [74, "blue"],
    [74.9, "blue"],
    [75, "purple"],
    [94, "purple"],
    [94.9, "purple"],
    [95, "orange"],
    [98, "orange"],
    [98.9, "orange"],
    [99, "pink"],
    [99.5, "pink"],
    [100, "gold"],
  ] as const)("maps %s to %s", (value, tier) => {
    const result = resolveParsePercentileColor(value);
    expect(result.tier).toBe(tier);
    expect(result.className).toBe(`parse-pct--${tier}`);
    expect(result.cssVar).toMatch(/^var\(--/);
  });

  it("clamps out-of-range values without throwing", () => {
    expect(resolveParsePercentileColor(-10).tier).toBe("grey");
    expect(resolveParsePercentileColor(150).tier).toBe("gold");
  });
});
