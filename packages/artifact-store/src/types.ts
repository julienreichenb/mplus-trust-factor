/** Compression codecs persisted on RawArtifact.compression. */
export type ArtifactCompression = "NONE" | "GZIP" | "ZSTD";

/** Logical classes of content-addressed blobs. */
export type ArtifactClass =
  | "raw_provider_response"
  | "wcl_event_page"
  | "wcl_table_payload"
  | "wcl_master_data"
  | "calibration_frozen_export"
  | "admin_diagnostics"
  | "other";

export interface ArtifactStoreWriteInput {
  /** Uncompressed payload bytes. */
  bytes: Uint8Array | Buffer;
  compression?: ArtifactCompression;
  /** Optional logical class for diagnostics (not part of content hash). */
  artifactClass?: ArtifactClass;
}

export interface ArtifactStoreWriteResult {
  /** SHA-256 hex of uncompressed bytes. */
  contentHash: string;
  /** Content-addressed storage URI (scheme-specific). */
  storageUri: string;
  compression: ArtifactCompression;
  /** Stored (possibly compressed) byte length. */
  sizeBytes: number;
  /** Uncompressed byte length. */
  uncompressedSizeBytes: number;
  /** True when an identical blob already existed. */
  deduplicated: boolean;
}

export interface ArtifactStoreReadResult {
  contentHash: string;
  storageUri: string;
  compression: ArtifactCompression;
  sizeBytes: number;
  uncompressedSizeBytes: number;
  bytes: Buffer;
}

export interface ArtifactStoreBounds {
  /** Max uncompressed payload size (bytes). */
  maxUncompressedBytes: number;
  /** Max on-disk/compressed size (bytes). */
  maxCompressedBytes: number;
}

export const DEFAULT_ARTIFACT_BOUNDS: ArtifactStoreBounds = {
  maxUncompressedBytes: 32 * 1024 * 1024,
  maxCompressedBytes: 16 * 1024 * 1024,
};

/**
 * Production storage interface. Local filesystem is the test/MVP backend;
 * S3-compatible backends can implement the same contract later.
 */
export interface ArtifactStore {
  readonly scheme: string;
  write(input: ArtifactStoreWriteInput): Promise<ArtifactStoreWriteResult>;
  read(storageUri: string, expectedContentHash?: string): Promise<ArtifactStoreReadResult>;
  exists(contentHash: string): Promise<boolean>;
  /** Resolve content-addressed URI for a hash without reading bytes. */
  uriForHash(contentHash: string, compression: ArtifactCompression): string;
  delete(storageUri: string): Promise<boolean>;
}

export class ArtifactStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ArtifactStoreError";
    this.code = code;
  }
}
