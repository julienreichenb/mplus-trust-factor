/**
 * Deterministic, order-independent hashing for model-config documents.
 * Provider-free — no DB IDs, timestamps, or mutable metadata.
 */

import { createHash } from "node:crypto";

/** Canonical JSON with sorted object keys (arrays preserve order). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Lowercase SHA-256 hex of a canonically stringified value. */
export function stableSha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}
