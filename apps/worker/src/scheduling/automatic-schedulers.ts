/**
 * Automatic BullMQ scheduler registration policy.
 *
 * Recurring jobs register only on deployed environments. Local `development`
 * (and `test`) keep manual enqueue / admin "Run now" paths available.
 *
 * Expensive WCL population (relevant discovery / drain) additionally requires
 * PROVIDER_DATA_ROLE=collector so staging and production do not both crawl.
 */

export type AutomaticSchedulerAppEnv = "development" | "test" | "staging" | "production";
export type ProviderDataRole = "collector" | "consumer";

/** Nightly scoring-season + Key distribution sync (UTC) — cheap / shared SoT. */
export const SCORING_SEASON_DATA_SYNC_CRON_PATTERN = "0 3 * * *";
export const SCORING_SEASON_DATA_SYNC_CRON_TZ = "UTC";
export const SCORING_SEASON_DATA_SYNC_SCHEDULER_ID = "daily-scoring-season-data-sync";

/** Collector nightly portable corpus export (UTC) — after season sync. */
export const PROVIDER_DATA_EXPORT_CRON_PATTERN = "0 4 * * *";
export const PROVIDER_DATA_EXPORT_SCHEDULER_ID = "nightly-provider-data-export";

/** Consumer nightly portable corpus import (UTC). */
export const PROVIDER_DATA_IMPORT_CRON_PATTERN = "30 4 * * *";
export const PROVIDER_DATA_IMPORT_SCHEDULER_ID = "nightly-provider-data-import";

/** Deployed env gate for cheap automatic schedulers (season/Key sync). */
export function shouldRegisterAutomaticBackgroundSchedulers(
  appEnv: string,
): appEnv is "staging" | "production" {
  return appEnv === "staging" || appEnv === "production";
}

/**
 * Expensive automatic provider population (relevant discovery + WCL drain).
 * Requires deployed env AND collector role.
 */
export function shouldRegisterExpensiveProviderPopulationSchedulers(
  appEnv: string,
  providerDataRole: string,
): boolean {
  return (
    shouldRegisterAutomaticBackgroundSchedulers(appEnv) && providerDataRole === "collector"
  );
}

export function shouldRegisterProviderDataExportSchedule(
  appEnv: string,
  providerDataRole: string,
): boolean {
  return (
    shouldRegisterAutomaticBackgroundSchedulers(appEnv) && providerDataRole === "collector"
  );
}

export function shouldRegisterProviderDataImportSchedule(
  appEnv: string,
  providerDataRole: string,
): boolean {
  return (
    shouldRegisterAutomaticBackgroundSchedulers(appEnv) && providerDataRole === "consumer"
  );
}

export function scoringSeasonDataSyncRepeatOpts(): {
  pattern: string;
  tz: string;
} {
  return {
    pattern: SCORING_SEASON_DATA_SYNC_CRON_PATTERN,
    tz: SCORING_SEASON_DATA_SYNC_CRON_TZ,
  };
}

export function providerDataExportRepeatOpts(): { pattern: string; tz: string } {
  return { pattern: PROVIDER_DATA_EXPORT_CRON_PATTERN, tz: "UTC" };
}

export function providerDataImportRepeatOpts(): { pattern: string; tz: string } {
  return { pattern: PROVIDER_DATA_IMPORT_CRON_PATTERN, tz: "UTC" };
}
