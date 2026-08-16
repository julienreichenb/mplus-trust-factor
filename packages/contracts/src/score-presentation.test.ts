import { describe, expect, it } from "vitest";
import { presentQualitativeScoreLabel } from "./score-presentation.js";

describe("presentQualitativeScoreLabel", () => {
  it("maps 0–100 values to four qualitative labels", () => {
    expect(presentQualitativeScoreLabel(90)).toBe("VERY GOOD");
    expect(presentQualitativeScoreLabel(75)).toBe("VERY GOOD");
    expect(presentQualitativeScoreLabel(74.9)).toBe("GOOD");
    expect(presentQualitativeScoreLabel(50)).toBe("GOOD");
    expect(presentQualitativeScoreLabel(49.9)).toBe("BAD");
    expect(presentQualitativeScoreLabel(25)).toBe("BAD");
    expect(presentQualitativeScoreLabel(24.9)).toBe("VERY BAD");
    expect(presentQualitativeScoreLabel(0)).toBe("VERY BAD");
  });

  it("does not invent a label when value is missing", () => {
    expect(presentQualitativeScoreLabel(null)).toBeNull();
    expect(presentQualitativeScoreLabel(undefined)).toBeNull();
    expect(presentQualitativeScoreLabel(Number.NaN)).toBeNull();
  });
});
