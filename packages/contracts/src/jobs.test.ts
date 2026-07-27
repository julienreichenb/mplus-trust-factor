import { describe, expect, it } from "vitest";
import {
  refreshCharacterJobSchema,
  analyzeRunJobSchema,
  recalculateScoreJobSchema,
  generateAddonExportJobSchema,
} from "./jobs.js";

describe("job payload schemas", () => {
  it("validates RefreshCharacterJob", () => {
    const parsed = refreshCharacterJobSchema.parse({
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Example",
      requestedAt: new Date().toISOString(),
    });
    expect(parsed.priority).toBe("normal");
    expect(parsed.forceRefresh).toBe(false);
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
});
