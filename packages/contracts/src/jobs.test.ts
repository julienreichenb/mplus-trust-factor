import { describe, expect, it } from "vitest";
import {
  refreshCharacterJobSchema,
  analyzeRunJobSchema,
  recalculateScoreJobSchema,
  generateAddonExportJobSchema,
  bulkCharacterProcessingInputSchema,
  bulkOrchestratorJobSchema,
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
    bulkOrchestratorJobSchema.parse({
      bulkOperationId: "44444444-4444-4444-4444-444444444444",
      requestedAt: new Date().toISOString(),
    });
  });
});
