import { describe, expect, it } from "vitest";
import {
  assertPublicExplainabilitySanitized,
  derivePublicationState,
} from "@mplus/contracts";
import { buildExplainabilityV2Admin, toPublicExplainabilityV2 } from "./build.js";

describe("buildExplainabilityV2Admin", () => {
  it("builds admin matrix and keeps SHADOW / UNAVAILABLE off the public gate", () => {
    const admin = buildExplainabilityV2Admin({
      characterId: "c1",
      seasonId: "s1",
      seasonSlug: "season-midnight-s1",
      modelKey: "default",
      modelVersion: 6,
      manifestId: "m1",
      manifestContentHash: "hash-1",
      coverageState: "FULL",
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      evidenceCutoffAt: "2026-08-01T12:00:00.000Z",
      slots: [
        {
          id: "slot-a",
          dungeonSlug: "ara-kara",
          slotIndex: 0,
          state: "SELECTED",
          keyLevel: 14,
          timed: true,
          reportCode: "AbCdEfGhIjKl12Op",
          fightId: 1,
          reportRevision: 2,
          candidateRank: 0,
          selectionReason: "preferred",
          providerDataAsOf: "2026-08-01T11:00:00.000Z",
        },
      ],
      rejectedCandidates: [
        {
          reportCode: "RejectedCode12345",
          fightId: 9,
          reportRevision: null,
          dungeonSlug: "eco-dome",
          reason: "WRONG_SPEC",
          detail: "Bearer secret-token",
        },
      ],
      datasets: [
        {
          datasetKey: "damageTaken",
          state: "READY",
          pageCount: 3,
          eventCount: 1200,
          truncated: true,
          pointsConsumed: 4.5,
          costSource: "wcl",
          schemaVersion: "1",
          fetchedAt: "2026-08-01T11:30:00.000Z",
        },
      ],
      factSets: [
        {
          id: "fs1",
          extractorFamily: "survival",
          extractorVersion: "1.0.0",
          schemaVersion: "1.0.0",
          inputFingerprint: "fp",
          computedAt: "2026-08-01T11:40:00.000Z",
          coverage: { deaths: true },
          limitations: ["truncated_dataset"],
          factKeys: ["deaths"],
        },
      ],
      dimensions: [
        {
          dimension: "SURVIVAL",
          score: 71,
          confidence: 0.8,
          state: "SHADOW",
          algorithmVersion: "survival-v2",
          inputFingerprint: "fp-s",
          computedAt: "2026-08-01T11:50:00.000Z",
          metrics: { availabilityState: "AVAILABLE" },
          explanation: { notes: ["ok"] },
        },
      ],
      batch: {
        id: "batch-1",
        finalizationStatus: "READY_TO_FINALIZE",
        expectedRunCount: 16,
        terminalRunCount: 10,
        successfulRunCount: 8,
        unavailableRunCount: 1,
        failedRunCount: 1,
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-01T11:00:00.000Z",
        finalizedAt: null,
        evidenceManifestId: "m1",
      },
      v1Snapshot: {
        overallScore: 70,
        grade: "B",
        confidence: 0.75,
        modelKey: "default",
        modelVersion: 6,
        dimensions: [{ dimension: "SURVIVAL", score: 68, confidence: 0.7, state: "AVAILABLE" }],
      },
    });

    expect(admin.matrix[0]?.reportCode).toBe("AbCdEfGhIjKl12Op");
    expect(admin.rejectedCandidates[0]?.detail).toBe("provider_error_redacted");
    expect(admin.comparison.v2?.publicationState).toBe("SHADOW");
    expect(admin.publicView).toBeNull();
    expect(toPublicExplainabilityV2(admin)).toBeNull();
  });

  it("uses canonical publication derivation for PUBLISHED and PROVISIONAL", () => {
    const published = buildExplainabilityV2Admin({
      characterId: "c1",
      seasonId: "s1",
      seasonSlug: "season-midnight-s1",
      modelKey: "default",
      modelVersion: 6,
      manifestId: "m1",
      manifestContentHash: "hash-1",
      coverageState: "STRONG",
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      evidenceCutoffAt: "2026-08-01T12:00:00.000Z",
      slots: [
        {
          dungeonSlug: "ara-kara",
          slotIndex: 0,
          state: "SELECTED",
          keyLevel: 12,
          reportCode: "AbCdEfGhIjKl12Op",
          fightId: 1,
          reportRevision: 1,
        },
      ],
      rejectedCandidates: [],
      datasets: [],
      factSets: [],
      dimensions: [
        {
          dimension: "PERFORMANCE",
          score: 80,
          confidence: 0.9,
          state: "PUBLISHED",
          algorithmVersion: "performance-v2",
          inputFingerprint: "fp",
          computedAt: "2026-08-01T11:50:00.000Z",
          metrics: { availabilityState: "AVAILABLE" },
          explanation: {
            topContributors: [
              { key: "z.last", score: 40 },
              { key: "a.first", score: 90 },
            ],
          },
        },
      ],
      batch: null,
      v1Snapshot: null,
    });

    expect(published.comparison.v2?.publicationState).toBe("PUBLISHED");
    expect(published.publicView).not.toBeNull();
    assertPublicExplainabilitySanitized(published.publicView!);
    expect(published.publicView?.dimensions[0]?.topContributors.map((c) => c.key)).toEqual([
      "a.first",
      "z.last",
    ]);

    const provisionalState = derivePublicationState({
      coverageState: "PARTIAL",
      dimensions: ["PARTIAL"],
      lifecycleStates: ["PUBLISHED"],
    });
    expect(provisionalState).toBe("PROVISIONAL");
  });

  it("returns null public view for UNAVAILABLE coverage even with PUBLISHED lifecycle", () => {
    const admin = buildExplainabilityV2Admin({
      characterId: "c",
      seasonId: "s",
      seasonSlug: "season-midnight-s1",
      modelKey: null,
      modelVersion: null,
      manifestId: "m",
      manifestContentHash: "h",
      coverageState: "INSUFFICIENT",
      expectedSlotCount: 16,
      selectedSlotCount: 0,
      evidenceCutoffAt: null,
      slots: [],
      rejectedCandidates: [],
      datasets: [],
      factSets: [],
      dimensions: [
        {
          dimension: "PERFORMANCE",
          score: null,
          confidence: 0,
          state: "PUBLISHED",
          algorithmVersion: "performance-v2",
          inputFingerprint: "fp",
          computedAt: "2026-08-01T00:00:00.000Z",
          metrics: { availabilityState: "UNAVAILABLE" },
          explanation: {},
        },
      ],
      batch: null,
      v1Snapshot: null,
    });

    expect(admin.comparison.v2?.publicationState).toBe("UNAVAILABLE");
    expect(toPublicExplainabilityV2(admin)).toBeNull();
  });
});
