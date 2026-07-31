import { describe, expect, it } from "vitest";
import {
  refreshCharacterJobSchema,
  analyzeRunJobSchema,
  recalculateScoreJobSchema,
  generateAddonExportJobSchema,
  bulkCharacterProcessingInputSchema,
  bulkOrchestratorJobSchema,
  dedupeCharacterIdsPreservingOrder,
} from "./jobs.js";

describe("job payload schemas", () => {
  it("validates RefreshCharacterJob", () => {
    const parsed = refreshCharacterJobSchema.parse({
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Example",
      requestedAt: new Date().toISOString(),
      correlationId: "req-123",
    });
    expect(parsed.priority).toBe("normal");
    expect(parsed.forceRefresh).toBe(false);
    expect(parsed.correlationId).toBe("req-123");
  });

  it("rejects oversized identity fields on RefreshCharacterJob", () => {
    expect(() =>
      refreshCharacterJobSchema.parse({
        region: "EU",
        realmSlug: "x".repeat(65),
        name: "Example",
        requestedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("validates AnalyzeRunJob", () => {
    const parsed = analyzeRunJobSchema.parse({
      runId: "11111111-1111-1111-1111-111111111111",
      characterId: "22222222-2222-2222-2222-222222222222",
      selectionKind: "LATEST",
      analysisVersion: "1",
      requestedAt: new Date().toISOString(),
    });
    expect(parsed.selectionKind).toBe("LATEST");
  });

  it("validates RecalculateScoreJob and GenerateAddonExportJob", () => {
    recalculateScoreJobSchema.parse({
      characterId: "22222222-2222-2222-2222-222222222222",
      seasonId: "33333333-3333-3333-3333-333333333333",
      scoreModelKey: "default",
      scoreModelVersion: 1,
      requestedAt: new Date().toISOString(),
    });
    generateAddonExportJobSchema.parse({
      region: "EU",
      seasonId: "33333333-3333-3333-3333-333333333333",
      scoreModelKey: "default",
      scoreModelVersion: 1,
      requestedAt: new Date().toISOString(),
    });
    expect(true).toBe(true);
  });

  it("validates BulkCharacterProcessingInput and BulkOrchestratorJob", () => {
    const parsed = bulkCharacterProcessingInputSchema.parse({
      mode: "RECALCULATE_ONLY",
      minMythicPlusScore: null,
      batchSize: 25,
    });
    expect(parsed.dryRun).toBe(false);
    expect(parsed.allowFullRefreshOnIncompatible).toBe(false);
    expect(parsed.characterIds).toBeNull();
    bulkOrchestratorJobSchema.parse({
      bulkOperationId: "44444444-4444-4444-4444-444444444444",
      requestedAt: new Date().toISOString(),
    });
  });

  it("accepts explicit characterIds and rejects ambiguous cohort filters", () => {
    const idA = "11111111-1111-4111-8111-111111111111";
    const idB = "22222222-2222-4222-8222-222222222222";
    const parsed = bulkCharacterProcessingInputSchema.parse({
      mode: "FULL_REFRESH",
      minMythicPlusScore: null,
      characterIds: [idA, idB, idA],
    });
    expect(parsed.characterIds).toEqual([idA, idB]);

    expect(() =>
      bulkCharacterProcessingInputSchema.parse({
        mode: "FULL_REFRESH",
        minMythicPlusScore: 2000,
        characterIds: [idA],
      }),
    ).toThrow(/minMythicPlusScore/);

    expect(() =>
      bulkCharacterProcessingInputSchema.parse({
        mode: "FULL_REFRESH",
        minMythicPlusScore: null,
        maxCharacters: 10,
        characterIds: [idA],
      }),
    ).toThrow(/maxCharacters/);

    expect(() =>
      bulkCharacterProcessingInputSchema.parse({
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: null,
        characterIds: [],
      }),
    ).toThrow(/non-empty array/);

    const exactly500 = Array.from({ length: 500 }, (_, i) => {
      const hex = i.toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${hex}`;
    });
    expect(
      bulkCharacterProcessingInputSchema.parse({
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: null,
        characterIds: exactly500,
      }).characterIds,
    ).toHaveLength(500);

    const tooMany = Array.from({ length: 501 }, (_, i) => {
      const hex = i.toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${hex}`;
    });
    expect(() =>
      bulkCharacterProcessingInputSchema.parse({
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: null,
        characterIds: tooMany,
      }),
    ).toThrow();
  });

  it("dedupeCharacterIdsPreservingOrder keeps the first input position", () => {
    const idA = "11111111-1111-4111-8111-111111111111";
    const idB = "22222222-2222-4222-8222-222222222222";
    const idC = "33333333-3333-4333-8333-333333333333";
    expect(dedupeCharacterIdsPreservingOrder([idB, idA, idB, idC, idA])).toEqual([idB, idA, idC]);
  });
});
