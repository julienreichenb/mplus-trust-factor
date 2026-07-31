import { describe, expect, it } from "vitest";
import { parseOptionalNumber } from "./parseOptionalNumber";

describe("parseOptionalNumber", () => {
  it("maps empty inputs to null", () => {
    expect(parseOptionalNumber("")).toEqual({ ok: true, value: null });
    expect(parseOptionalNumber("   ")).toEqual({ ok: true, value: null });
    expect(parseOptionalNumber(null)).toEqual({ ok: true, value: null });
    expect(parseOptionalNumber(undefined)).toEqual({ ok: true, value: null });
  });

  it("accepts finite numbers and numeric strings", () => {
    expect(parseOptionalNumber(1)).toEqual({ ok: true, value: 1 });
    expect(parseOptionalNumber("42.5")).toEqual({ ok: true, value: 42.5 });
  });

  it("rejects non-finite values", () => {
    expect(parseOptionalNumber(Number.NaN).ok).toBe(false);
    expect(parseOptionalNumber(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(parseOptionalNumber("nope").ok).toBe(false);
  });
});
