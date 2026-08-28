import { describe, expect, it } from "vitest";
import { hashRefreshContract } from "@mplus/contracts";
import { BOOTSTRAP_TEST_RELEASE_PIN } from "@mplus/test-utils";
import {
  allowFixtureZoneDefaultsForProviderMode,
  resolveActiveRefreshContract,
} from "./orchestration/build-refresh-contract.js";

/**
 * Regression: API and worker must share one canonical contract resolver.
 * Zone IDs come from the effective scoring season catalog — never from env.
 */
describe("canonical refresh contract — API/worker hash equality", () => {
  const base = {
    scoringModelKey: "default",
    scoringModelVersion: 6,
    activeSeasonId: "blizzard-season-13",
    abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
  };

  it("APP_ENV=test does not enable fixture defaults when PROVIDER_MODE is live", () => {
    expect(allowFixtureZoneDefaultsForProviderMode("live")).toBe(false);
    expect(allowFixtureZoneDefaultsForProviderMode("fixture")).toBe(true);
  });

  it("live: API and worker calculate the same hash when zoneId is explicit", () => {
    const api = resolveActiveRefreshContract({
      ...base,
      providerMode: "live",
      zoneId: 39,
      partition: null,
    });
    const worker = resolveActiveRefreshContract({
      ...base,
      providerMode: "live",
      zoneId: 39,
      partition: null,
    });

    expect(api.hash).toBe(worker.hash);
    expect(api.contract.zoneId).toBe(39);
    expect(worker.contract.zoneId).toBe(39);
    expect(hashRefreshContract(api.contract)).toBe(api.hash);
  });

  it("live without explicit zoneId fails closed (env is not authoritative)", () => {
    expect(() =>
      resolveActiveRefreshContract({
        ...base,
        providerMode: "live",
        env: { WCL_MPLUS_ZONE_ID: "39", PROVIDER_MODE: "live" },
      }),
    ).toThrow(/zoneId is required|not authoritative/);
  });

  it("fixture environment: API and worker calculate the same hash with fixture default zone", () => {
    const api = resolveActiveRefreshContract({ ...base, providerMode: "fixture" });
    const worker = resolveActiveRefreshContract({ ...base, providerMode: "fixture" });

    expect(api.hash).toBe(worker.hash);
    expect(api.contract.zoneId).toBe(45);
    expect(api.allowFixtureZoneDefault).toBe(true);
  });

  it("misleading env zone does not affect an explicit catalog zoneId", () => {
    const resolved = resolveActiveRefreshContract({
      ...base,
      providerMode: "live",
      env: {
        WCL_MPLUS_ZONE_ID: "9999",
        WCL_MPLUS_ZONE_MODE: "pinned",
        APP_ENV: "test",
        PROVIDER_MODE: "live",
      },
      zoneId: 39,
    });
    expect(resolved.contract.zoneId).toBe(39);
  });
});
