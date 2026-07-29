/**
 * Explicit Prisma JSON serialization — no double-casts through `unknown`.
 */
import type { Prisma } from "@mplus/database";

/**
 * Convert an arbitrary JSON-compatible value into Prisma.InputJsonValue.
 * Rejects null/undefined at the top level and non-JSON types (functions, symbols, bigint).
 * Nested nulls are preserved on objects and arrays.
 */
export function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const out: Array<Prisma.InputJsonValue | null> = [];
    for (const item of value) {
      if (item === undefined || item === null) {
        out.push(null);
      } else {
        out.push(toInputJsonValue(item));
      }
    }
    return out;
  }
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: Prisma.InputJsonValue | null } = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      out[key] = entry === null ? null : toInputJsonValue(entry);
    }
    return out;
  }
  throw new Error(`Value of type "${typeof value}" is not JSON-serializable for Prisma`);
}
