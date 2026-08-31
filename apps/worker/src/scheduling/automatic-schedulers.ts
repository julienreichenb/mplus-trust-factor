/**
 * Automatic BullMQ scheduler registration policy.
 *
 * Recurring jobs register only on deployed environments. Local `development`
 * (and `test`) keep manual enqueue / admin "Run now" paths available.
 */

export type AutomaticSchedulerAppEnv = "development" | "test" | "staging" | "production";

/** Nightly scoring-season + Key distribution sync (UTC). */
export const SCORING_SEASON_DATA_SYNC_CRON_PATTERN = "0 3 * * *";
export const SCORING_SEASON_DATA_SYNC_CRON_TZ = "UTC";
export const SCORING_SEASON_DATA_SYNC_SCHEDULER_ID = "daily-scoring-season-data-sync";

export function shouldRegisterAutomaticBackgroundSchedulers(
  appEnv: string,
): appEnv is "staging" | "production" {
  return appEnv === "staging" || appEnv === "production";
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
