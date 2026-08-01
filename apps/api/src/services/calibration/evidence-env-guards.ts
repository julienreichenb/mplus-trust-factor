/**
 * Fail-closed environment / target guards for the read-only evidence join.
 * Pure helpers — no Prisma, no secrets logged.
 */

export interface SanitizedDbTarget {
  hostname: string;
  port: string;
  database: string;
}

export function sanitizeEvidenceDbTarget(url: string): SanitizedDbTarget {
  const u = new URL(url);
  const database = decodeURIComponent(u.pathname.replace(/^\//, "").split("?")[0] ?? "");
  return {
    hostname: u.hostname,
    port: u.port || (u.protocol === "postgresql:" || u.protocol === "postgres:" ? "5432" : ""),
    database,
  };
}

export function assertCalibrationEvidenceEnv(): void {
  const value = process.env.CALIBRATION_EVIDENCE_ENV?.trim() ?? "";
  if (value !== "test") {
    throw new Error(
      `REFUSED: CALIBRATION_EVIDENCE_ENV must be exactly "test" (got: ${value === "" ? "(missing)" : JSON.stringify(value)})`,
    );
  }
}

/**
 * Fail closed when the URL/target looks like production.
 * Does not log credentials.
 */
export function assertNotProductionEvidenceTarget(url: string): SanitizedDbTarget {
  const target = sanitizeEvidenceDbTarget(url);
  const haystack = `${target.hostname}/${target.database}`.toLowerCase();
  const prodHints = [
    /\bprod\b/,
    /production/,
    /mplus-prod/,
    /mplus_trust_prod/,
    /mplus_prod/,
  ];
  for (const re of prodHints) {
    if (re.test(haystack)) {
      throw new Error(
        `REFUSED: evidence target looks like production (hostname=${target.hostname} database=${target.database})`,
      );
    }
  }
  // Explicit test DB name from deploy examples — soft preference, not required if custom naming.
  return target;
}

export function formatSanitizedDbTarget(target: SanitizedDbTarget): string {
  return `hostname=${target.hostname} port=${target.port} database=${target.database}`;
}
