/**
 * URL safety helpers for optional external media and links.
 */

export function sanitizeHttpsUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function readOptionalHttpsUrl(source: object, keys: readonly string[]): string | null {
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      const safe = sanitizeHttpsUrl(value);
      if (safe) return safe;
    }
  }
  return null;
}

export function readOptionalPositiveInt(source: object, keys: readonly string[]): number | null {
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      const parsed = Number(value.trim());
      if (parsed > 0) return parsed;
    }
  }
  return null;
}

export function readOptionalString(source: object, keys: readonly string[]): string | null {
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
