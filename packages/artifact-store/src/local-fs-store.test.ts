import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compressBytes } from "./compression.js";
import { sha256Hex } from "./hash.js";
import { createLocalFsArtifactStore } from "./local-fs-store.js";
import { resolveContentAddressedPath } from "./path-safety.js";
import { ArtifactStoreError } from "./types.js";

async function tempStore(bounds?: { maxUncompressedBytes?: number; maxCompressedBytes?: number }) {
  const root = await mkdtemp(path.join(tmpdir(), "mplus-artifacts-"));
  return createLocalFsArtifactStore(root, {
    bounds: {
      maxUncompressedBytes: bounds?.maxUncompressedBytes ?? 1024 * 1024,
      maxCompressedBytes: bounds?.maxCompressedBytes ?? 1024 * 1024,
    },
  });
}

describe("LocalFsArtifactStore", () => {
  it("deduplicates identical payloads by content hash", async () => {
    const store = await tempStore();
    const payload = Buffer.from(JSON.stringify({ events: [1, 2, 3], note: "shared" }));
    const first = await store.write({ bytes: payload, compression: "GZIP" });
    const second = await store.write({ bytes: payload, compression: "GZIP" });
    expect(first.contentHash).toBe(sha256Hex(payload));
    expect(second.deduplicated).toBe(true);
    expect(second.storageUri).toBe(first.storageUri);
    expect(await store.exists(first.contentHash)).toBe(true);
  });

  it("round-trips GZIP and NONE compression", async () => {
    const store = await tempStore();
    const payload = Buffer.from("compression-round-trip-" + "x".repeat(2000));
    for (const compression of ["GZIP", "NONE"] as const) {
      const written = await store.write({ bytes: payload, compression });
      const read = await store.read(written.storageUri, written.contentHash);
      expect(read.bytes.equals(payload)).toBe(true);
      expect(read.compression).toBe(compression);
      expect(read.contentHash).toBe(written.contentHash);
    }
  });

  it("supports ZSTD when native bindings are available, else fails closed", async () => {
    const store = await tempStore();
    const payload = Buffer.from("zstd-optional-" + "y".repeat(500));
    try {
      const written = await store.write({ bytes: payload, compression: "ZSTD" });
      const read = await store.read(written.storageUri, written.contentHash);
      expect(read.bytes.equals(payload)).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactStoreError);
      expect((error as ArtifactStoreError).code).toBe("ZSTD_UNAVAILABLE");
    }
  });

  it("rejects hash mismatches on read", async () => {
    const store = await tempStore();
    const payload = Buffer.from("honest-bytes");
    const written = await store.write({ bytes: payload, compression: "GZIP" });
    const filePath = resolveContentAddressedPath(store.rootDir, written.contentHash, ".bin.gz");
    await writeFile(filePath, await compressBytes(Buffer.from("tampered-bytes"), "GZIP"));
    await expect(store.read(written.storageUri)).rejects.toMatchObject({
      code: "HASH_MISMATCH",
    } satisfies Partial<ArtifactStoreError>);
  });

  it("rejects oversized uncompressed payloads", async () => {
    const store = await tempStore({ maxUncompressedBytes: 32, maxCompressedBytes: 1024 });
    await expect(
      store.write({ bytes: Buffer.alloc(64, 7), compression: "NONE" }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects path traversal in content-addressed resolution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mplus-artifacts-"));
    await mkdir(root, { recursive: true });
    expect(() =>
      resolveContentAddressedPath(root, "../".repeat(8) + "a".repeat(64), ".bin"),
    ).toThrow(/Invalid SHA-256|PATH_TRAVERSAL|Invalid/);
  });

  it("rejects non-cas URIs", async () => {
    const store = await tempStore();
    await expect(store.read("file:///etc/passwd")).rejects.toMatchObject({
      code: "INVALID_URI",
    });
  });
});
