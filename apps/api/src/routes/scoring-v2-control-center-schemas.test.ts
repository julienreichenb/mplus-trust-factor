/**
 * Assert Scoring V2 control-center OpenAPI response schemas reject unexpected properties.
 */
import { describe, expect, it } from "vitest";
import {
  concurrencyDtoSchema,
  concurrencyLaneSchema,
  evidenceExportDtoSchema,
  freezeBundleResponseSchema,
  historyListSchema,
  listExportsSchema,
  overviewSchema,
  scoringV2IssueSchema,
} from "./scoring-v2-control-center-schemas.js";

function assertNoAdditionalProps(schema: { additionalProperties?: unknown }, label: string) {
  expect(schema.additionalProperties, label).toBe(false);
}

describe("scoring-v2-control-center OpenAPI schema strictness (M5)", () => {
  it("sets additionalProperties false on control-center response schemas", () => {
    assertNoAdditionalProps(scoringV2IssueSchema, "scoringV2IssueSchema");
    assertNoAdditionalProps(concurrencyLaneSchema, "concurrencyLaneSchema");
    assertNoAdditionalProps(concurrencyDtoSchema, "concurrencyDtoSchema");
    assertNoAdditionalProps(evidenceExportDtoSchema, "evidenceExportDtoSchema");
    assertNoAdditionalProps(overviewSchema, "overviewSchema");
    assertNoAdditionalProps(listExportsSchema, "listExportsSchema");
    assertNoAdditionalProps(historyListSchema, "historyListSchema");
    assertNoAdditionalProps(freezeBundleResponseSchema, "freezeBundleResponseSchema");
  });

  it("lists ScoringV2OverviewDTO exact top-level properties", () => {
    const props = Object.keys(overviewSchema.properties).sort();
    expect(props).toEqual(
      [
        "flags",
        "activeModel",
        "currentSeason",
        "queueCounts",
        "recentEvidenceExport",
        "recentFrozenBundle",
        "cohortReadiness",
        "concurrency",
        "blockers",
        "warnings",
        "applicationRevision",
        "generatedAt",
      ].sort(),
    );
  });

  it("keeps summary extensible while progress is strict", () => {
    expect(evidenceExportDtoSchema.properties.summary.additionalProperties).toBe(true);
    expect(evidenceExportDtoSchema.properties.progress.additionalProperties).toBe(false);
  });

  it("listExports items use evidenceExportDtoSchema; history uses history items", () => {
    expect(listExportsSchema.properties.items.items).toBe(evidenceExportDtoSchema);
    expect(historyListSchema.properties.items.items).not.toBe(evidenceExportDtoSchema);
    assertNoAdditionalProps(
      historyListSchema.properties.items.items as { additionalProperties?: unknown },
      "historyItemDtoSchema",
    );
  });
});
