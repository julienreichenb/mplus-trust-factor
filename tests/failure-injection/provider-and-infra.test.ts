import { describe, expect, it } from "vitest";
import {
  createInjectedProviderError,
  RedisConnectionFailure,
  ArtifactWriteFailure,
  DuplicateJobConflict,
  MigrationDryRunFailure,
  serveStaleOnRefreshFailure,
} from "@mplus/test-utils";
import { ExternalApiError } from "@mplus/contracts";
import { getMetricsRegistry, resetMetricsRegistry } from "@mplus/observability";

describe("failure injection: provider errors", () => {
  it("simulates Blizzard 429", () => {
    const err = createInjectedProviderError({
      provider: "blizzard",
      failure: "RATE_LIMITED",
    });
    expect(err).toBeInstanceOf(ExternalApiError);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(429);
  });

  it("simulates WCL budget at 90%", () => {
    resetMetricsRegistry();
    const err = createInjectedProviderError({
      provider: "warcraftlogs",
      failure: "BUDGET_EXCEEDED",
    });
    expect(err.code).toBe("BUDGET_EXCEEDED");
    const budget = getMetricsRegistry().computeWclBudgetSnapshot({
      pointsSpent: 900,
      hourlyLimit: 1000,
      warnPercent: 70,
      deferPercent: 80,
      stopPercent: 90,
    });
    expect(budget.shouldStop).toBe(true);
  });

  it("simulates Raider.IO disabled", () => {
    const err = createInjectedProviderError({
      provider: "raiderio",
      failure: "PROVIDER_DISABLED",
    });
    expect(err.statusCode).toBe(503);
  });

  it("simulates provider timeout", () => {
    const err = createInjectedProviderError({
      provider: "blizzard",
      failure: "TIMEOUT",
    });
    expect(err.code).toBe("TIMEOUT");
    expect(err.retryable).toBe(true);
  });

  it("simulates invalid report pagination response", () => {
    const err = createInjectedProviderError({
      provider: "warcraftlogs",
      failure: "INVALID_RESPONSE",
    });
    expect(err.code).toBe("INVALID_RESPONSE");
  });
});

describe("failure injection: infrastructure", () => {
  it("simulates Redis temporary loss", () => {
    expect(() => {
      throw new RedisConnectionFailure();
    }).toThrow(/Redis connection failed/);
  });

  it("simulates DB unique conflict on duplicate job", () => {
    const err = new DuplicateJobConflict("dedupe-key-abc");
    expect(err.dedupeKey).toBe("dedupe-key-abc");
  });

  it("simulates failed migration dry run", () => {
    expect(() => {
      throw new MigrationDryRunFailure();
    }).toThrow(/Migration dry run failed/);
  });

  it("simulates raw artifact write failure", () => {
    expect(() => {
      throw new ArtifactWriteFailure();
    }).toThrow(/artifact write failed/i);
  });

  it("serves stale score when refresh fails", () => {
    const result = serveStaleOnRefreshFailure({ overallScore: 72, grade: "B" });
    expect(result.refreshFailed).toBe(true);
    expect(result.stale.overallScore).toBe(72);
  });
});
