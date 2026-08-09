import { describe, expect, it } from "vitest";
import { rankingEvidenceHasUsableParse } from "./ranking-hydrate.js";

describe("rankingEvidenceHasUsableParse", () => {
  it("accepts bracket / rank / amount percentiles", () => {
    expect(
      rankingEvidenceHasUsableParse({
        bracketPercent: 95,
        rankPercent: null,
        amountPercent: null,
      }),
    ).toBe(true);
    expect(
      rankingEvidenceHasUsableParse({
        bracketPercent: null,
        rankPercent: 88.5,
        amountPercent: null,
      }),
    ).toBe(true);
    expect(
      rankingEvidenceHasUsableParse({
        bracketPercent: null,
        rankPercent: null,
        amountPercent: 70,
      }),
    ).toBe(true);
  });

  it("rejects ABSENT / empty percentile poison rows", () => {
    expect(
      rankingEvidenceHasUsableParse({
        bracketPercent: null,
        rankPercent: null,
        amountPercent: null,
      }),
    ).toBe(false);
    expect(
      rankingEvidenceHasUsableParse({
        bracketPercent: Number.NaN,
        rankPercent: null,
        amountPercent: null,
      }),
    ).toBe(false);
  });
});
