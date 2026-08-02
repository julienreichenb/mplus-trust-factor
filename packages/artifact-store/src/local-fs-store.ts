import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { compressBytes, decompressBytes } from "./compression.js";
import { sha256Hex } from "./hash.js";
import {
  compressionFromExtension,
  extensionForCompression,
  parseCasUri,
  resolveContentAddressedPath,
} from "./path-safety.js";
import {
  ArtifactStoreError,
  DEFAULT_ARTIFACT_BOUNDS,
  type ArtifactCompression,
  type ArtifactStore,
  type ArtifactStoreBounds,
  type ArtifactStoreReadResult,
  type ArtifactStoreWriteInput,
  type ArtifactStoreWriteResult,
} from "./types.js";

export interface LocalFsArtifactStoreOptions {
  rootDir: string;
  bounds?: ArtifactStoreBounds;
  defaultCompression?: ArtifactCompression;
}

/**
 * Local filesystem content-addressed artifact store (test + MVP).
 * URI scheme: `cas://sha256/<hash>.bin[.gz|.zst]`
 */
export class LocalFsArtifactStore implements ArtifactStore {
  readonly scheme = "cas";
  readonly rootDir: string;
  private readonly bounds: ArtifactStoreBounds;
  private readonly defaultCompression: ArtifactCompression;

  constructor(options: LocalFsArtifactStoreOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.bounds = options.bounds ?? DEFAULT_ARTIFACT_BOUNDS;
    this.defaultCompression = options.defaultCompression ?? "GZIP";
  }

  uriForHash(contentHash: string, compression: ArtifactCompression): string {
    const ext = extensionForCompression(compression);
    return `cas://sha256/${contentHash.toLowerCase()}${ext}`;
  }

  async exists(contentHash: string): Promise<boolean> {
    for (const compression of ["GZIP", "ZSTD", "NONE"] as const) {
      const filePath = resolveContentAddressedPath(
        this.rootDir,
        contentHash,
        extensionForCompression(compression),
      );
      try {
        await stat(filePath);
        return true;
      } catch {
        // try next codec
      }
    }
    return false;
  }

  async write(input: ArtifactStoreWriteInput): Promise<ArtifactStoreWriteResult> {
    const uncompressed = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
    if (uncompressed.byteLength > this.bounds.maxUncompressedBytes) {
      throw new ArtifactStoreError(
        "PAYLOAD_TOO_LARGE",
        `Uncompressed payload ${uncompressed.byteLength} exceeds limit ${this.bounds.maxUncompressedBytes}`,
      );
    }

    const contentHash = sha256Hex(uncompressed);
    const compression = input.compression ?? this.defaultCompression;
    const storageUri = this.uriForHash(contentHash, compression);
    const targetPath = resolveContentAddressedPath(
      this.rootDir,
      contentHash,
      extensionForCompression(compression),
    );

    try {
      await stat(targetPath);
      return {
        contentHash,
        storageUri,
        compression,
        sizeBytes: (await stat(targetPath)).size,
        uncompressedSizeBytes: uncompressed.byteLength,
        deduplicated: true,
      };
    } catch {
      // not present — continue
    }

    const compressed = await compressBytes(uncompressed, compression);
    if (compressed.byteLength > this.bounds.maxCompressedBytes) {
      throw new ArtifactStoreError(
        "PAYLOAD_TOO_LARGE",
        `Compressed payload ${compressed.byteLength} exceeds limit ${this.bounds.maxCompressedBytes}`,
      );
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    const tmpPath = path.join(
      path.dirname(targetPath),
      `.${contentHash}.${randomBytes(8).toString("hex")}.tmp`,
    );

    try {
      // Exclusive create avoids clobbering a concurrent writer mid-flight.
      const handle = await open(tmpPath, "wx");
      try {
        await handle.writeFile(compressed);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(tmpPath, targetPath);
      } catch (error) {
        // Another writer may have won the race — treat as dedupe if target exists.
        try {
          await stat(targetPath);
          await unlink(tmpPath).catch(() => undefined);
          return {
            contentHash,
            storageUri,
            compression,
            sizeBytes: (await stat(targetPath)).size,
            uncompressedSizeBytes: uncompressed.byteLength,
            deduplicated: true,
          };
        } catch {
          throw error;
        }
      }
    } catch (error) {
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }

    return {
      contentHash,
      storageUri,
      compression,
      sizeBytes: compressed.byteLength,
      uncompressedSizeBytes: uncompressed.byteLength,
      deduplicated: false,
    };
  }

  async read(storageUri: string, expectedContentHash?: string): Promise<ArtifactStoreReadResult> {
    const { contentHash, extension } = parseCasUri(storageUri);
    if (expectedContentHash && expectedContentHash.toLowerCase() !== contentHash) {
      throw new ArtifactStoreError(
        "HASH_MISMATCH",
        `URI hash ${contentHash} does not match expected ${expectedContentHash}`,
      );
    }

    const compression = compressionFromExtension(extension);
    const filePath = resolveContentAddressedPath(this.rootDir, contentHash, extension);
    let stored: Buffer;
    try {
      stored = await readFile(filePath);
    } catch {
      throw new ArtifactStoreError("NOT_FOUND", `Artifact missing at ${storageUri}`);
    }

    const bytes = await decompressBytes(stored, compression);
    const actualHash = sha256Hex(bytes);
    if (actualHash !== contentHash) {
      throw new ArtifactStoreError(
        "HASH_MISMATCH",
        `Stored artifact hash mismatch: expected ${contentHash}, got ${actualHash}`,
      );
    }

    return {
      contentHash,
      storageUri,
      compression,
      sizeBytes: stored.byteLength,
      uncompressedSizeBytes: bytes.byteLength,
      bytes,
    };
  }

  async delete(storageUri: string): Promise<boolean> {
    const { contentHash, extension } = parseCasUri(storageUri);
    const filePath = resolveContentAddressedPath(this.rootDir, contentHash, extension);
    try {
      await rm(filePath, { force: false });
      return true;
    } catch {
      return false;
    }
  }
}

/** Convenience factory used by workers/tests. */
export function createLocalFsArtifactStore(
  rootDir: string,
  options?: Omit<LocalFsArtifactStoreOptions, "rootDir">,
): LocalFsArtifactStore {
  return new LocalFsArtifactStore({ rootDir, ...options });
}

/** Write helper kept for tests that need a non-atomic overwrite of a known path. */
export async function writeFileAtomic(filePath: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(tmpPath, data);
  await rename(tmpPath, filePath);
}
