import { describe, expect, it, vi } from "vitest";
import {
  OBS_EVENTS,
  boundOperationalReason,
  buildScoringLogContext,
  emitScoringEvent,
  evaluateReadiness,
  evaluateWclProviderUsability,
  fingerprintIdentifier,
  getMetricsRegistry,
  normalizeOperationalError,
  recordAdmissionDecision,
  recordDatasetOutcome,
  recordFinalizationRecovery,
  recordManifestCoverage,
  recordPublicationDecision,
  recordSlotOutcome,
  requiredProbesForModes,
  resetMetricsRegistry,
  runSafeTelemetry,
  sanitizeFreeText,
  sanitizeSensitiveDeep,
} from "./index.js";

describe("scoring v2 events", () => {
  it("exports normative scoring_v2.* event names", () => {
    expect(OBS_EVENTS.scoringDiscoveryStarted).toBe("scoring.discovery_started");
    expect(OBS_EVENTS.scoringManifestFrozen).toBe("scoring.manifest_frozen");
    expect(OBS_EVENTS.scoringAdmissionDeferred).toBe("scoring.admission_deferred");
    expect(OBS_EVENTS.scoringSlotFailed).toBe("scoring.slot_failed");
    expect(OBS_EVENTS.scoringDatasetTruncated).toBe("scoring.dataset_truncated");
    expect(OBS_EVENTS.scoringBatchFinalized).toBe("scoring.batch_finalized");
    expect(OBS_EVENTS.scoringPublicationRejected).toBe("scoring.publication_rejected");
    expect(OBS_EVENTS.scoringCalibrationCompleted).toBe("scoring.calibration_completed");
    expect(OBS_EVENTS.scoringReferenceSliceStateChanged).toBe(
      "scoring.reference_slice_state_changed",
    );
    expect(OBS_EVENTS.scoringFinalizationClaimReleased).toBe(
      "scoring.finalization_claim_released",
    );
  });

  it("fingerprints character ids and redacts character names in log context", () => {
    const characterId = "00000000-0000-4000-8000-000000000099";
    const ctx = buildScoringLogContext({
      characterId,
      characterName: "Wallidrixe",
      reportCode: "AbCdEfGhIjKlMn",
      analysisBatchId: "batch-1",
    });
    expect(ctx.characterIdFingerprint).toBe(fingerprintIdentifier(characterId));
    expect(ctx).not.toHaveProperty("characterId");
    expect(ctx.characterName).toBe("[Redacted]");
    expect(JSON.stringify(ctx)).not.toContain("Wallidrixe");
    expect(JSON.stringify(ctx)).not.toContain("AbCdEfGhIjKlMn");
  });

  it("emits structured events without raw identifiers", () => {
    const info = vi.fn();
    emitScoringEvent(
      { info, warn: vi.fn(), error: vi.fn() },
      OBS_EVENTS.scoringSlotStarted,
      { characterId: "char-1", slotId: "slot-a", characterName: "SecretName" },
    );
    expect(info).toHaveBeenCalledOnce();
    const payload = info.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.event).toBe("scoring.slot_started");
    expect(JSON.stringify(payload)).not.toContain("SecretName");
  });

  it("swallows logger exceptions so telemetry cannot fail jobs", () => {
    expect(() =>
      emitScoringEvent(
        {
          info: () => {
            throw new Error("logger_down");
          },
          warn: vi.fn(),
          error: vi.fn(),
        },
        OBS_EVENTS.scoringSlotCompleted,
        { slotId: "s1" },
      ),
    ).not.toThrow();
  });

  it("runSafeTelemetry does not recurse on failure", () => {
    let calls = 0;
    runSafeTelemetry(() => {
      calls += 1;
      throw new Error("boom");
    });
    expect(calls).toBe(1);
  });
});

describe("scoring v2 metrics", () => {
  it("records coverage, slots, datasets, admission, publication", () => {
    resetMetricsRegistry();
    recordManifestCoverage({
      coverageState: "COMPLETE",
      selectedSlotCount: 16,
      expectedSlotCount: 16,
      fallbackDepth: 1,
    });
    recordSlotOutcome("completed", "SUCCEEDED");
    recordSlotOutcome("unavailable", "UNAVAILABLE");
    recordSlotOutcome("cancelled", "CANCELLED");
    recordDatasetOutcome({ outcome: "cache_hit", datasetKey: "casts", wclPoints: 2 });
    recordAdmissionDecision("deferred");
    recordPublicationDecision("rejected", "publication_flag_off");
    recordFinalizationRecovery("claim_released");
    const text = getMetricsRegistry().toPrometheusText();
    expect(text).toContain("scoring_manifest_coverage_total");
    expect(text).toContain("scoring_slot_outcome_total");
    expect(text).toContain("scoring_dataset_outcome_total");
    expect(text).toContain("scoring_admission_total");
    expect(text).toContain("scoring_publication_total");
    expect(text).toContain("scoring_finalization_recovery_total");
    expect(text).not.toMatch(/batch-[0-9]/);
  });

  it("swallows metrics registry exceptions", () => {
    const original = getMetricsRegistry().incrementCounter.bind(getMetricsRegistry());
    getMetricsRegistry().incrementCounter = () => {
      throw new Error("metrics_down");
    };
    expect(() => recordSlotOutcome("failed", "FAILED")).not.toThrow();
    getMetricsRegistry().incrementCounter = original;
  });
});

describe("readiness evaluation", () => {
  const baseModes = {
    enabled: false,
    selectionEnabled: false,
    evidenceFetchEnabled: false,
    dimensionsEnabled: false,
    publicationEnabled: false,
    incompatibleReasons: [] as string[],
  };

  it("is ready when baseline probes pass and V2 is off", () => {
    const result = evaluateReadiness({
      revision: "abc123",
      apiContractVersion: "2.0.0",
      workerJobSchemaVersion: "2.0.0",
      scoring: baseModes,
      databaseOk: true,
      redisOk: true,
      redisSkipped: true,
      queueMode: "inline",
      artifactBackend: { ok: true, scheme: "cas", required: false },
      wclSnapshot: { state: "not_required", required: false },
      modelCatalog: { ok: true, required: false },
      wclProvider: {
        enabled: false,
        configured: false,
        required: false,
        usable: true,
      },
    });
    expect(result.ready).toBe(true);
    expect(result.body.revision).toBe("abc123");
    expect(result.failingReasons).toEqual([]);
  });

  it("fails artifact backend only when evidence fetch requires it", () => {
    const modes = { ...baseModes, enabled: true, evidenceFetchEnabled: true };
    const required = requiredProbesForModes(modes);
    expect(required.artifactBackend).toBe(true);

    const result = evaluateReadiness({
      revision: "abc123",
      apiContractVersion: "2.0.0",
      workerJobSchemaVersion: "2.0.0",
      scoring: modes,
      databaseOk: true,
      redisOk: true,
      redisSkipped: true,
      queueMode: "inline",
      artifactBackend: {
        ok: false,
        scheme: "cas",
        required: true,
        detail: "not_writable",
      },
      wclSnapshot: { state: "worker_owned", required: false },
      modelCatalog: { ok: true, required: false },
      wclProvider: {
        enabled: true,
        configured: true,
        required: true,
        usable: true,
      },
    });
    expect(result.ready).toBe(false);
    expect(result.failingReasons).toContain("artifact_backend_not_ready");
  });

  it("fails closed when WCL required but not usable even if enabled=false", () => {
    expect(
      evaluateWclProviderUsability({
        required: true,
        enabled: false,
        configured: true,
        providerMode: "live",
      }),
    ).toEqual({ usable: false, detail: "wcl_provider_disabled" });

    const result = evaluateReadiness({
      revision: "abc123",
      apiContractVersion: "2.0.0",
      workerJobSchemaVersion: "2.0.0",
      scoring: { ...baseModes, enabled: true, evidenceFetchEnabled: true },
      databaseOk: true,
      redisOk: true,
      redisSkipped: true,
      queueMode: "inline",
      artifactBackend: { ok: true, scheme: "cas", required: true },
      wclSnapshot: { state: "worker_owned", required: false },
      modelCatalog: { ok: true, required: false },
      wclProvider: {
        enabled: false,
        configured: true,
        required: true,
        usable: false,
        detail: "wcl_provider_disabled",
        providerMode: "live",
      },
    });
    expect(result.ready).toBe(false);
    expect(result.failingReasons).toContain("wcl_provider_disabled");
  });

  it("does not fail readiness for stale WCL snapshot when not required", () => {
    const result = evaluateReadiness({
      revision: "abc123",
      apiContractVersion: "2.0.0",
      workerJobSchemaVersion: "2.0.0",
      scoring: baseModes,
      databaseOk: true,
      redisOk: true,
      redisSkipped: false,
      queueMode: "bullmq",
      artifactBackend: { ok: true, scheme: "cas", required: false },
      wclSnapshot: { state: "stale", required: false, ageSeconds: 999 },
      modelCatalog: { ok: true, required: false },
      wclProvider: {
        enabled: true,
        configured: true,
        required: false,
        usable: true,
      },
    });
    expect(result.ready).toBe(true);
  });
});

describe("character name and free-text sanitization", () => {
  it("redacts characterName and bare name with realm", () => {
    const sanitized = sanitizeSensitiveDeep({
      characterName: "Myzouth",
      realm: "Archimonde",
      name: "Myzouth",
    }) as Record<string, unknown>;
    expect(sanitized.characterName).toBe("[Redacted]");
    expect(sanitized.name).toBe("[Redacted]");
    expect(JSON.stringify(sanitized)).not.toContain("Myzouth");
  });

  it("sanitizes nested Error objects and free-text reasons", () => {
    const err = new Error(
      "fetch failed https://www.warcraftlogs.com/api report=AbCdEfGhIjKlMnOp access_token=sekrit",
    );
    err.cause = new Error("Bearer tokencause1234567890 nested");
    const sanitized = sanitizeSensitiveDeep({ err, reason: err.message }) as {
      err: { message: string; cause: { message: string } };
      reason: string;
    };
    expect(JSON.stringify(sanitized)).not.toContain("AbCdEfGhIjKlMnOp");
    expect(JSON.stringify(sanitized)).not.toContain("sekrit");
    expect(JSON.stringify(sanitized)).not.toContain("https://www.warcraftlogs.com");
    expect(sanitized.err.message).not.toContain("Bearer tokencause");

    const normalized = normalizeOperationalError(err);
    expect(normalized.category).toBe("Error");
    expect(normalized.detail).not.toContain("sekrit");
    expect(boundOperationalReason(err.message)).not.toContain("sekrit");
    expect(sanitizeFreeText("CANCELLED")).toBe("CANCELLED");
  });
});
