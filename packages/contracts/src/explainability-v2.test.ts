import { describe, expect, it } from "vitest";
import {
  assertNoPublicReportCodes,
  buildPublicFromAdmin,
  looksLikeReportCode,
  sanitizeExplainabilityJson,
  type ScoreExplainabilityV2AdminDTO,
} from "./explainability-v2.js";

function sampleAdmin(): Omit<ScoreExplainabilityV2AdminDTO, "publicView"> {
  return {
    schemaVersion: "2.0.0",
    characterId: "char-1",
    seasonId: "season-1",
    seasonSlug: "season-midnight-s1",
    modelKey: "default",
    modelVersion: 6,
    dataAsOf: "2026-08-01T00:00:00.000Z",
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    manifestId: "manifest-1",
    manifestContentHash: "abc123",
    coverageState: "PARTIAL",
    expectedSlotCount: 16,
    selectedSlotCount: 10,
    matrix: [
      {
        dungeonSlug: "ara-kara",
        slotIndex: 0,
        state: "SELECTED",
        keyLevel: 12,
        reportCode: "AbCdEfGhIjKlMnOp",
        fightId: 3,
        reportRevision: 1,
        candidateRank: 0,
        selectionReason: "preferred",
      },
    ],
    selectedRuns: [
      {
        slotId: "slot-1",
        dungeonSlug: "ara-kara",
        slotIndex: 0,
        keyLevel: 12,
        timed: true,
        state: "SELECTED",
        hasWclSource: true,
        reportCode: "AbCdEfGhIjKlMnOp",
        fightId: 3,
        reportRevision: 1,
        selectionReason: "preferred",
        candidateRank: 0,
      },
    ],
    rejectedCandidates: [
      {
        reportCode: "ZyXwVuTsRqPoNmLk",
        fightId: 9,
        reportRevision: null,
        dungeonSlug: "ara-kara",
        reason: "PRIVATE_OR_HIDDEN",
        detail: "hidden",
      },
    ],
    datasets: [],
    factSets: [],
    dimensions: [
      {
        dimension: "UTILITY",
        score: 62,
        confidence: 0.7,
        lifecycleState: "SHADOW",
        availabilityState: "PARTIAL",
        algorithmVersion: "utility-v2-phase1-observed-0.1.0",
        inputFingerprint: "fp-u",
        computedAt: "2026-08-01T00:00:00.000Z",
        metrics: {
          availabilityState: "PARTIAL",
          domainBreakdowns: [{ domain: "castStops", score: 70 }],
          limitations: ["partial_slots"],
        },
        explanation: {
          mode: "OBSERVED_CONTRIBUTION",
          notes: ["Observed contribution only."],
          selectedRuns: [{ reportCode: "AbCdEfGhIjKlMnOp", fightId: 3 }],
        },
      },
      {
        dimension: "PERFORMANCE",
        score: null,
        confidence: 0,
        lifecycleState: "SHADOW",
        availabilityState: "UNAVAILABLE",
        algorithmVersion: "performance-v2",
        inputFingerprint: "fp-p",
        computedAt: "2026-08-01T00:00:00.000Z",
        metrics: { availabilityState: "UNAVAILABLE" },
        explanation: { mode: "unavailable" },
      },
    ],
    batchQueue: null,
    comparison: { v1: null, v2: null },
    calibrationLinks: [{ label: "Calibration", href: "/admin/calibration" }],
  };
}

describe("explainability-v2 contracts", () => {
  it("detects WCL-like report codes", () => {
    expect(looksLikeReportCode("AbCdEfGhIjKl12Op")).toBe(true);
    expect(looksLikeReportCode("ara-kara")).toBe(false);
  });

  it("strips report codes and sensitive keys for public sanitization", () => {
    const sanitized = sanitizeExplainabilityJson(
      {
        reportCode: "AbCdEfGhIjKlMnOp",
        accessToken: "secret",
        dungeonSlug: "ara-kara",
        nested: { report_code: "ZyXwVuTsRqPoNmLk", ok: true },
      },
      { stripReportCodes: true },
    ) as Record<string, unknown>;
    expect(sanitized.reportCode).toBeNull();
    expect(sanitized.accessToken).toBeNull();
    expect(sanitized.dungeonSlug).toBe("ara-kara");
    expect((sanitized.nested as Record<string, unknown>).report_code).toBeNull();
    expect((sanitized.nested as Record<string, unknown>).ok).toBe(true);
  });

  it("builds public DTO without report codes and with Utility semantics + grade U", () => {
    const publicDto = buildPublicFromAdmin(sampleAdmin());
    assertNoPublicReportCodes(publicDto);
    expect(JSON.stringify(publicDto)).not.toContain("AbCdEfGhIjKlMnOp");
    expect(publicDto.coverage.publicationState).toBe("SHADOW");
    expect(publicDto.coverage.provisional).toBe(false);
    expect(publicDto.coverage.unavailable).toBe(true);
    expect(publicDto.gradeUMeans).toBe("unavailable_or_unranked");
    expect(publicDto.selectedRuns[0]?.hasWclSource).toBe(true);
    expect(publicDto.selectedRuns[0]?.keyLevel).toBe(12);
    expect((publicDto.selectedRuns[0] as { reportCode?: unknown }).reportCode).toBeUndefined();

    const utility = publicDto.dimensions.find((d) => d.dimension === "UTILITY");
    expect(utility?.utilitySemantics?.mode).toBe("OBSERVED_CONTRIBUTION");
    expect(utility?.gradeU).toBe(false);

    const performance = publicDto.dimensions.find((d) => d.dimension === "PERFORMANCE");
    expect(performance?.gradeU).toBe(true);
    expect(performance?.score).toBeNull();
  });
});
