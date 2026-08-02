import { gzipSync, gunzipSync } from "node:zlib";
import { decompress as zstdDecompress } from "fzstd";
import type { ArtifactCompression } from "./types.js";
import { ArtifactStoreError } from "./types.js";

type ZstdNative = {
  compress: (buf: Buffer | Uint8Array, level?: number) => Promise<Buffer>;
  decompress: (buf: Buffer | Uint8Array) => Promise<Buffer>;
};

let zstdNativePromise: Promise<ZstdNative | null> | null = null;

async function loadZstdNative(): Promise<ZstdNative | null> {
  if (!zstdNativePromise) {
    // Optional peer: install @mongodb-js/zstd in environments with native bindings.
    const moduleId = "@mongodb-js/zstd";
    zstdNativePromise = import(moduleId)
      .then((mod) => mod as unknown as ZstdNative)
      .catch(() => null);
  }
  return zstdNativePromise;
}

export async function compressBytes(
  bytes: Uint8Array | Buffer,
  compression: ArtifactCompression,
): Promise<Buffer> {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  switch (compression) {
    case "NONE":
      return input;
    case "GZIP":
      return gzipSync(input);
    case "ZSTD": {
      const native = await loadZstdNative();
      if (!native) {
        throw new ArtifactStoreError(
          "ZSTD_UNAVAILABLE",
          "ZSTD compression requires optional dependency @mongodb-js/zstd (native bindings).",
        );
      }
      return Buffer.from(await native.compress(input));
    }
    default: {
      const _exhaustive: never = compression;
      throw new ArtifactStoreError("UNSUPPORTED_COMPRESSION", `Unsupported: ${_exhaustive}`);
    }
  }
}

export async function decompressBytes(
  bytes: Uint8Array | Buffer,
  compression: ArtifactCompression,
): Promise<Buffer> {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  switch (compression) {
    case "NONE":
      return input;
    case "GZIP":
      return gunzipSync(input);
    case "ZSTD": {
      const native = await loadZstdNative();
      if (native) {
        return Buffer.from(await native.decompress(input));
      }
      // Pure-JS fallback for reading blobs produced elsewhere.
      return Buffer.from(zstdDecompress(input));
    }
    default: {
      const _exhaustive: never = compression;
      throw new ArtifactStoreError("UNSUPPORTED_COMPRESSION", `Unsupported: ${_exhaustive}`);
    }
  }
}
