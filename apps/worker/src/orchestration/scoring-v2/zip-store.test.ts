import { describe, expect, it } from "vitest";
import { buildStoreZip, sha256Hex } from "./zip-store.js";

describe("buildStoreZip", () => {
  it("is deterministic for identical input (same bytes, same hash)", () => {
    const files = [
      { name: "a.json", content: '{"a":1}' },
      { name: "b.md", content: "# hello\n" },
    ];
    const first = buildStoreZip(files);
    const second = buildStoreZip(files);
    expect(first.equals(second)).toBe(true);
    expect(sha256Hex(first)).toBe(sha256Hex(second));
  });

  it("produces a different archive when entry order changes", () => {
    const a = buildStoreZip([
      { name: "a.json", content: "1" },
      { name: "b.json", content: "2" },
    ]);
    const b = buildStoreZip([
      { name: "b.json", content: "2" },
      { name: "a.json", content: "1" },
    ]);
    expect(a.equals(b)).toBe(false);
  });

  it("produces a different archive when content changes", () => {
    const a = buildStoreZip([{ name: "a.json", content: "1" }]);
    const b = buildStoreZip([{ name: "a.json", content: "2" }]);
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });

  it("round-trips readable local file headers (magic numbers + names)", () => {
    const zip = buildStoreZip([{ name: "only.txt", content: "hello world" }]);
    // Local file header signature.
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const nameLength = zip.readUInt16LE(26);
    const name = zip.subarray(30, 30 + nameLength).toString("utf8");
    expect(name).toBe("only.txt");
    const data = zip.subarray(30 + nameLength, 30 + nameLength + "hello world".length).toString("utf8");
    expect(data).toBe("hello world");
  });

  it("supports Buffer content in addition to strings", () => {
    const zip = buildStoreZip([{ name: "bin.dat", content: Buffer.from([1, 2, 3, 4]) }]);
    expect(zip.length).toBeGreaterThan(0);
  });

  it("handles an empty file list without throwing", () => {
    const zip = buildStoreZip([]);
    // End-of-central-directory signature only.
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
  });
});

describe("sha256Hex", () => {
  it("matches a known SHA-256 digest", () => {
    expect(sha256Hex(Buffer.from(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
