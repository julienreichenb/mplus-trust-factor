import { describe, expect, it } from "vitest";
import { validateConcurrencyValue } from "./scoring-v2-runtime-settings.js";

describe("concurrency validation", () => {
  it("accepts values in 1..8", () => {
    expect(validateConcurrencyValue(1)).toBe(1);
    expect(validateConcurrencyValue(8)).toBe(8);
    expect(validateConcurrencyValue(4)).toBe(4);
  });

  it("rejects out of range", () => {
    expect(() => validateConcurrencyValue(0)).toThrow();
    expect(() => validateConcurrencyValue(9)).toThrow();
    expect(() => validateConcurrencyValue(3.5)).toThrow();
  });
});
