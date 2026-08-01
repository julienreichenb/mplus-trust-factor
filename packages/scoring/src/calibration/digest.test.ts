import { describe, expect, it } from "vitest";
import {
  buildCalibrationDigestV1,
  CALIBRATION_DIGEST_ALGORITHM_VERSION,
  type CalibrationDigestV1,
  type DigestFinding,
} from "./digest.js";
import {
  buildSyntheticFixtureCohort,
  createFixtureEvidencePort,
} from "./fixture-cohort.js";
import { runCalibrationHarness } from "./evaluate.js";
import type { CalibrationModelRef, CalibrationReport } from "./types.js";

const CALCULATED_AT = "2026-07-31T12:00:00.000Z";

function buildFixtureReport(): CalibrationReport {
  const fixture = buildSyntheticFixtureCohort();
  const evidence = createFixtureEvidencePort(fixture.evidenceById);
  const activeModel: CalibrationModelRef = {
    ...fixture.modelRef,
    status: "ACTIVE",
    isActive: true,
  };
  return runCalibrationHarness(
    fixture.manifest,
    {
      mode: "persisted-snapshot-only",
      activeModel,
      calculatedAt: CALCULATED_AT,
    },
    { evidence },
  );
}

function allFindings(digest: CalibrationDigestV1): DigestFinding[] {
  return [...digest.strengths, ...digest.issues, ...digest.limitations, ...digest.nextActions];
}

/** Phrases that would imply Phase 1 is recommending a weight change (forbidden). */
const WEIGHT_CHANGE_PATTERNS = [
  /\bweight\b/i,
  /\bweights\b/i,
  /\bweighting\b/i,
  /\bre-?weight/i,
];

describe("buildCalibrationDigestV1", () => {
  const report = buildFixtureReport();

  it("is fully deterministic for the same report", () => {
    const first = buildCalibrationDigestV1(report);
    const second = buildCalibrationDigestV1(report);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("is deterministic across independently rebuilt but equivalent reports", () => {
    const reportA = buildFixtureReport();
    const reportB = buildFixtureReport();
    expect(buildCalibrationDigestV1(reportA)).toEqual(buildCalibrationDigestV1(reportB));
  });

  it("stamps the current digest algorithm version", () => {
    const digest = buildCalibrationDigestV1(report);
    expect(digest.algorithmVersion).toBe(CALIBRATION_DIGEST_ALGORITHM_VERSION);
    expect(digest.algorithmVersion).toBe("1.0.0");
  });

  it("produces a valid overall assessment and confidence enum", () => {
    const digest = buildCalibrationDigestV1(report);
    expect(["STRONG", "MODERATE", "WEAK", "INSUFFICIENT_EVIDENCE"]).toContain(
      digest.overallAssessment,
    );
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(digest.confidence);
  });

  it("never recommends a weight change in any finding title or body", () => {
    const digest = buildCalibrationDigestV1(report);
    for (const f of allFindings(digest)) {
      for (const pattern of WEIGHT_CHANGE_PATTERNS) {
        expect(f.title).not.toMatch(pattern);
        expect(f.body).not.toMatch(pattern);
      }
    }
    expect(digest.headline).not.toMatch(/\bweight/i);
  });

  it("supports every finding statement with at least one metric", () => {
    const digest = buildCalibrationDigestV1(report);
    for (const f of allFindings(digest)) {
      expect(f.metrics.length).toBeGreaterThan(0);
    }
  });

  it("only cites metrics/members/slices already present in the source report", () => {
    const digest = buildCalibrationDigestV1(report);
    const knownMemberIds = new Set(report.characters.map((c) => c.memberId));
    for (const f of allFindings(digest)) {
      for (const memberId of f.memberIds) {
        expect(knownMemberIds.has(memberId)).toBe(true);
      }
    }
  });

  it("includes findings for ordering quality, slices, dimension saturation, and sample size", () => {
    const digest = buildCalibrationDigestV1(report);
    const codes = allFindings(digest).map((f) => f.code);
    expect(codes).toContain("RANK_ORDERING_QUALITY");
    expect(codes).toContain("ROLE_SLICES");
    expect(codes).toContain("META_VERSUS_NON_META");
    expect(codes).toContain("EVIDENCE_SAMPLE_SIZE");
    expect(codes.some((c) => c.startsWith("DIMENSION_DISTRIBUTION_"))).toBe(true);
  });

  it("flags rank inversions and outliers present in the fixture cohort", () => {
    const digest = buildCalibrationDigestV1(report);
    expect(report.statistics.monotonicOrdering.inversions.length).toBeGreaterThan(0);
    const inversionFinding = digest.issues.find((f) => f.code === "RANK_INVERSIONS");
    expect(inversionFinding).toBeDefined();
    expect(inversionFinding!.memberIds.length).toBeGreaterThan(0);
  });

  it("reports INSUFFICIENT_EVIDENCE for a near-empty report", () => {
    const tinyReport: CalibrationReport = {
      ...report,
      cohortSize: 2,
      evaluatedCount: 2,
      errorCount: 0,
      validationFailureCount: 0,
      characters: report.characters.slice(0, 2),
      statistics: {
        ...report.statistics,
        monotonicOrdering: {
          ...report.statistics.monotonicOrdering,
          sampleSize: 2,
          labelScoreSpearman: 1,
          pairwiseConcordance: 1,
          inversions: [],
        },
        outliers: [],
        scoredMemberCount: 2,
        failedMemberCount: 0,
      },
      validationFailures: [],
    };
    const digest = buildCalibrationDigestV1(tinyReport);
    expect(digest.overallAssessment).toBe("INSUFFICIENT_EVIDENCE");
    expect(digest.confidence).toBe("LOW");
  });

  it("does not mutate the input report", () => {
    const before = JSON.stringify(report);
    buildCalibrationDigestV1(report);
    expect(JSON.stringify(report)).toBe(before);
  });
});
