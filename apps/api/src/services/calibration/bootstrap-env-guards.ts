/**
 * Fail-closed environment / target guards for the cohort bootstrap runner.
 * Pure helpers — no Prisma, no secrets logged.
 */
import { isDisposableDatabaseName } from "@mplus/test-utils";
import {
  assertNotProductionEvidenceTarget,
  formatSanitizedDbTarget,
  sanitizeEvidenceDbTarget,
  type SanitizedDbTarget,
} from "./evidence-env-guards.js";

export {
  formatSanitizedDbTarget,
  sanitizeEvidenceDbTarget,
  type SanitizedDbTarget,
};

export const BOOTSTRAP_RUNNER_VERSION = "agent11-cohort-bootstrap-v1";
export const BOOTSTRAP_SCHEMA_VERSION = "agent11-cohort-bootstrap-manifest-v1";
export const BOOTSTRAP_PLAN_SCHEMA_VERSION = "agent11-cohort-bootstrap-plan-v1";
export const BOOTSTRAP_SUMMARY_SCHEMA_VERSION = "agent11-cohort-bootstrap-summary-v1";

/** Default bounded enqueue concurrency (conservative). */
export const BOOTSTRAP_DEFAULT_CONCURRENCY = 2;

export function assertCalibrationBootstrapEnv(): void {
  const value = process.env.CALIBRATION_BOOTSTRAP_ENV?.trim() ?? "";
  if (value !== "test") {
    throw new Error(
      `REFUSED: CALIBRATION_BOOTSTRAP_ENV must be exactly "test" (got: ${value === "" ? "(missing)" : JSON.stringify(value)})`,
    );
  }
}

export function envFlag(name: string, defaultValue = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

export function assertLiveProviderCallsAllowedForExecute(): void {
  if (!envFlag("ALLOW_LIVE_PROVIDER_CALLS", false)) {
    throw new Error("REFUSED: --execute requires ALLOW_LIVE_PROVIDER_CALLS=true");
  }
}

/**
 * Positive test identification + production refusal.
 * Accepts disposable itest DBs, *test* hostname/database markers, and known test compose names.
 */
export function assertPositiveTestBootstrapTarget(url: string): SanitizedDbTarget {
  const target = assertNotProductionEvidenceTarget(url);
  if (!isPositiveTestBootstrapTarget(target)) {
    throw new Error(
      `REFUSED: database target is not positively identified as test (${formatSanitizedDbTarget(target)})`,
    );
  }
  // Refuse the shared local compose development database name even on loopback.
  if (target.database.toLowerCase() === "mplus_trust") {
    throw new Error(
      `REFUSED: development database name "mplus_trust" is not a bootstrap target (${formatSanitizedDbTarget(target)})`,
    );
  }
  return target;
}

export function isPositiveTestBootstrapTarget(target: SanitizedDbTarget): boolean {
  const haystack = `${target.hostname}/${target.database}`.toLowerCase();
  if (/\bprod\b|production|mplus-prod|mplus_trust_prod|mplus_prod/.test(haystack)) {
    return false;
  }
  if (isDisposableDatabaseName(target.database)) return true;
  if (/\btest\b|\bitest\b|mplus_trust_test/.test(haystack)) return true;
  return false;
}

export function resolveBootstrapDatabaseUrl(): string {
  const url =
    process.env.CALIBRATION_BOOTSTRAP_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "";
  if (!url) {
    throw new Error(
      "REFUSED: CALIBRATION_BOOTSTRAP_DATABASE_URL or DATABASE_URL is required (process-scoped; do not write credentials to tracked files)",
    );
  }
  return url;
}

/**
 * Fail closed when a resume manifest does not match the current cohort/source/env/schema.
 */
export function assertResumeManifestCompatible(
  resume: {
    schemaVersion?: unknown;
    cohortId?: unknown;
    sourceFileHash?: unknown;
    targetEnvironment?: unknown;
    identities?: unknown;
  },
  expected: {
    schemaVersion: string;
    cohortId: string;
    sourceFileHash: string;
  },
): void {
  if (resume == null || typeof resume !== "object") {
    throw new Error("REFUSED: resume manifest must be an object");
  }
  if (resume.schemaVersion !== expected.schemaVersion) {
    throw new Error(
      `REFUSED: resume manifest schemaVersion mismatch (got ${JSON.stringify(resume.schemaVersion)}, expected ${expected.schemaVersion})`,
    );
  }
  if (resume.cohortId !== expected.cohortId) {
    throw new Error(
      `REFUSED: resume manifest cohortId mismatch (got ${JSON.stringify(resume.cohortId)}, expected ${expected.cohortId})`,
    );
  }
  if (resume.sourceFileHash !== expected.sourceFileHash) {
    throw new Error(
      `REFUSED: resume manifest sourceFileHash mismatch (got ${JSON.stringify(resume.sourceFileHash)}, expected ${expected.sourceFileHash})`,
    );
  }
  if (resume.targetEnvironment !== "test") {
    throw new Error(
      `REFUSED: resume manifest targetEnvironment must be "test" (got ${JSON.stringify(resume.targetEnvironment)})`,
    );
  }
  if (!Array.isArray(resume.identities)) {
    throw new Error("REFUSED: resume manifest identities must be an array");
  }
}

/** Parse bounded positive int options; invalid input fails closed (no silent unlimited). */
export function parseBoundedPositiveInt(
  raw: string | undefined,
  opts: {
    name: string;
    defaultValue: number;
    min: number;
    max: number;
    /** When true, absent raw uses defaultValue; present raw must parse. */
    optional?: boolean;
  },
): number {
  if (raw === undefined || raw === "") {
    return opts.defaultValue;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`REFUSED: --${opts.name} must be an integer (got ${JSON.stringify(raw)})`);
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < opts.min || n > opts.max) {
    throw new Error(
      `REFUSED: --${opts.name} must be an integer in [${opts.min}, ${opts.max}] (got ${JSON.stringify(raw)})`,
    );
  }
  return n;
}

/** Parse --limit: absent = null (no limit); present must be a positive integer. */
export function parseLimitOption(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`REFUSED: --limit must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`REFUSED: --limit must be >= 1 (got ${JSON.stringify(raw)})`);
  }
  return n;
}

