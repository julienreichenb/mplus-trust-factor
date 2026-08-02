import { describe, expect, it } from "vitest";
import { assertNoPublicReportCodes } from "@mplus/contracts";
import { buildExplainabilityV2Admin, toPublicExplainabilityV2 } from "./build.js";

describe("buildExplainabilityV2Admin", () => {
  it("builds admin matrix/candidates/datasets/fact-sets and hides shadow from public", () => {
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
          reportCode: "AbCdEfGhIjKlMnOp",
          fightId: 1,
          reportRevision: 2,
          candidateRank: 0,
          selectionReason: "preferred",
          providerDataAsOf: "2026-08-01T11:00:00.000Z",
        },
        {
          dungeonSlug: "ara-kara",
          slotIndex: 1,
          state: "SELECTED",
          keyLevel: 12,
          timed: false,
          reportCode: "ZyXwVuTsRqPoNmLk",
          fightId: 2,
          reportRevision: 1,
          candidateRank: 1,
          selectionReason: "fallback",
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
          facts: { deaths: [{ t: 1 }], rawEvents: [1, 2, 3] },
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
        {
          dimension: "UTILITY",
          score: 55,
          confidence: 0.6,
          state: "SHADOW",
          algorithmVersion: "utility-v2",
          inputFingerprint: "fp-u",
          computedAt: "2026-08-01T11:50:00.000Z",
          metrics: {
            availabilityState: "PARTIAL",
            domainBreakdowns: [{ domain: "support", score: 60 }],
          },
          explanation: { mode: "OBSERVED_CONTRIBUTION", notes: ["observed"] },
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

    expect(admin.matrix).toHaveLength(2);
    expect(admin.matrix[0]?.reportCode).toBe("AbCdEfGhIjKlMnOp");
    expect(admin.rejectedCandidates[0]?.detail).toBe("provider_error_redacted");
    expect(admin.datasets[0]?.truncated).toBe(true);
    expect(admin.factSets[0]?.factKeys).toEqual(["deaths", "rawEvents"]);
    expect(admin.factSets[0]).not.toHaveProperty("facts");
    expect(admin.batchQueue?.finalizationStatus).toBe("READY_TO_FINALIZE");
    expect(admin.comparison.v1?.overallScore).toBe(70);
    expect(admin.comparison.v2?.publicationState).toBe("SHADOW");
    expect(admin.calibrationLinks.length).toBeGreaterThan(0);
    expect(admin.dataAsOf).toBe("2026-08-01T11:00:00.000Z");

    assertNoPublicReportCodes(admin.publicView);
    expect(toPublicExplainabilityV2(admin)).toBeNull();
    expect(toPublicExplainabilityV2(admin, { allowShadowPublic: true })).not.toBeNull();
  });
});
