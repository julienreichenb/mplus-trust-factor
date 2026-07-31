export type OptionalNumberParseResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * Safe parser for optional numeric form fields (string | number | null | undefined).
 * Empty input → null. Finite number → number. Invalid / non-finite → error (do not call API).
 */
export function parseOptionalNumber(
  raw: string | number | null | undefined,
  label = "Value",
): OptionalNumberParseResult {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      return { ok: false, error: `${label} must be a finite number` };
    }
    return { ok: true, value: raw };
  }
  const trimmed = String(raw).trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${label} must be a finite number` };
  }
  return { ok: true, value: n };
}
