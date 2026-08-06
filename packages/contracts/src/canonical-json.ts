/**
 * Canonical JSON serialization for content hashing.
 * Object keys are sorted recursively; array order is preserved.
 * undefined object values are omitted (never hashed as a sentinel).
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
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Lowercase SHA-256 hex of a canonically stringified value. */
export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}
