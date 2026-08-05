import { createHash } from "node:crypto";
import type { ArtifactCompression, Prisma, PrismaClient, Provider } from "@prisma/client";
import type { ArtifactStore, ArtifactStoreWriteResult } from "@mplus/artifact-store";
import { ArtifactStoreError } from "@mplus/artifact-store";
import {
  createPostgresArtifactStore,
  isCasStorageUri,
  isPostgresStorageUri,
  PostgresArtifactStore,
} from "../stores/postgres-artifact-store.js";

export type ArtifactOwnerType =
  | "ExternalPayload"
  | "EvidenceDataset"
  | "WclReportRevision"
  | "AddonExport"
  | "CalibrationFrozenExport"
  | "AdminDiagnostics"
  | "CapabilityEvidencePackage"
  | "ParticipantScoringDigest";

export interface PersistArtifactInput {
  provider: Provider;
  bytes: Uint8Array | Buffer;
  compression?: "NONE" | "GZIP" | "ZSTD";
  artifactClass?: string;
  retentionUntil?: Date | null;
  owner?: { ownerType: ArtifactOwnerType; ownerId: string };
}

export type ArtifactPayloadReadability =
  | "DB_PAYLOAD_READABLE"
  | "LEGACY_EXTERNAL_ONLY"
  | "PAYLOAD_MISSING"
  | "DIGEST_MISMATCH";

/** Typed error when RawArtifact row is missing for a content hash. */
export class ArtifactMissingError extends Error {
  readonly code = "ARTIFACT_MISSING" as const;
  readonly contentHash: string;

  constructor(contentHash: string) {
    super(`RawArtifact not found for contentHash=${contentHash}`);
    this.name = "ArtifactMissingError";
    this.contentHash = contentHash;
  }
}

/** Typed error when stored bytes do not match the expected content hash. */
export class ArtifactDigestMismatchError extends Error {
  readonly code = "ARTIFACT_DIGEST_MISMATCH" as const;
  readonly contentHash: string;
  readonly actualHash: string;

  constructor(contentHash: string, actualHash: string) {
    super(
      `Artifact digest mismatch for contentHash=${contentHash}: actual=${actualHash}`,
    );
    this.name = "ArtifactDigestMismatchError";
    this.contentHash = contentHash;
    this.actualHash = actualHash;
  }
}

/** PostgreSQL payload row is absent for a metadata row. */
export class ArtifactPayloadMissingError extends Error {
  readonly code = "ARTIFACT_PAYLOAD_MISSING" as const;
  readonly artifactId: string;
  readonly contentHash: string;

  constructor(artifactId: string, contentHash: string) {
    super(
      `Artifact payload missing in PostgreSQL for artifactId=${artifactId} contentHash=${contentHash}`,
    );
    this.name = "ArtifactPayloadMissingError";
    this.artifactId = artifactId;
    this.contentHash = contentHash;
  }
}

/** Legacy cas:// artifact with no PostgreSQL payload and no readable external bytes. */
export class ArtifactLegacyExternalPayloadMissingError extends Error {
  readonly code = "LEGACY_EXTERNAL_PAYLOAD_MISSING" as const;
  readonly artifactId: string;
  readonly storageUri: string;

  constructor(artifactId: string, storageUri: string) {
    super(
      `Legacy external artifact payload missing for artifactId=${artifactId} storageUri=${storageUri}`,
    );
    this.name = "ArtifactLegacyExternalPayloadMissingError";
    this.artifactId = artifactId;
    this.storageUri = storageUri;
  }
}

export interface ArtifactRepositoryOptions {
  /** Optional filesystem store for legacy cas:// reads only (never used for new writes). */
  legacyFsStore?: ArtifactStore;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class ArtifactRepository {
  private readonly pgStore: PostgresArtifactStore | null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly store: ArtifactStore,
    private readonly options: ArtifactRepositoryOptions = {},
  ) {
    this.pgStore =
      store instanceof PostgresArtifactStore ? store : createPostgresArtifactStore(prisma);
  }

  private get postgresStore(): PostgresArtifactStore {
    return this.pgStore!;
  }

  /**
   * Content-addressed write: store bytes in PostgreSQL, upsert RawArtifact by contentHash,
   * optionally register an owner reference (orphan prevention).
   */
  async persist(input: PersistArtifactInput): Promise<{
    artifactId: string;
    write: ArtifactStoreWriteResult;
  }> {
    const pgStore = this.pgStore;
    if (!pgStore) {
      throw new Error("PostgreSQL artifact store is required for persist()");
    }
    const prepared = await pgStore.prepareWrite({
      bytes: input.bytes,
      compression: input.compression,
    });
    const storageUri = pgStore.uriForHash(prepared.contentHash, prepared.compression);

    const artifact = await this.prisma.$transaction(async (tx) => {
      const { deduplicated } = await pgStore.writePayloadInTransaction(tx, prepared);

      const row = await tx.rawArtifact.upsert({
        where: { contentHash: prepared.contentHash },
        create: {
          provider: input.provider,
          storageUri,
          compression: prepared.compression as ArtifactCompression,
          contentHash: prepared.contentHash,
          sizeBytes: BigInt(prepared.compressedSizeBytes),
          uncompressedSizeBytes: BigInt(prepared.uncompressedSizeBytes),
          artifactClass: input.artifactClass ?? null,
          refCount: 0,
          retentionUntil: input.retentionUntil ?? null,
        },
        update: {
          storageUri,
          compression: prepared.compression as ArtifactCompression,
          sizeBytes: BigInt(prepared.compressedSizeBytes),
          uncompressedSizeBytes: BigInt(prepared.uncompressedSizeBytes),
          ...(input.retentionUntil ? { retentionUntil: input.retentionUntil } : {}),
          ...(input.artifactClass ? { artifactClass: input.artifactClass } : {}),
        },
      });

      if (input.owner) {
        const existing = await tx.artifactReference.findUnique({
          where: {
            ownerType_ownerId_artifactId: {
              ownerType: input.owner.ownerType,
              ownerId: input.owner.ownerId,
              artifactId: row.id,
            },
          },
        });
        if (!existing) {
          await tx.artifactReference.create({
            data: {
              artifactId: row.id,
              ownerType: input.owner.ownerType,
              ownerId: input.owner.ownerId,
            },
          });
          await tx.rawArtifact.update({
            where: { id: row.id },
            data: { refCount: { increment: 1 } },
          });
        }
      }

      return { row, deduplicated };
    });

    return {
      artifactId: artifact.row.id,
      write: {
        contentHash: prepared.contentHash,
        storageUri,
        compression: prepared.compression,
        sizeBytes: prepared.compressedSizeBytes,
        uncompressedSizeBytes: prepared.uncompressedSizeBytes,
        deduplicated: artifact.deduplicated,
      },
    };
  }

  async readVerified(artifactId: string): Promise<Buffer> {
    const row = await this.prisma.rawArtifact.findUniqueOrThrow({
      where: { id: artifactId },
    });
    return this.readVerifiedRow(row);
  }

  /**
   * Bounded RawArtifact metadata lookup: resolve persisted `storageUri` values
   * for the given artifact ids (for example `pg://` vs legacy `cas://`).
   *
   * Reads metadata only — does not open payload bytes.
   */
  async getStorageUris(artifactIds: readonly string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(artifactIds.filter((id) => id.length > 0))];
    if (uniqueIds.length === 0) return new Map();
    const rows = await this.prisma.rawArtifact.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, storageUri: true },
    });
    return new Map(rows.map((row) => [row.id, row.storageUri]));
  }

  /**
   * Lookup RawArtifact by contentHash, read bytes, and verify digest.
   */
  async readVerifiedByContentHash(contentHash: string): Promise<Buffer> {
    const hash = contentHash.trim().toLowerCase();
    const row = await this.prisma.rawArtifact.findUnique({
      where: { contentHash: hash },
    });
    if (!row) {
      throw new ArtifactMissingError(hash);
    }
    return this.readVerifiedRow(row);
  }

  /**
   * Bounded payload readability probe for evidence audit (no WCL refetch).
   */
  async verifyPayloadReadability(artifactId: string): Promise<ArtifactPayloadReadability> {
    const row = await this.prisma.rawArtifact.findUnique({
      where: { id: artifactId },
      select: {
        id: true,
        contentHash: true,
        storageUri: true,
        compression: true,
      },
    });
    if (!row) return "PAYLOAD_MISSING";

    const payload = await this.prisma.rawArtifactPayload.findUnique({
      where: { contentHash: row.contentHash },
      select: { contentHash: true },
    });
    if (!payload) {
      if (isCasStorageUri(row.storageUri)) return "LEGACY_EXTERNAL_ONLY";
      return "PAYLOAD_MISSING";
    }

    try {
      await this.readVerifiedRow(row);
      return "DB_PAYLOAD_READABLE";
    } catch (error) {
      if (error instanceof ArtifactDigestMismatchError) return "DIGEST_MISMATCH";
      if (error instanceof ArtifactStoreError && error.code === "HASH_MISMATCH") {
        return "DIGEST_MISMATCH";
      }
      if (
        error instanceof ArtifactStoreError &&
        (error.code === "DECOMPRESSION_FAILED" || error.code === "NOT_FOUND")
      ) {
        return "PAYLOAD_MISSING";
      }
      if (error instanceof ArtifactPayloadMissingError) return "PAYLOAD_MISSING";
      if (error instanceof ArtifactLegacyExternalPayloadMissingError) {
        return "LEGACY_EXTERNAL_ONLY";
      }
      return "PAYLOAD_MISSING";
    }
  }

  /**
   * Release an owner reference. Deletes blob+row only when refCount reaches 0
   * and retention allows (or force=true for test reset).
   */
  async releaseReference(input: {
    ownerType: ArtifactOwnerType;
    ownerId: string;
    artifactId: string;
    deleteIfOrphan?: boolean;
  }): Promise<{ released: boolean; deleted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const deletedRefs = await tx.artifactReference.deleteMany({
        where: {
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          artifactId: input.artifactId,
        },
      });
      if (deletedRefs.count === 0) {
        return { released: false, deleted: false };
      }

      const updated = await tx.rawArtifact.update({
        where: { id: input.artifactId },
        data: { refCount: { decrement: 1 } },
      });

      if (input.deleteIfOrphan && updated.refCount <= 0) {
        const remaining = await tx.artifactReference.count({
          where: { artifactId: input.artifactId },
        });
        if (remaining === 0) {
          const row = await tx.rawArtifact.delete({ where: { id: input.artifactId } });
          if (isPostgresStorageUri(row.storageUri)) {
            await tx.rawArtifactPayload
              .delete({ where: { contentHash: row.contentHash } })
              .catch(() => undefined);
          } else {
            await this.options.legacyFsStore?.delete(row.storageUri);
          }
          return { released: true, deleted: true };
        }
      }

      return { released: true, deleted: false };
    });
  }

  /** Refuse deleting artifacts that still have references. */
  async assertDeletable(artifactId: string): Promise<void> {
    const refs = await this.prisma.artifactReference.count({
      where: { artifactId },
    });
    if (refs > 0) {
      throw new Error(`Cannot delete artifact ${artifactId}: ${refs} reference(s) remain`);
    }
  }

  private async readVerifiedRow(row: {
    id: string;
    contentHash: string;
    storageUri: string;
    compression: ArtifactCompression;
  }): Promise<Buffer> {
    const payload = await this.prisma.rawArtifactPayload.findUnique({
      where: { contentHash: row.contentHash },
    });
    if (payload) {
      try {
        const result = await this.postgresStore.readByContentHash(row.contentHash);
        const actualHash = sha256Hex(result.bytes).toLowerCase();
        if (actualHash !== row.contentHash.toLowerCase()) {
          throw new ArtifactDigestMismatchError(row.contentHash, actualHash);
        }
        return result.bytes;
      } catch (error) {
        if (error instanceof ArtifactStoreError && error.code === "HASH_MISMATCH") {
          throw new ArtifactDigestMismatchError(
            row.contentHash,
            error.message.includes("got ") ? error.message.split("got ").pop()! : "unknown",
          );
        }
        throw error;
      }
    }

    if (isCasStorageUri(row.storageUri)) {
      const legacy = this.options.legacyFsStore;
      if (legacy) {
        try {
          const result = await legacy.read(row.storageUri, row.contentHash);
          const actualHash = sha256Hex(result.bytes).toLowerCase();
          if (actualHash !== row.contentHash.toLowerCase()) {
            throw new ArtifactDigestMismatchError(row.contentHash, actualHash);
          }
          return result.bytes;
        } catch (error) {
          if (
            error instanceof ArtifactDigestMismatchError ||
            (error instanceof ArtifactStoreError && error.code === "HASH_MISMATCH")
          ) {
            throw error;
          }
        }
      }
      throw new ArtifactLegacyExternalPayloadMissingError(row.id, row.storageUri);
    }

    if (isPostgresStorageUri(row.storageUri)) {
      throw new ArtifactPayloadMissingError(row.id, row.contentHash);
    }

    throw new ArtifactPayloadMissingError(row.id, row.contentHash);
  }
}

export type ArtifactRepositoryTx = Prisma.TransactionClient;

export function createArtifactRepository(
  prisma: PrismaClient,
  options?: ArtifactRepositoryOptions & { legacyFsStore?: ArtifactStore },
): ArtifactRepository {
  const pgStore = createPostgresArtifactStore(prisma);
  return new ArtifactRepository(prisma, pgStore, {
    legacyFsStore: options?.legacyFsStore,
  });
}
