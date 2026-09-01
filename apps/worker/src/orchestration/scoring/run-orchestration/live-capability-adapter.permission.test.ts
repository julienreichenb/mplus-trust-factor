import { describe, expect, it } from "vitest";
import {
  evaluateLiveCapabilityPermission,
  evaluateProductLiveCapabilityPermission,
} from "./live-capability-adapter.js";

function allowedInput(overrides: Partial<Parameters<typeof evaluateLiveCapabilityPermission>[0]> = {}) {
  return {
    providerMode: "live",
    wclEnabled: true,
    allowLiveProviderCalls: true,
    liveProviderPermissionGranted: true,
    scoringPublicationEnabled: true,
    hasWclCredentials: true,
    ...overrides,
  } as Parameters<typeof evaluateLiveCapabilityPermission>[0];
}

describe("live capability permission gates", () => {
  it("keeps the generic/canary gate fail-closed when publication is enabled", () => {
    expect(evaluateLiveCapabilityPermission(allowedInput())).toEqual({
      allowed: false,
      reasons: ["PUBLICATION_ENABLED"],
    });
  });

  it("allows the product refresh acquisition path while publication is enabled", () => {
    expect(evaluateProductLiveCapabilityPermission(allowedInput())).toEqual({
      allowed: true,
    });
  });

  it("product acquisition still fails closed on live-provider safety gates", () => {
    expect(
      evaluateProductLiveCapabilityPermission(
        allowedInput({
          allowLiveProviderCalls: false,
          liveProviderPermissionGranted: false,
          hasWclCredentials: false,
        }),
      ),
    ).toEqual({
      allowed: false,
      reasons: [
        "ALLOW_LIVE_PROVIDER_CALLS_FALSE",
        "ORCHESTRATION_LIVE_PERMISSION_FORBIDDEN",
        "WCL_CREDENTIALS_MISSING",
      ],
    });
  });
});
