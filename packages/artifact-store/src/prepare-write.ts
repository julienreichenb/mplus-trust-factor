import { compressBytes } from "./compression.js";
import { sha256Hex } from "./hash.js";
import {
  ArtifactStoreError,
  DEFAULT_ARTIFACT_BOUNDS,
  type ArtifactCompression,
  type ArtifactStoreBounds,
  type ArtifactStoreWriteInput,
  type ArtifactStoreWriteResult,
} from "./types.js";

export interface PreparedArtifactWrite {
  contentHash: string;
  compression: ArtifactCompression;
  compressed: Buffer;
  uncompressed: Buffer;
  uncompressedSizeBytes: number;
  compressedSizeBytes: number;
}

/** Hash, bound-check and compress artifact bytes before durable storage. */
export async function prepareArtifactWrite(
  input: ArtifactStoreWriteInput,
  options?: {
    bounds?: ArtifactStoreBounds;
    defaultCompression?: ArtifactCompression;
  },
): Promise<PreparedArtifactWrite> {
  const bounds = options?.bounds ?? DEFAULT_ARTIFACT_BOUNDS;
  const defaultCompression = options?.defaultCompression ?? "GZIP";
  const uncompressed = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
  if (uncompressed.byteLength > bounds.maxUncompressedBytes) {
    throw new ArtifactStoreError(
      "PAYLOAD_TOO_LARGE",
      `Uncompressed payload ${uncompressed.byteLength} exceeds limit ${bounds.maxUncompressedBytes}`,
    );
  }

  const contentHash = sha256Hex(uncompressed);
  const compression = input.compression ?? defaultCompression;
  const compressed = await compressBytes(uncompressed, compression);
  if (compressed.byteLength > bounds.maxCompressedBytes) {
    throw new ArtifactStoreError(
      "PAYLOAD_TOO_LARGE",
      `Compressed payload ${compressed.byteLength} exceeds limit ${bounds.maxCompressedBytes}`,
    );
  }

  return {
    contentHash,
    compression,
    compressed,
    uncompressed,
    uncompressedSizeBytes: uncompressed.byteLength,
    compressedSizeBytes: compressed.byteLength,
  };
}

export function preparedWriteResult(
  prepared: PreparedArtifactWrite,
  storageUri: string,
  deduplicated: boolean,
): ArtifactStoreWriteResult {
  return {
    contentHash: prepared.contentHash,
    storageUri,
    compression: prepared.compression,
    sizeBytes: prepared.compressedSizeBytes,
    uncompressedSizeBytes: prepared.uncompressedSizeBytes,
    deduplicated,
  };
}
