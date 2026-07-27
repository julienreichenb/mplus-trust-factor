import { describe, expect, it } from "vitest";
import { createLogger, SECRET_REDACT_PATHS, redactSecretsInObject, sanitizeSensitiveDeep } from "@mplus/observability";
import { constantTimeEqual, isAllowedProviderHost } from "@mplus/observability";

describe("security: log redaction", () => {
  it("defines redact paths for credentials", () => {
    expect(SECRET_REDACT_PATHS).toContain("*.BLIZZARD_CLIENT_SECRET");
    expect(SECRET_REDACT_PATHS).toContain("req.headers.authorization");
    expect(SECRET_REDACT_PATHS).toContain("*.reportCode");
  });

  it("redacts secrets in plain objects", () => {
    const redacted = redactSecretsInObject({
      route: "/api/v1/meta",
      WCL_CLIENT_SECRET: "leak",
      count: 3,
    });
    expect(redacted.WCL_CLIENT_SECRET).toBe("[Redacted]");
    expect(redacted.count).toBe(3);
  });

  it("deep-sanitizes GraphQL-shaped payloads with report codes", () => {
    const sanitized = sanitizeSensitiveDeep({
      variables: { code: "PrivateReportABC", fightIDs: [1] },
      reportCode: "PrivateReportABC",
      access_token: "tok",
    }) as Record<string, unknown>;
    expect(JSON.stringify(sanitized)).not.toContain("PrivateReportABC");
    expect(sanitized.access_token).toBe("[Redacted]");
  });

  it("logger is created with redact configuration", () => {
    const logger = createLogger({ level: "silent" });
    expect(logger).toBeDefined();
  });
});

describe("security: admin and SSRF controls", () => {
  it("uses constant-time comparison for secrets", () => {
    const key = "test-admin-key";
    expect(constantTimeEqual(key, key)).toBe(true);
    expect(constantTimeEqual(key, "wrong-key-value-here")).toBe(false);
  });

  it("rejects arbitrary provider URLs", () => {
    expect(isAllowedProviderHost("https://metadata.internal/latest")).toBe(false);
    expect(isAllowedProviderHost("https://raider.io/api/v1/characters/profile")).toBe(true);
  });
});
