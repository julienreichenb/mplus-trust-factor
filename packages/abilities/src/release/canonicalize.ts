/**
 * Deterministic canonical JSON (sorted object keys; arrays preserve order).
 * Same discipline as packages/scoring stable-hash — local copy to avoid a
 * scoring dependency from the abilities package.
 *
 * Object keys whose values are `undefined` are omitted (JSON-compatible).
 */

import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  if (value === undefined) {
    throw new Error("stableStringify cannot serialize bare undefined");
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Lowercase SHA-256 hex of UTF-8 canonical bytes. */
export function stableSha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

export function sha256Utf8(bytes: string | Buffer): string {
  const hash = createHash("sha256");
  if (typeof bytes === "string") {
    hash.update(bytes, "utf8");
  } else {
    hash.update(bytes);
  }
  return hash.digest("hex");
}
