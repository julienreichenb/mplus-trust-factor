import { describe, expect, it } from "vitest";
import {
  ArtifactWriteFailure,
  CancellationInjectedError,
  ConcurrentFinalizationConflict,
  DbFailureAfterFetchError,
  RedisConnectionFailure,
  VersionSkewError,
  WorkerDeathAfterClaimError,
  createInjectedProviderError,
  detectRepeatedPaginationCursor,
} from "@mplus/test-utils";
import {
  OBS_EVENTS,
  evaluateReadiness,
  getMetricsRegistry,
  recordAdmissionDecision,
  recordPublicationDecision,
  resetMetricsRegistry,
  sanitizeSensitiveDeep,
} from "@mplus/observability";

describe("failure injection: scoring v2 hardening", () => {
  it("injects WCL 429 / 5xx / timeout / stale budget", () => {
    const rateLimited = createInjectedProviderError({
      provider: "warcraftlogs",
      failure: "RATE_LIMITED",
    });
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.retryable).toBe(true);

    const serverError = createInjectedProviderError({
      provider: "warcraftlogs",
      failure: "SERVER_ERROR",
    });
    expect(serverError.statusCode).toBe(503);
    expect(serverError.retryable).toBe(true);

    const timeout = createInjectedProviderError({
      provider: "warcraftlogs",
      failure: "TIMEOUT",
    });
    expect(timeout.code).toBe("TIMEOUT");

    const stale = createInjectedProviderError({
      provider: "warcraftlogs",
      failure: "STALE_BUDGET",
    });
    expect(stale.code).toBe("BUDGET_EXCEEDED");
    expect(stale.details).toMatchObject({ reason: "stale_budget_snapshot" });

    resetMetricsRegistry();
    const budget = getMetricsRegistry().computeWclBudgetSnapshot({
      pointsSpent: 950,
      hourlyLimit: 1000,
      warnPercent: 70,
      deferPercent: 80,
      stopPercent: 90,
    });
    expect(budget.shouldStop).toBe(true);
    recordAdmissionDecision("stopped");
    expect(getMetricsRegistry().toPrometheusText()).toContain("scoring_v2_admission_total");
  });

  it("detects pagination loops without duplicate spend", () => {
    const seen = new Set<string>(["cursor-a"]);
    expect(detectRepeatedPaginationCursor(seen, "cursor-a")).toBe(true);
    expect(detectRepeatedPaginationCursor(seen, "cursor-b")).toBe(false);
    const err = createInjectedProviderError({
      provider: "warcraftlogs",
      failure: "PAGINATION_LOOP",
    });
    expect(err.details).toMatchObject({ reason: "repeated_pagination_cursor" });
  });

  it("injects schema drift as SCHEMA_UNSUPPORTED", () => {
    const err = createInjectedProviderError({
      provider: "warcraftlogs",
      failure: "SCHEMA_UNSUPPORTED",
    });
    expect(err.code).toBe("SCHEMA_UNSUPPORTED");
    expect(err.retryable).toBe(false);
  });

  it("injects artifact / DB / Redis failures", () => {
    expect(() => {
      throw new ArtifactWriteFailure();
    }).toThrow(/artifact write failed/i);
    expect(() => {
      throw new DbFailureAfterFetchError();
    }).toThrow(/DB failure after provider fetch/i);
    expect(() => {
      throw new RedisConnectionFailure();
    }).toThrow(/Redis connection failed/);
  });

  it("injects worker death, cancellation, concurrent finalization, version skew", () => {
    expect(() => {
      throw new WorkerDeathAfterClaimError();
    }).toThrow(/terminated after slot claim/);
    expect(() => {
      throw new CancellationInjectedError();
    }).toThrow(/cancelled/i);
    expect(() => {
      throw new ConcurrentFinalizationConflict();
    }).toThrow(/Concurrent finalizer/);
    const skew = new VersionSkewError("2.0.0", "1.9.0");
    expect(skew.expected).toBe("2.0.0");
    expect(skew.actual).toBe("1.9.0");
  });

  it("records publication rejection and keeps readiness mode-conditional", () => {
    resetMetricsRegistry();
    recordPublicationDecision("rejected", "shadow_publication_blocked");
    expect(OBS_EVENTS.scoringV2PublicationRejected).toBe("scoring_v2.publication_rejected");

    const ready = evaluateReadiness({
      revision: "sha",
      apiContractVersion: "2.0.0",
      workerJobSchemaVersion: "2.0.0",
      scoringV2: {
        enabled: false,
        selectionEnabled: false,
        evidenceFetchEnabled: false,
        dimensionsEnabled: false,
        publicationEnabled: false,
        incompatibleReasons: [],
      },
      databaseOk: true,
      redisOk: false,
      redisSkipped: true,
      queueMode: "inline",
      artifactBackend: { ok: false, scheme: "cas", required: false },
      wclSnapshot: { state: "stale", required: false },
      modelCatalog: { ok: false, required: false },
      wclProvider: { enabled: true, configured: false, required: false, usable: true },
    });
    expect(ready.ready).toBe(true);
  });

  it("sanitizes provider payloads containing report codes and character names", () => {
    const sanitized = sanitizeSensitiveDeep({
      provider: "warcraftlogs",
      characterName: "Wallidrixe",
      payload: { reportCode: "SecretReport99", access_token: "tok" },
    }) as {
      characterName: string;
      payload: { reportCode: string; access_token: string };
    };
    expect(sanitized.characterName).toBe("[Redacted]");
    expect(sanitized.payload.access_token).toBe("[Redacted]");
    expect(JSON.stringify(sanitized)).not.toContain("Wallidrixe");
    expect(JSON.stringify(sanitized)).not.toContain("SecretReport99");
  });
});
