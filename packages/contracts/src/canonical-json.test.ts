import { describe, expect, it } from "vitest";
import { hashCanonicalJson, stableStringify } from "./canonical-json.js";

describe("canonical-json", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const a = { z: 1, nested: { b: 2, a: 1 }, list: [3, 1, 2] };
    const b = { list: [3, 1, 2], nested: { a: 1, b: 2 }, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe(
      '{"list":[3,1,2],"nested":{"a":1,"b":2},"z":1}',
    );
  });

  it("omits undefined object values and distinguishes null", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify({ a: null })).toBe('{"a":null}');
    expect(hashCanonicalJson({ a: null })).not.toBe(hashCanonicalJson({ a: 1 }));
  });

  it("does not mutate the input", () => {
    const input = { z: { y: 1, x: 2 }, a: [1, 2] };
    const before = structuredClone(input);
    void hashCanonicalJson(input);
    expect(input).toEqual(before);
  });
});
