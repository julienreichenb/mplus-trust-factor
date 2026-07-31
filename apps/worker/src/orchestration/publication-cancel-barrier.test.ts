import { describe, expect, it, vi } from "vitest";
import { attemptPublication } from "./publication-flow.js";
import type { ScoreSnapshotDTO } from "@mplus/contracts";

const candidate = {
  characterId: "c1",
  seasonSlug: "blizzard-season-13",
  modelKey: "mplus-trust",
  modelVersion: 1,
  scopeType: "CHARACTER",
  scopeKey: null,
  overallScore: 50,
  grade: "C",
  skillScore: 50,
  authenticityScore: 50,
  confidence: 0.8,
  calculatedAt: new Date().toISOString(),
  inputFingerprint: "fp-1",
  dimensions: [],
  redFlags: [],
  explanation: { refreshContractHash: "hash-1" },
  availableModelWeight: 1,
  totalModelWeight: 1,
  modelCoverageRatio: 1,
  overallState: "DEFINITIVE",
  provisionalReason: null,
} as ScoreSnapshotDTO;

describe("atomic publication cancellation barrier", () => {
  it("refuses publish when cancel is injected inside the publication transaction", async () => {
    const publishOrRejectCandidate = vi.fn(async (input: { publicationGuard?: { ingestionJobId: string } }) => {
      expect(input.publicationGuard?.ingestionJobId).toBe("job-1");
      return {
        published: false,
        snapshot: null,
        cancelled: true,
        rejectionReason: "CANCELLED",
      };
    });
    const upsertObservations = vi.fn(async () => undefined);
    const getPublishedSnapshot = vi.fn(async () => null);

    const result = await attemptPublication({
      characterId: "c1",
      seasonId: "season-1",
      scoreModelId: "model-1",
      model: {
        key: "mplus-trust",
        version: 1,
        weights: { PERFORMANCE: 0.25, SURVIVAL: 0.25, UTILITY: 0.25, EXPERIENCE: 0.25 },
        authenticityBlend: { skillWeight: 0.5, authenticityWeight: 0.5 },
        gradeThresholds: { S: 90, A: 80, B: 70, C: 60 },
      } as never,
      candidate,
      incomingObservations: [],
      persistedObservations: [],
      failedDimensions: new Set(),
      refreshedMetricKeys: new Set(),
      refreshContractHash: "hash-1",
      providerDataAsOf: new Date(),
      scoreRepository: {
        publishOrRejectCandidate,
        getPublishedSnapshot,
      } as never,
      metricRepository: { upsertObservations } as never,
      publicationGuard: { ingestionJobId: "job-1" },
    });

    expect(result.cancelled).toBe(true);
    expect(result.published).toBe(false);
    expect(publishOrRejectCandidate).toHaveBeenCalled();
  });
});
