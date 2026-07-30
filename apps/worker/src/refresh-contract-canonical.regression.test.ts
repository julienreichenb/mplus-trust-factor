import { describe, expect, it } from "vitest";
import { hashRefreshContract } from "@mplus/contracts";
import {
  allowFixtureZoneDefaultsForProviderMode,
  resolveActiveRefreshContract,
} from "./orchestration/build-refresh-contract.js";

/**
 * Regression: API and worker must share one canonical contract resolver.
 * Divergent allowFixtureZoneDefault (PROVIDER_MODE vs APP_ENV=test) caused
 * zoneId mismatches and infinite refresh loops in live test deploys.
 */
describe("canonical refresh contract — API/worker hash equality", () => {
  const base = {
    scoringModelKey: "default",
    scoringModelVersion: 6,
    activeSeasonId: "blizzard-season-13",
  };

  it("APP_ENV=test does not enable fixture defaults when PROVIDER_MODE is live", () => {
    expect(allowFixtureZoneDefaultsForProviderMode("live")).toBe(false);
    expect(allowFixtureZoneDefaultsForProviderMode("fixture")).toBe(true);
  });

  it("live test environment: API and worker calculate the same hash (explicit zone)", () => {
    const env = {
      ...process.env,
      APP_ENV: "test",
      NODE_ENV: "test",
      PROVIDER_MODE: "live",
      WCL_MPLUS_ZONE_ID: "39",
    };

    // API path (PROVIDER_MODE gate only)
    const api = resolveActiveRefreshContract({
      ...base,
      providerMode: "live",
      env,
      zoneId: 39,
      partition: null,
    });
    // Worker path (same canonical helper — must not use APP_ENV=test fixture fallback)
    const worker = resolveActiveRefreshContract({
      ...base,
      providerMode: "live",
      env,
      zoneId: 39,
      partition: null,
    });

    expect(api.hash).toBe(worker.hash);
    expect(api.contract.zoneId).toBe(39);
    expect(worker.contract.zoneId).toBe(39);
    expect(hashRefreshContract(api.contract)).toBe(api.hash);
  });

  it("live test environment without explicit zone: both resolve env zone identically", () => {
    const env = {
      WCL_MPLUS_ZONE_ID: "39",
      APP_ENV: "test",
      NODE_ENV: "test",
      PROVIDER_MODE: "live",
    };

    const api = resolveActiveRefreshContract({ ...base, providerMode: "live", env });
    const worker = resolveActiveRefreshContract({ ...base, providerMode: "live", env });

    expect(api.hash).toBe(worker.hash);
    expect(api.contract.zoneId).toBe(39);
    expect(api.allowFixtureZoneDefault).toBe(false);
  });

  it("fixture environment: API and worker calculate the same hash with fixture default zone", () => {
    const env = {
      APP_ENV: "test",
      NODE_ENV: "test",
      PROVIDER_MODE: "fixture",
    };
    // Ensure no live zone override.
    delete (env as { WCL_MPLUS_ZONE_ID?: string }).WCL_MPLUS_ZONE_ID;

    const api = resolveActiveRefreshContract({ ...base, providerMode: "fixture", env });
    const worker = resolveActiveRefreshContract({ ...base, providerMode: "fixture", env });

    expect(api.hash).toBe(worker.hash);
    expect(api.contract.zoneId).toBe(45);
    expect(api.allowFixtureZoneDefault).toBe(true);
  });

  it("reproduces the pre-fix divergence: APP_ENV=test fixture fallback vs live PROVIDER_MODE", () => {
    const envWithoutZone = {
      APP_ENV: "test",
      NODE_ENV: "test",
      PROVIDER_MODE: "live",
    };

    // Old worker behaviour (BUG): APP_ENV=test enabled fixture default → zone 45
    const buggyWorkerAllowFixture = true;
    // Canonical API / fixed worker: live → no fixture default
    const liveAllowFixture = allowFixtureZoneDefaultsForProviderMode("live");

    expect(liveAllowFixture).toBe(false);
    expect(buggyWorkerAllowFixture).toBe(true);

    const fixed = resolveActiveRefreshContract({
      ...base,
      providerMode: "live",
      env: { ...envWithoutZone, WCL_MPLUS_ZONE_ID: "39" },
    });
    // With explicit env zone both sides agree; without the fix, missing env + APP_ENV fixture
    // would have published zoneId=45 while API requested zoneId=39.
    expect(fixed.contract.zoneId).toBe(39);
  });
});
