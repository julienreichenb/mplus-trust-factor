import { createHash } from "node:crypto";

/** Stable JSON for hashing — sorted object keys, arrays preserve order. */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

export function hashCanonicalPayload(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value), "utf8").digest("hex");
}

export function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    out[key] = serializeValue(row[key]);
  }
  return out;
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object" && value !== null && "toFixed" in value) {
    // Prisma Decimal
    return String(value);
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object") {
    return serializeRow(value as Record<string, unknown>);
  }
  return value;
}
