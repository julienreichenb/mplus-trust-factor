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
