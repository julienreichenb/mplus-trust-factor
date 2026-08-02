import { createHash } from "node:crypto";

/** SHA-256 hex digest of uncompressed content. */
export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export function assertSha256Hex(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_HEX_RE.test(normalized)) {
    throw new Error(`Invalid SHA-256 hex: ${value.slice(0, 16)}…`);
  }
  return normalized;
}
