import { createHash } from "node:crypto";
import type { ArtifactCompression, Prisma, PrismaClient, Provider } from "@prisma/client";
import type { ArtifactStore, ArtifactStoreWriteResult } from "@mplus/artifact-store";

export type ArtifactOwnerType =
  | "ExternalPayload"
  | "EvidenceDataset"
  | "WclReportRevision"
  | "AddonExport"
  | "CalibrationFrozenExport"
  | "AdminDiagnostics";

export interface PersistArtifactInput {
  provider: Provider;
  bytes: Uint8Array | Buffer;
  compression?: "NONE" | "GZIP" | "ZSTD";
  artifactClass?: string;
  retentionUntil?: Date | null;
  owner?: { ownerType: ArtifactOwnerType; ownerId: string };
}

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

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class ArtifactRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly store: ArtifactStore,
  ) {}

  /**
   * Content-addressed write: store bytes, upsert RawArtifact by contentHash,
   * optionally register an owner reference (orphan prevention).
   */
  async persist(input: PersistArtifactInput): Promise<{
    artifactId: string;
    write: ArtifactStoreWriteResult;
  }> {
    const write = await this.store.write({
      bytes: input.bytes,
      compression: input.compression,
    });

    const artifact = await this.prisma.$transaction(async (tx) => {
      const row = await tx.rawArtifact.upsert({
        where: { contentHash: write.contentHash },
        create: {
          provider: input.provider,
          storageUri: write.storageUri,
          compression: write.compression as ArtifactCompression,
          contentHash: write.contentHash,
          sizeBytes: BigInt(write.sizeBytes),
          uncompressedSizeBytes: BigInt(write.uncompressedSizeBytes),
          artifactClass: input.artifactClass ?? null,
          refCount: 0,
          retentionUntil: input.retentionUntil ?? null,
        },
        update: {
          // Keep first-seen storageUri/compression; refresh retention if extended.
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

      return row;
    });

    return { artifactId: artifact.id, write };
  }

  async readVerified(artifactId: string): Promise<Buffer> {
    const row = await this.prisma.rawArtifact.findUniqueOrThrow({
      where: { id: artifactId },
    });
    const result = await this.store.read(row.storageUri, row.contentHash);
    return result.bytes;
  }

  /**
   * Lookup RawArtifact by contentHash, read CAS bytes, and verify digest.
   * Throws ArtifactMissingError / ArtifactDigestMismatchError on failure.
   */
  async readVerifiedByContentHash(contentHash: string): Promise<Buffer> {
    const hash = contentHash.trim().toLowerCase();
    const row = await this.prisma.rawArtifact.findUnique({
      where: { contentHash: hash },
    });
    if (!row) {
      throw new ArtifactMissingError(hash);
    }
    const result = await this.store.read(row.storageUri, row.contentHash);
    const actualHash = sha256Hex(result.bytes).toLowerCase();
    if (actualHash !== hash || actualHash !== row.contentHash.toLowerCase()) {
      throw new ArtifactDigestMismatchError(hash, actualHash);
    }
    return result.bytes;
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
          await this.store.delete(row.storageUri);
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
}

export type ArtifactRepositoryTx = Prisma.TransactionClient;
