import { describe, expect, it } from "vitest";
import { evaluateLiveCapabilityPermission } from "./live-capability-adapter.js";

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

describe("evaluateLiveCapabilityPermission", () => {
  it("allows product acquisition while scoring publication is enabled", () => {
    expect(evaluateLiveCapabilityPermission(allowedInput())).toEqual({ allowed: true });
  });

  it("still fails closed on live-provider safety gates", () => {
    expect(
      evaluateLiveCapabilityPermission(
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
