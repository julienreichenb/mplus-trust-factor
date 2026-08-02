/**
 * Shared fail-closed helpers for versioned dimension model configs.
 */

export class ModelConfigValidationError extends Error {
  readonly code = "MODEL_CONFIG_INVALID" as const;
  readonly dimension: string;
  readonly details: string[];

  constructor(dimension: string, details: string[]) {
    super(`MODEL_CONFIG_INVALID:${dimension}:${details.join("; ")}`);
    this.name = "ModelConfigValidationError";
    this.dimension = dimension;
    this.details = details;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(
  obj: Record<string, unknown>,
  key: string,
  errors: string[],
): string | null {
  const v = obj[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    errors.push(`${key} must be a non-empty string`);
    return null;
  }
  return v;
}

export function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  errors: string[],
  opts?: { min?: number; max?: number },
): number | null {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push(`${key} must be a finite number`);
    return null;
  }
  if (opts?.min != null && v < opts.min) {
    errors.push(`${key} must be >= ${opts.min}`);
    return null;
  }
  if (opts?.max != null && v > opts.max) {
    errors.push(`${key} must be <= ${opts.max}`);
    return null;
  }
  return v;
}

export function requireBoolean(
  obj: Record<string, unknown>,
  key: string,
  errors: string[],
): boolean | null {
  const v = obj[key];
  if (typeof v !== "boolean") {
    errors.push(`${key} must be a boolean`);
    return null;
  }
  return v;
}

export function requireObject(
  obj: Record<string, unknown>,
  key: string,
  errors: string[],
): Record<string, unknown> | null {
  const v = obj[key];
  if (!isRecord(v)) {
    errors.push(`${key} must be an object`);
    return null;
  }
  return v;
}

export function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(`unknown field ${path}.${key}`);
    }
  }
}

export function weightsSumToOne(
  weights: Record<string, number>,
  path: string,
  errors: string[],
  tolerance = 1e-9,
): void {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > tolerance) {
    errors.push(`${path} must sum to 1 (got ${sum})`);
  }
}
