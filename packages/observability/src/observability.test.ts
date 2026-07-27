import { describe, expect, it } from "vitest";
import {
  createLogger,
  constantTimeEqual,
  escapeHtml,
  isAllowedProviderHost,
  getMetricsRegistry,
  resetMetricsRegistry,
} from "./index.js";

describe("observability security helpers", () => {
  it("compares admin keys in constant time", () => {
    expect(constantTimeEqual("secret-key", "secret-key")).toBe(true);
    expect(constantTimeEqual("secret-key", "secret-kez")).toBe(false);
  });

  it("escapes HTML in player names", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).not.toContain("<script>");
  });

  it("allowlists provider hosts only", () => {
    expect(isAllowedProviderHost("https://eu.api.blizzard.com/profile/wow/character/x/y")).toBe(
      true,
    );
    expect(isAllowedProviderHost("https://evil.example.com/steal")).toBe(false);
    expect(isAllowedProviderHost("http://raider.io/api")).toBe(false);
  });
});

describe("observability logging", () => {
  it("configures logger with secret redaction paths", () => {
    const logger = createLogger({ level: "silent" });
    expect(logger).toBeDefined();
  });
});

describe("metrics registry", () => {
  it("exports prometheus text format", () => {
    resetMetricsRegistry();
    const registry = getMetricsRegistry();
    registry.recordHttpRequest("/health/live", "GET", 200, 12);
    registry.recordProviderRequest({
      provider: "blizzard",
      endpointKey: "character.profile",
      statusCode: 200,
      durationMs: 45,
      cacheHit: true,
    });
    const text = registry.toPrometheusText();
    expect(text).toContain("http_requests_total");
    expect(text).toContain("provider_requests_total");
  });

  it("tracks WCL budget thresholds", () => {
    resetMetricsRegistry();
    const snapshot = getMetricsRegistry().computeWclBudgetSnapshot({
      pointsSpent: 900,
      hourlyLimit: 1000,
      warnPercent: 70,
      deferPercent: 80,
      stopPercent: 90,
    });
    expect(snapshot.shouldWarn).toBe(true);
    expect(snapshot.shouldDefer).toBe(true);
    expect(snapshot.shouldStop).toBe(true);
    expect(snapshot.pointsRemaining).toBe(100);
  });
});
