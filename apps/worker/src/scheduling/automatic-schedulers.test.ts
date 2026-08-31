import { describe, expect, it } from "vitest";
import {
  PROVIDER_DATA_EXPORT_CRON_PATTERN,
  PROVIDER_DATA_IMPORT_CRON_PATTERN,
  SCORING_SEASON_DATA_SYNC_CRON_PATTERN,
  SCORING_SEASON_DATA_SYNC_CRON_TZ,
  scoringSeasonDataSyncRepeatOpts,
  shouldRegisterAutomaticBackgroundSchedulers,
  shouldRegisterExpensiveProviderPopulationSchedulers,
  shouldRegisterProviderDataExportSchedule,
  shouldRegisterProviderDataImportSchedule,
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

describe("shouldRegisterExpensiveProviderPopulationSchedulers", () => {
  it("requires deployed env AND collector", () => {
    expect(shouldRegisterExpensiveProviderPopulationSchedulers("staging", "collector")).toBe(true);
    expect(shouldRegisterExpensiveProviderPopulationSchedulers("production", "collector")).toBe(
      true,
    );
    expect(shouldRegisterExpensiveProviderPopulationSchedulers("staging", "consumer")).toBe(false);
    expect(shouldRegisterExpensiveProviderPopulationSchedulers("production", "consumer")).toBe(
      false,
    );
    expect(shouldRegisterExpensiveProviderPopulationSchedulers("development", "collector")).toBe(
      false,
    );
    expect(shouldRegisterExpensiveProviderPopulationSchedulers("development", "consumer")).toBe(
      false,
    );
  });
});

describe("provider-data export/import schedule gates", () => {
  it("export only on deployed collector", () => {
    expect(shouldRegisterProviderDataExportSchedule("staging", "collector")).toBe(true);
    expect(shouldRegisterProviderDataExportSchedule("staging", "consumer")).toBe(false);
    expect(shouldRegisterProviderDataExportSchedule("development", "collector")).toBe(false);
  });

  it("import only on deployed consumer", () => {
    expect(shouldRegisterProviderDataImportSchedule("staging", "consumer")).toBe(true);
    expect(shouldRegisterProviderDataImportSchedule("production", "consumer")).toBe(true);
    expect(shouldRegisterProviderDataImportSchedule("staging", "collector")).toBe(false);
    expect(shouldRegisterProviderDataImportSchedule("development", "consumer")).toBe(false);
  });

  it("pins nightly cadence", () => {
    expect(PROVIDER_DATA_EXPORT_CRON_PATTERN).toBe("0 4 * * *");
    expect(PROVIDER_DATA_IMPORT_CRON_PATTERN).toBe("30 4 * * *");
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
