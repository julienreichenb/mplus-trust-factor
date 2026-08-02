import { describe, expect, it } from "vitest";
import {
  assertNoPublicReportCodes,
  buildPublicFromAdmin,
  type ScoreExplainabilityV2AdminDTO,
} from "@mplus/contracts";
import { buildExplainabilityV2Admin, toPublicExplainabilityV2 } from "@mplus/scoring";

describe("explainability-v2 service semantics", () => {
  it("keeps report codes admin-only and blocks shadow from public GET attach", () => {
    const admin = buildExplainabilityV2Admin({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonId: "22222222-2222-2222-2222-222222222222",
      seasonSlug: "season-midnight-s1",
      modelKey: "default",
      modelVersion: 6,
      manifestId: "33333333-3333-3333-3333-333333333333",
      manifestContentHash: "content-hash",
      coverageState: "STRONG",
      expectedSlotCount: 16,
      selectedSlotCount: 14,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      slots: [
        {
          dungeonSlug: "ara-kara",
          slotIndex: 0,
          state: "SELECTED",
          keyLevel: 13,
          reportCode: "AbCdEfGhIjKlMnOp",
          fightId: 1,
          reportRevision: 1,
        },
      ],
      rejectedCandidates: [],
      datasets: [],
      factSets: [],
      dimensions: [
        {
          dimension: "UTILITY",
          score: 61,
          confidence: 0.55,
          state: "SHADOW",
          algorithmVersion: "utility-v2",
          inputFingerprint: "fp",
          computedAt: "2026-08-01T00:00:00.000Z",
          metrics: { availabilityState: "PARTIAL" },
          explanation: { mode: "OBSERVED_CONTRIBUTION", notes: ["observed contribution"] },
        },
      ],
      batch: null,
      v1Snapshot: null,
    });

    expect(admin.matrix[0]?.reportCode).toBe("AbCdEfGhIjKlMnOp");
    assertNoPublicReportCodes(admin.publicView);
    expect(toPublicExplainabilityV2(admin)).toBeNull();

    const forced = buildPublicFromAdmin(admin as Omit<ScoreExplainabilityV2AdminDTO, "publicView">);
    expect(forced.dimensions.find((d) => d.dimension === "UTILITY")?.utilitySemantics?.mode).toBe(
      "OBSERVED_CONTRIBUTION",
    );
    expect(forced.gradeUMeans).toBe("unavailable_or_unranked");
  });

  it("marks insufficient / unavailable dimensions as grade U without inventing zeros", () => {
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

    const pub = toPublicExplainabilityV2(admin);
    expect(pub).not.toBeNull();
    expect(pub?.coverage.unavailable).toBe(true);
    expect(pub?.dimensions[0]?.gradeU).toBe(true);
    expect(pub?.dimensions[0]?.score).toBeNull();
  });
});
