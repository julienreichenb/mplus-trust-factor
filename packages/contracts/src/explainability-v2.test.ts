import { describe, expect, it } from "vitest";
import {
  assertPublicExplainabilitySanitized,
  buildPublicFromAdmin,
  derivePublicationState,
  isPubliclyEmittablePublicationState,
  looksLikeReportCode,
  sanitizeExplainabilityJson,
  scoreExplainabilityV2PublicSchema,
  sortPublicContributors,
  type ScoreExplainabilityV2AdminDTO,
} from "./explainability-v2.js";

function sampleAdmin(
  overrides: Partial<Omit<ScoreExplainabilityV2AdminDTO, "publicView">> = {},
): Omit<ScoreExplainabilityV2AdminDTO, "publicView"> {
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
    manifestContentHash: "abc123hash",
    coverageState: "FULL",
    expectedSlotCount: 16,
    selectedSlotCount: 16,
    matrix: [],
    selectedRuns: [
      {
        slotId: "11111111-1111-4111-8111-111111111111",
        dungeonSlug: "ara-kara",
        slotIndex: 0,
        keyLevel: 12,
        timed: true,
        state: "SELECTED",
        hasWclSource: true,
        reportCode: "AbCdEfGhIjKl12Op",
        fightId: 3,
        reportRevision: 1,
        selectionReason: "preferred",
        candidateRank: 0,
      },
    ],
    rejectedCandidates: [],
    datasets: [],
    factSets: [],
    dimensions: [
      {
        dimension: "UTILITY",
        score: 62,
        confidence: 0.7,
        lifecycleState: "PUBLISHED",
        availabilityState: "AVAILABLE",
        algorithmVersion: "utility-v2-phase1-observed-0.1.0",
        inputFingerprint: "fp-u",
        computedAt: "2026-08-01T00:00:00.000Z",
        metrics: {
          availabilityState: "AVAILABLE",
          domainBreakdowns: [{ domain: "castStops", score: 70 }],
          limitations: ["shadow_placeholder", "fingerprint_mismatch"],
        },
        explanation: {
          mode: "OBSERVED_CONTRIBUTION",
          notes: ["Observed contribution only."],
        },
      },
      {
        dimension: "PERFORMANCE",
        score: 80,
        confidence: 0.8,
        lifecycleState: "PUBLISHED",
        availabilityState: "AVAILABLE",
        algorithmVersion: "performance-v2",
        inputFingerprint: "fp-p",
        computedAt: "2026-08-01T00:00:00.000Z",
        metrics: { availabilityState: "AVAILABLE" },
        explanation: {},
      },
    ],
    batchQueue: null,
    comparison: { v1: null, v2: null },
    calibrationLinks: [{ label: "Calibration", href: "/admin/calibration" }],
    ...overrides,
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
        reportCode: "AbCdEfGhIjKl12Op",
        accessToken: "secret",
        dungeonSlug: "ara-kara",
        nested: { report_code: "ZyXwVuTsRqPoNmLk", ok: true },
      },
      { stripReportCodes: true },
    ) as Record<string, unknown>;
    expect(sanitized.reportCode).toBeNull();
    expect(sanitized.accessToken).toBeNull();
    expect(sanitized.dungeonSlug).toBe("ara-kara");
  });

  it("fail-closes SHADOW / UNAVAILABLE / unpublished lifecycle", () => {
    expect(
      derivePublicationState({
        coverageState: "FULL",
        dimensions: ["AVAILABLE"],
        lifecycleStates: ["SHADOW"],
      }),
    ).toBe("SHADOW");
    expect(isPubliclyEmittablePublicationState("SHADOW")).toBe(false);

    expect(
      derivePublicationState({
        coverageState: "INSUFFICIENT",
        dimensions: ["UNAVAILABLE"],
        lifecycleStates: ["PUBLISHED"],
      }),
    ).toBe("UNAVAILABLE");
    expect(isPubliclyEmittablePublicationState("UNAVAILABLE")).toBe(false);

    expect(
      derivePublicationState({
        coverageState: "FULL",
        dimensions: ["AVAILABLE"],
        lifecycleStates: ["CANDIDATE"],
      }),
    ).toBe("UNAVAILABLE");

    expect(buildPublicFromAdmin(sampleAdmin({ coverageState: "INSUFFICIENT" }))).toBeNull();
    expect(
      buildPublicFromAdmin(
        sampleAdmin({
          dimensions: sampleAdmin().dimensions.map((d) => ({ ...d, lifecycleState: "SHADOW" })),
        }),
      ),
    ).toBeNull();
  });

  it("emits PUBLISHED and PROVISIONAL public DTOs without internal fields", () => {
    const published = buildPublicFromAdmin(sampleAdmin({ coverageState: "FULL" }));
    expect(published).not.toBeNull();
    expect(published?.coverage.publicationState).toBe("PUBLISHED");
    assertPublicExplainabilitySanitized(published!);
    const json = JSON.stringify(published);
    for (const needle of [
      "manifestContentHash",
      "manifestId",
      "scoreModelId",
      "inputFingerprint",
      "artifact",
      "reportCode",
      "fightId",
      "reportRevision",
      "rawFacts",
      "shadow_placeholder",
      "fingerprint_mismatch",
      "slotId",
      "11111111-1111-4111-8111-111111111111",
      "AbCdEfGhIjKl12Op",
    ]) {
      expect(json).not.toContain(needle);
    }
    expect(published).not.toHaveProperty("manifestContentHash");
    expect(published?.dimensions.find((d) => d.dimension === "UTILITY")?.utilitySemantics?.mode).toBe(
      "OBSERVED_CONTRIBUTION",
    );
    expect(published?.dimensions.find((d) => d.dimension === "UTILITY")?.limitations).toEqual([]);

    const provisional = buildPublicFromAdmin(sampleAdmin({ coverageState: "PARTIAL" }));
    expect(provisional?.coverage.publicationState).toBe("PROVISIONAL");
    expect(provisional?.coverage.provisional).toBe(true);
    assertPublicExplainabilitySanitized(provisional!);
  });

  it("sorts contributors deterministically regardless of input order", () => {
    const a = sortPublicContributors([
      { key: "b.metric", dimension: "PERFORMANCE", label: "b", score: 40, direction: "negative" },
      { key: "a.metric", dimension: "PERFORMANCE", label: "a", score: 90, direction: "positive" },
      { key: "c.metric", dimension: "PERFORMANCE", label: "c", score: 90, direction: "positive" },
    ]);
    const b = sortPublicContributors([
      { key: "c.metric", dimension: "PERFORMANCE", label: "c", score: 90, direction: "positive" },
      { key: "a.metric", dimension: "PERFORMANCE", label: "a", score: 90, direction: "positive" },
      { key: "b.metric", dimension: "PERFORMANCE", label: "b", score: 40, direction: "negative" },
    ]);
    expect(a.map((c) => c.key)).toEqual(b.map((c) => c.key));
    expect(a[0]?.key).toBe("a.metric");
    expect(a[1]?.key).toBe("c.metric");
    expect(a[2]?.key).toBe("b.metric");
  });

  it("rejects invalid lifecycle / availability / scores via Zod", () => {
    expect(
      scoreExplainabilityV2PublicSchema.safeParse({
        schemaVersion: "2.0.0",
        modelKey: "default",
        modelVersion: 6,
        dataAsOf: "2026-08-01T00:00:00.000Z",
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        coverage: {
          analyzedRunCount: 1,
          expectedRunCount: 1,
          representedDungeonCount: 1,
          expectedDungeonCount: 1,
          coverageState: "FULL",
          publicationState: "PUBLISHED",
          provisional: false,
          stale: false,
          unavailable: false,
        },
        selectedRuns: [],
        dimensions: [
          {
            dimension: "PERFORMANCE",
            score: Number.POSITIVE_INFINITY,
            confidence: 0.5,
            availabilityState: "AVAILABLE",
            gradeU: false,
            algorithmVersion: "perf",
            topContributors: [],
            limitations: [],
          },
        ],
        notes: ["ok"],
        gradeUMeans: "unavailable_or_unranked",
      }).success,
    ).toBe(false);

    expect(
      scoreExplainabilityV2PublicSchema.safeParse({
        schemaVersion: "2.0.0",
        modelKey: "default",
        modelVersion: 6,
        dataAsOf: "2026-08-01T00:00:00.000Z",
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        coverage: {
          analyzedRunCount: 1,
          expectedRunCount: 1,
          representedDungeonCount: 1,
          expectedDungeonCount: 1,
          coverageState: "FULL",
          publicationState: "PUBLISHED",
          provisional: false,
          stale: false,
          unavailable: false,
        },
        selectedRuns: [],
        dimensions: [
          {
            dimension: "PERFORMANCE",
            score: 50,
            confidence: 0.5,
            availabilityState: "NOT_A_STATE",
            gradeU: false,
            algorithmVersion: "perf",
            topContributors: [{ key: "", dimension: "PERFORMANCE", label: "x", score: null, direction: "neutral" }],
            limitations: [],
          },
        ],
        notes: ["ok"],
        gradeUMeans: "unavailable_or_unranked",
      }).success,
    ).toBe(false);
  });
});
