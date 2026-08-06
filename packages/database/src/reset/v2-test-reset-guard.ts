export const SCORING_RESET_CONFIRMATION_TOKEN = "RESET_scoring_TEST_DATA";

const DEV_DATABASE_NAME = "mplus_trust";
const DISPOSABLE_DB_RE = /^mplus_itest_[a-z0-9]{8,24}$/;

const BLOCKED_DB_NAMES = new Set([
  DEV_DATABASE_NAME,
  "mplus_trust_prod",
  "mplus_trust_production",
  "postgres",
]);

/**
 * Note: the shared local database name `mplus_trust` stays blocked here on purpose.
 * Use `pnpm db:reset:wcl-scoring-derived` for guarded local development cleanup of
 * that database — do not weaken this disposable-DB-only gate.
 */
export type ScoringResetGuardInput = {
  databaseUrl?: string;
  appEnv?: string;
  confirmationToken?: string;
  allowNamedTestDb?: boolean;
};

export type ScoringResetGuardResult =
  | { ok: true; sanitized: string }
  | { ok: false; reason: string; sanitized: string };

function parseDatabaseName(databaseUrl: string): string | null {
  try {
    const u = new URL(databaseUrl.trim());
    const protocol = u.protocol.replace(/:$/, "").toLowerCase();
    if (protocol !== "postgresql" && protocol !== "postgres") return null;
    return decodeURIComponent(u.pathname.replace(/^\//, "").split("/")[0] ?? "") || null;
  } catch {
    return null;
  }
}

export function sanitizeDatabaseUrlForReset(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl.trim());
    const db = decodeURIComponent(u.pathname.replace(/^\//, "").split("/")[0] ?? "");
    return `${u.protocol}//${u.hostname}:${u.port || "5432"}/${db}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/**
 * Strict gate for destructive Scoring V2 test reset.
 * Never allows production/staging APP_ENV or known production DB names.
 */
export function assertScoringTestResetAllowed(
  input: ScoringResetGuardInput = {},
): ScoringResetGuardResult {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL ?? "";
  const sanitized = sanitizeDatabaseUrlForReset(databaseUrl);
  const appEnv = String(input.appEnv ?? process.env.APP_ENV ?? "").toLowerCase();

  if (appEnv === "production" || appEnv === "prod" || appEnv === "staging") {
    return {
      ok: false,
      reason: `Blocked: APP_ENV=${JSON.stringify(input.appEnv ?? process.env.APP_ENV)} forbids destructive scoring V2 reset.`,
      sanitized,
    };
  }

  if (appEnv !== "test" && appEnv !== "development") {
    return {
      ok: false,
      reason: `Blocked: APP_ENV must be "test" or "development" (got ${JSON.stringify(input.appEnv ?? process.env.APP_ENV ?? "")}).`,
      sanitized,
    };
  }

  if (input.confirmationToken !== SCORING_RESET_CONFIRMATION_TOKEN) {
    return {
      ok: false,
      reason: `Blocked: confirmation token mismatch. Pass --confirm=${SCORING_RESET_CONFIRMATION_TOKEN}.`,
      sanitized,
    };
  }

  const database = parseDatabaseName(databaseUrl);
  if (!database) {
    return {
      ok: false,
      reason: "Blocked: DATABASE_URL is missing or not a valid PostgreSQL URL.",
      sanitized,
    };
  }

  if (BLOCKED_DB_NAMES.has(database)) {
    return {
      ok: false,
      reason: `Blocked: database "${database}" is not eligible for destructive reset.`,
      sanitized,
    };
  }

  if (database.includes("prod")) {
    return {
      ok: false,
      reason: `Blocked: database name "${database}" looks like production.`,
      sanitized,
    };
  }

  const isDisposable = DISPOSABLE_DB_RE.test(database);
  const isNamedTest = /_test$|_test_/i.test(database) || database.includes("itest");

  if (isDisposable) {
    return { ok: true, sanitized };
  }

  if (input.allowNamedTestDb && isNamedTest) {
    return { ok: true, sanitized };
  }

  return {
    ok: false,
    reason:
      `Blocked: database "${database}" is not a disposable mplus_itest_* DB. ` +
      `For explicit local test DBs pass --allow-named-test-db (still requires *_test name).`,
    sanitized,
  };
}

export function formatScoringResetGuardFailure(failure: {
  reason: string;
  sanitized: string;
}): string {
  return [
    "SCORING V2 TEST RESET GUARD — destructive command blocked.",
    failure.reason,
    `Target (sanitized): ${failure.sanitized}`,
  ].join("\n");
}

/** Tables truncated by Option A hard test cutover (identity/catalog retained). */
export const SCORING_RESET_TRUNCATE_TABLES = [
  "dimension_computations",
  "run_fact_sets",
  "evidence_datasets",
  "evidence_manifest_slots",
  "score_analysis_batch_runs",
  "score_analysis_batches",
  "character_published_scores",
  "dimension_scores",
  "score_disputes",
  "score_snapshots",
  "evidence_manifests",
  "wcl_report_revisions",
  "artifact_references",
  "metric_observations",
  "run_analyses",
  "run_participants",
  "run_source_references",
  "mythic_runs",
  "external_payloads",
  "external_requests",
  "raw_artifacts",
  "capability_evidence_package_records",
  "participant_scoring_digests",
  "character_red_flags",
  "refresh_cost_ledger_entries",
  "refresh_schedule_items",
  "refresh_schedule_runs",
  "refresh_admissions",
  "ingestion_jobs",
] as const;

/** Tables retained across Option A reset. */
export const SCORING_RESET_RETAINED_TABLES = [
  "users",
  "user_sessions",
  "user_role_assignments",
  "battle_net_accounts",
  "account_characters",
  "verified_character_ownerships",
  "regions",
  "realms",
  "seasons",
  "dungeons",
  "season_dungeons",
  "game_classes",
  "game_specializations",
  "characters",
  "character_aliases",
  "score_models",
  "metric_definitions",
  "red_flag_definitions",
  "mechanic_rules",
  "calibration_cohorts",
  "calibration_cohort_members",
] as const;
