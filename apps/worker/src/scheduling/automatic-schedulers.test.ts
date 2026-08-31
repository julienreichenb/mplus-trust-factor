import { describe, expect, it } from "vitest";
import {
  SCORING_SEASON_DATA_SYNC_CRON_PATTERN,
  SCORING_SEASON_DATA_SYNC_CRON_TZ,
  scoringSeasonDataSyncRepeatOpts,
  shouldRegisterAutomaticBackgroundSchedulers,
} from "./automatic-schedulers.js";

describe("shouldRegisterAutomaticBackgroundSchedulers", () => {
  it("does not register on local development", () => {
    expect(shouldRegisterAutomaticBackgroundSchedulers("development")).toBe(false);
  });

  it("does not register on test", () => {
    expect(shouldRegisterAutomaticBackgroundSchedulers("test")).toBe(false);
  });

  it("registers on staging and production", () => {
    expect(shouldRegisterAutomaticBackgroundSchedulers("staging")).toBe(true);
    expect(shouldRegisterAutomaticBackgroundSchedulers("production")).toBe(true);
  });
});

describe("scoringSeasonDataSyncRepeatOpts", () => {
  it("pins the nightly sync to 03:00 UTC", () => {
    expect(scoringSeasonDataSyncRepeatOpts()).toEqual({
      pattern: SCORING_SEASON_DATA_SYNC_CRON_PATTERN,
      tz: SCORING_SEASON_DATA_SYNC_CRON_TZ,
    });
    expect(SCORING_SEASON_DATA_SYNC_CRON_PATTERN).toBe("0 3 * * *");
  });
});
