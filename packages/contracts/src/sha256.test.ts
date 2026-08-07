import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256.js";

describe("sha256Hex", () => {
  it("matches node:crypto for empty and utf8 strings", () => {
    for (const sample of ["", "abc", "refresh-contract|scoringModelKey=default", "✓ unicode"]) {
      const expected = createHash("sha256").update(sample, "utf8").digest("hex");
      expect(sha256Hex(sample)).toBe(expected);
    }
  });

  it("matches node:crypto for raw bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128]);
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(sha256Hex(bytes)).toBe(expected);
  });
});
