import { describe, expect, it, vi } from "vitest";
import {
  OBS_EVENTS,
  buildScoringV2LogContext,
  emitScoringV2Event,
  evaluateReadiness,
  fingerprintIdentifier,
  getMetricsRegistry,
  recordAdmissionDecision,
  recordDatasetOutcome,
  recordManifestCoverage,
  recordPublicationDecision,
  recordSlotOutcome,
  requiredProbesForModes,
  resetMetricsRegistry,
  sanitizeSensitiveDeep,
} from "./index.js";

describe("scoring v2 events", () => {
  it("exports normative scoring_v2.* event names", () => {
    expect(OBS_EVENTS.scoringV2DiscoveryStarted).toBe("scoring_v2.discovery_started");
    expect(OBS_EVENTS.scoringV2ManifestFrozen).toBe("scoring_v2.manifest_frozen");
    expect(OBS_EVENTS.scoringV2AdmissionDeferred).toBe("scoring_v2.admission_deferred");
    expect(OBS_EVENTS.scoringV2SlotFailed).toBe("scoring_v2.slot_failed");
    expect(OBS_EVENTS.scoringV2DatasetTruncated).toBe("scoring_v2.dataset_truncated");
    expect(OBS_EVENTS.scoringV2BatchFinalized).toBe("scoring_v2.batch_finalized");
    expect(OBS_EVENTS.scoringV2PublicationRejected).toBe("scoring_v2.publication_rejected");
    expect(OBS_EVENTS.scoringV2CalibrationCompleted).toBe("scoring_v2.calibration_completed");
    expect(OBS_EVENTS.scoringV2ReferenceSliceStateChanged).toBe(
      "scoring_v2.reference_slice_state_changed",
    );
  });

  it("fingerprints character ids and redacts character names in log context", () => {
    const characterId = "00000000-0000-4000-8000-000000000099";
    const ctx = buildScoringV2LogContext({
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
    emitScoringV2Event(
      { info, warn: vi.fn(), error: vi.fn() },
      OBS_EVENTS.scoringV2SlotStarted,
      { characterId: "char-1", slotId: "slot-a", characterName: "SecretName" },
    );
    expect(info).toHaveBeenCalledOnce();
    const payload = info.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.event).toBe("scoring_v2.slot_started");
    expect(JSON.stringify(payload)).not.toContain("SecretName");
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
    recordDatasetOutcome({ outcome: "cache_hit", datasetKey: "casts", wclPoints: 2 });
    recordAdmissionDecision("deferred");
    recordPublicationDecision("rejected", "publication_flag_off");
    const text = getMetricsRegistry().toPrometheusText();
    expect(text).toContain("scoring_v2_manifest_coverage_total");
    expect(text).toContain("scoring_v2_slot_outcome_total");
    expect(text).toContain("scoring_v2_dataset_outcome_total");
    expect(text).toContain("scoring_v2_admission_total");
    expect(text).toContain("scoring_v2_publication_total");
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
      scoringV2: baseModes,
      databaseOk: true,
      redisOk: true,
      redisSkipped: true,
      queueMode: "inline",
      artifactBackend: { ok: true, scheme: "cas", required: false },
      wclSnapshot: { state: "not_required", required: false },
      modelCatalog: { ok: true, required: false },
      wclProvider: { enabled: false, configured: false, required: false },
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
      scoringV2: modes,
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
      wclProvider: { enabled: true, configured: true, required: true },
    });
    expect(result.ready).toBe(false);
    expect(result.failingReasons).toContain("artifact_backend_not_ready");
  });

  it("does not fail readiness for stale WCL snapshot when not required", () => {
    const result = evaluateReadiness({
      revision: "abc123",
      apiContractVersion: "2.0.0",
      workerJobSchemaVersion: "2.0.0",
      scoringV2: baseModes,
      databaseOk: true,
      redisOk: true,
      redisSkipped: false,
      queueMode: "bullmq",
      artifactBackend: { ok: true, scheme: "cas", required: false },
      wclSnapshot: { state: "stale", required: false, ageSeconds: 999 },
      modelCatalog: { ok: true, required: false },
      wclProvider: { enabled: true, configured: true, required: false },
    });
    expect(result.ready).toBe(true);
  });
});

describe("character name sanitization", () => {
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
});
