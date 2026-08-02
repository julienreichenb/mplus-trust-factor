import path from "node:path";
import { ArtifactStoreError } from "./types.js";
import { assertSha256Hex } from "./hash.js";

/**
 * Resolve a content-hash relative path under rootDir.
 * Rejects traversal, absolute segments, and non-hash filenames.
 */
export function resolveContentAddressedPath(
  rootDir: string,
  contentHash: string,
  extension: string,
): string {
  const hash = assertSha256Hex(contentHash);
  const shard = hash.slice(0, 2);
  const relative = path.join(shard, `${hash}${extension}`);
  const root = path.resolve(rootDir);
  const absolute = path.resolve(root, relative);
  const relativeToRoot = path.relative(root, absolute);
  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot) ||
    relativeToRoot.includes("\0")
  ) {
    throw new ArtifactStoreError(
      "PATH_TRAVERSAL",
      `Refusing path outside artifact root: ${relativeToRoot}`,
    );
  }
  return absolute;
}

/** Parse `cas://sha256/<hash>[.bin[.gz|.zst]]`. */
export function parseCasUri(storageUri: string): { contentHash: string; extension: string } {
  const casMatch =
    /^cas:\/\/sha256\/([a-fA-F0-9]{64})(\.bin(?:\.gz|\.zst)?)?$/.exec(storageUri.trim());
  if (casMatch) {
    return {
      contentHash: casMatch[1]!.toLowerCase(),
      extension: casMatch[2] ?? "",
    };
  }
  throw new ArtifactStoreError("INVALID_URI", `Unsupported storage URI: ${storageUri}`);
}

export function extensionForCompression(compression: "NONE" | "GZIP" | "ZSTD"): string {
  switch (compression) {
    case "NONE":
      return ".bin";
    case "GZIP":
      return ".bin.gz";
    case "ZSTD":
      return ".bin.zst";
    default: {
      const _exhaustive: never = compression;
      return _exhaustive;
    }
  }
}

export function compressionFromExtension(extension: string): "NONE" | "GZIP" | "ZSTD" {
  switch (extension) {
    case ".bin.gz":
      return "GZIP";
    case ".bin.zst":
      return "ZSTD";
    case ".bin":
    case "":
      return "NONE";
    default:
      throw new ArtifactStoreError("INVALID_URI", `Unknown artifact extension: ${extension}`);
  }
}
