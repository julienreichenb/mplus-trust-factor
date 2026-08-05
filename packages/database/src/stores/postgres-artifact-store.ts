import type { Prisma, PrismaClient } from "@prisma/client";
import {
  decompressBytes,
  prepareArtifactWrite,
  preparedWriteResult,
  sha256Hex,
  ArtifactStoreError,
  DEFAULT_ARTIFACT_BOUNDS,
  type ArtifactCompression,
  type ArtifactStore,
  type ArtifactStoreBounds,
  type ArtifactStoreReadResult,
  type ArtifactStoreWriteInput,
  type ArtifactStoreWriteResult,
  type PreparedArtifactWrite,
} from "@mplus/artifact-store";

const PG_SCHEME = "pg";

function parsePgUri(storageUri: string): string | null {
  const match = /^pg:\/\/sha256\/([a-f0-9]{64})$/i.exec(storageUri.trim());
  return match ? match[1]!.toLowerCase() : null;
}

export interface PostgresArtifactStoreOptions {
  bounds?: ArtifactStoreBounds;
  defaultCompression?: ArtifactCompression;
}

/**
 * PostgreSQL bytea content-addressed artifact store.
 * URI scheme: `pg://sha256/<hash>`
 */
export class PostgresArtifactStore implements ArtifactStore {
  readonly scheme = PG_SCHEME;
  private readonly bounds: ArtifactStoreBounds;
  private readonly defaultCompression: ArtifactCompression;

  constructor(
    private readonly prisma: PrismaClient,
    options?: PostgresArtifactStoreOptions,
  ) {
    this.bounds = options?.bounds ?? DEFAULT_ARTIFACT_BOUNDS;
    this.defaultCompression = options?.defaultCompression ?? "GZIP";
  }

  uriForHash(contentHash: string, _compression: ArtifactCompression): string {
    return `pg://sha256/${contentHash.toLowerCase()}`;
  }

  async exists(contentHash: string): Promise<boolean> {
    const row = await this.prisma.rawArtifactPayload.findUnique({
      where: { contentHash: contentHash.toLowerCase() },
      select: { contentHash: true },
    });
    return row != null;
  }

  async prepareWrite(input: ArtifactStoreWriteInput): Promise<PreparedArtifactWrite> {
    return prepareArtifactWrite(input, {
      bounds: this.bounds,
      defaultCompression: this.defaultCompression,
    });
  }

  /**
   * Insert payload bytes inside an open transaction (idempotent by content hash).
   */
  async writePayloadInTransaction(
    tx: Prisma.TransactionClient,
    prepared: PreparedArtifactWrite,
  ): Promise<{ deduplicated: boolean }> {
    const existing = await tx.rawArtifactPayload.findUnique({
      where: { contentHash: prepared.contentHash },
    });
    if (existing) {
      if (
        existing.compression !== prepared.compression ||
        Number(existing.compressedSizeBytes) !== prepared.compressedSizeBytes ||
        Number(existing.uncompressedSizeBytes) !== prepared.uncompressedSizeBytes ||
        !Buffer.from(existing.payload).equals(prepared.compressed)
      ) {
        throw new ArtifactStoreError(
          "HASH_MISMATCH",
          `Payload content conflict for contentHash=${prepared.contentHash}`,
        );
      }
      return { deduplicated: true };
    }

    await tx.rawArtifactPayload.create({
      data: {
        contentHash: prepared.contentHash,
        compression: prepared.compression,
        payload: new Uint8Array(prepared.compressed),
        compressedSizeBytes: BigInt(prepared.compressedSizeBytes),
        uncompressedSizeBytes: BigInt(prepared.uncompressedSizeBytes),
      },
    });
    return { deduplicated: false };
  }

  async write(input: ArtifactStoreWriteInput): Promise<ArtifactStoreWriteResult> {
    const prepared = await this.prepareWrite(input);
    const storageUri = this.uriForHash(prepared.contentHash, prepared.compression);
    const { deduplicated } = await this.prisma.$transaction((tx) =>
      this.writePayloadInTransaction(tx, prepared),
    );
    return preparedWriteResult(prepared, storageUri, deduplicated);
  }

  async readByContentHash(contentHash: string): Promise<ArtifactStoreReadResult> {
    const hash = contentHash.toLowerCase();
    const row = await this.prisma.rawArtifactPayload.findUnique({
      where: { contentHash: hash },
    });
    if (!row) {
      throw new ArtifactStoreError(
        "NOT_FOUND",
        `PostgreSQL artifact payload missing for contentHash=${hash}`,
      );
    }
    return this.readPayloadRow(hash, row.compression, Buffer.from(row.payload), {
      compressedSizeBytes: Number(row.compressedSizeBytes),
      uncompressedSizeBytes: Number(row.uncompressedSizeBytes),
    });
  }

  async read(storageUri: string, expectedContentHash?: string): Promise<ArtifactStoreReadResult> {
    const fromUri = parsePgUri(storageUri);
    const hash = (expectedContentHash ?? fromUri)?.toLowerCase();
    if (!hash) {
      throw new ArtifactStoreError("INVALID_URI", `Unsupported PostgreSQL storage URI: ${storageUri}`);
    }
    if (fromUri && expectedContentHash && fromUri !== expectedContentHash.toLowerCase()) {
      throw new ArtifactStoreError(
        "HASH_MISMATCH",
        `URI hash ${fromUri} does not match expected ${expectedContentHash}`,
      );
    }
    return this.readByContentHash(hash);
  }

  async delete(storageUri: string): Promise<boolean> {
    const hash = parsePgUri(storageUri);
    if (!hash) return false;
    try {
      await this.prisma.rawArtifactPayload.delete({ where: { contentHash: hash } });
      return true;
    } catch {
      return false;
    }
  }

  private async readPayloadRow(
    contentHash: string,
    compression: ArtifactCompression,
    stored: Buffer,
    sizes: { compressedSizeBytes: number; uncompressedSizeBytes: number },
  ): Promise<ArtifactStoreReadResult> {
    if (stored.byteLength > this.bounds.maxCompressedBytes) {
      throw new ArtifactStoreError(
        "PAYLOAD_TOO_LARGE",
        `Stored compressed payload ${stored.byteLength} exceeds limit ${this.bounds.maxCompressedBytes}`,
      );
    }

    let bytes: Buffer;
    try {
      bytes = await decompressBytes(stored, compression);
    } catch (error) {
      throw new ArtifactStoreError(
        "DECOMPRESSION_FAILED",
        error instanceof Error ? error.message : "decompression_failed",
      );
    }

    if (bytes.byteLength > this.bounds.maxUncompressedBytes) {
      throw new ArtifactStoreError(
        "PAYLOAD_TOO_LARGE",
        `Decompressed payload ${bytes.byteLength} exceeds limit ${this.bounds.maxUncompressedBytes}`,
      );
    }

    const actualHash = sha256Hex(bytes);
    if (actualHash !== contentHash) {
      throw new ArtifactStoreError(
        "HASH_MISMATCH",
        `Stored artifact hash mismatch: expected ${contentHash}, got ${actualHash}`,
      );
    }

    return {
      contentHash,
      storageUri: this.uriForHash(contentHash, compression),
      compression,
      sizeBytes: sizes.compressedSizeBytes,
      uncompressedSizeBytes: bytes.byteLength,
      bytes,
    };
  }
}

export function createPostgresArtifactStore(
  prisma: PrismaClient,
  options?: PostgresArtifactStoreOptions,
): PostgresArtifactStore {
  return new PostgresArtifactStore(prisma, options);
}

export function isPostgresStorageUri(storageUri: string): boolean {
  return storageUri.startsWith(`${PG_SCHEME}://`);
}

export function isCasStorageUri(storageUri: string): boolean {
  return storageUri.startsWith("cas://");
}
