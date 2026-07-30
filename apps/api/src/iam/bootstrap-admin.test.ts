import { describe, expect, it } from "vitest";
import { buildTestEnv } from "../test-helpers.js";
import {
  assertEmergencyFallbackPolicy,
  resolveBootstrapLookup,
} from "./bootstrap-admin.js";

describe("admin bootstrap config", () => {
  it("skips when unset", () => {
    const env = buildTestEnv();
    expect(resolveBootstrapLookup(env)).toBeNull();
  });

  it("fails loudly when both bootstrap identities are set via env schema", () => {
    expect(() =>
      buildTestEnv({
        ADMIN_BOOTSTRAP_USER_ID: "11111111-1111-4111-8111-111111111111",
        ADMIN_BOOTSTRAP_BATTLENET_SUBJECT: "bnet-sub-9",
      }),
    ).toThrow(/ADMIN_BOOTSTRAP/);
  });

  it("accepts user id or battlenet subject", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    expect(resolveBootstrapLookup(buildTestEnv({ ADMIN_BOOTSTRAP_USER_ID: userId }))).toEqual({
      kind: "userId",
      userId,
    });
    expect(
      resolveBootstrapLookup(buildTestEnv({ ADMIN_BOOTSTRAP_BATTLENET_SUBJECT: "bnet-sub-9" })),
    ).toEqual({ kind: "battlenetSubject", subject: "bnet-sub-9" });
  });

  it("refuses silent emergency fallback on shared envs when bootstrap is configured", () => {
    const env = buildTestEnv({
      APP_ENV: "staging",
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
      ADMIN_BOOTSTRAP_BATTLENET_SUBJECT: "bnet-sub-9",
    });
    const result = assertEmergencyFallbackPolicy(env, true);
    expect(result.ok).toBe(false);
  });

  it("allows local development to keep emergency fallback with a warning path", () => {
    const env = buildTestEnv({
      APP_ENV: "development",
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
      ADMIN_BOOTSTRAP_BATTLENET_SUBJECT: "bnet-sub-9",
    });
    expect(assertEmergencyFallbackPolicy(env, true).ok).toBe(true);
  });
});
