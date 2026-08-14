/**
 * Assert Scoring V2 control-center OpenAPI response schemas reject unexpected properties.
 */
import { describe, expect, it } from "vitest";
import {
  concurrencyDtoSchema,
  concurrencyLaneSchema,
  evidenceExportDtoSchema,
  evidenceExportSummaryDtoSchema,
  freezeBundleResponseSchema,
  historyListSchema,
  listExportsSchema,
  overviewSchema,
  ScoringIssueSchema,
} from "./scoring-control-center-schemas.js";

function assertNoAdditionalProps(schema: { additionalProperties?: unknown }, label: string) {
  expect(schema.additionalProperties, label).toBe(false);
}

describe("scoring-control-center OpenAPI schema strictness (M5)", () => {
  it("sets additionalProperties false on control-center response schemas", () => {
    assertNoAdditionalProps(ScoringIssueSchema, "ScoringIssueSchema");
    assertNoAdditionalProps(concurrencyLaneSchema, "concurrencyLaneSchema");
    assertNoAdditionalProps(concurrencyDtoSchema, "concurrencyDtoSchema");
    assertNoAdditionalProps(evidenceExportDtoSchema, "evidenceExportDtoSchema");
    assertNoAdditionalProps(overviewSchema, "overviewSchema");
    assertNoAdditionalProps(listExportsSchema, "listExportsSchema");
    assertNoAdditionalProps(historyListSchema, "historyListSchema");
    assertNoAdditionalProps(freezeBundleResponseSchema, "freezeBundleResponseSchema");
  });

  it("lists ScoringOverviewDTO exact top-level properties", () => {
    const props = Object.keys(overviewSchema.properties).sort();
    expect(props).toEqual(
      [
        "flags",
        "activeModel",
        "currentSeason",
        "detectedCurrentSeason",
        "effectiveScoringSeason",
        "scoringSeasonSelection",
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

  it("listExports items use summary DTO; history uses history items", () => {
    expect(listExportsSchema.properties.items.items).toBe(evidenceExportSummaryDtoSchema);
    expect(historyListSchema.properties.items.items).not.toBe(evidenceExportDtoSchema);
    assertNoAdditionalProps(evidenceExportSummaryDtoSchema, "evidenceExportSummaryDtoSchema");
    assertNoAdditionalProps(
      historyListSchema.properties.items.items as { additionalProperties?: unknown },
      "historyItemDtoSchema",
    );
  });
});

