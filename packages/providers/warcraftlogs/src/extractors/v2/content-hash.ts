import { createHash } from "node:crypto";

/** Deterministic JSON for content hashing (sorted object keys, stable arrays). */
export function canonicalizeForHash(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
    out[key] = canonicalizeForHash(record[key]);
  }
  return out;
}

/** SHA-256 hex of a bounded typed fact document (no raw event payloads). */
export function hashFactDocumentContent(fact: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeForHash(fact)), "utf8")
    .digest("hex");
}

/**
 * Fact-set fingerprint identity (slot + extractor). Content integrity uses
 * hashFactDocumentContent separately; conflict detection compares both.
 */
export function buildTypedFactSetFingerprint(parts: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  extractorFamily: string;
  extractorVersion: string;
}): string {
  return createHash("sha256")
    .update(
      [
        parts.reportCode,
        String(parts.fightId),
        String(parts.reportRevision),
        parts.extractorFamily,
        parts.extractorVersion,
      ].join("|"),
      "utf8",
    )
    .digest("hex");
}
