import { CALIBRATION_DIGEST_ALGORITHM_VERSION } from "@mplus/contracts";
import type {
  CalibrationDigestAssessment,
  CalibrationDigestConfidence,
  CalibrationDigestDTO,
  CalibrationDigestFindingDTO,
  CalibrationPreflightSeverity,
} from "@mplus/contracts";
import type { CalibrationReport, DimensionSaturationSummary, SliceSummary } from "./types.js";

export { CALIBRATION_DIGEST_ALGORITHM_VERSION };

/** Phase 1 deterministic digest — no LLM, no weight-change recommendations. */
export type CalibrationDigestV1 = CalibrationDigestDTO;
export type DigestFinding = CalibrationDigestFindingDTO;

const THRESHOLDS = {
  minSampleForAssessment: 5,
  minSampleForMediumConfidence: 8,
  minSampleForHighConfidence: 20,
  spearmanStrong: 0.7,
  spearmanModerate: 0.4,
  concordanceStrong: 0.75,
  concordanceModerate: 0.55,
  maxFailureRateHighConfidence: 0.1,
  maxFailureRateMediumConfidence: 0.25,
  smallSliceCount: 3,
  highFloorRate: 0.2,
  highSaturationRate: 0.2,
  highMissingRate: 0.2,
  lowConfidenceThreshold: 0.5,
  lowConfidenceFractionWarn: 0.25,
  maxListedInversions: 5,
  maxListedOutliers: 8,
} as const;

type Metric = { name: string; value: number | string | null };

function finding(params: {
  code: string;
  title: string;
  body: string;
  severity: CalibrationPreflightSeverity;
  metrics?: Metric[];
  memberIds?: string[];
  sliceKeys?: string[];
}): DigestFinding {
  return {
    code: params.code,
    title: params.title,
    body: params.body,
    severity: params.severity,
    metrics: params.metrics ?? [],
    memberIds: params.memberIds ?? [],
    sliceKeys: params.sliceKeys ?? [],
  };
}

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  return n.toFixed(digits);
}

function pct(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  return `${(n * 100).toFixed(digits)}%`;
}

function computeOverallAssessment(report: CalibrationReport): CalibrationDigestAssessment {
  const mo = report.statistics.monotonicOrdering;
  if (mo.sampleSize < THRESHOLDS.minSampleForAssessment) return "INSUFFICIENT_EVIDENCE";
  const spearman = mo.labelScoreSpearman;
  const concordance = mo.pairwiseConcordance;
  if (spearman == null || concordance == null) return "INSUFFICIENT_EVIDENCE";
  if (spearman >= THRESHOLDS.spearmanStrong && concordance >= THRESHOLDS.concordanceStrong) {
    return "STRONG";
  }
  if (spearman >= THRESHOLDS.spearmanModerate && concordance >= THRESHOLDS.concordanceModerate) {
    return "MODERATE";
  }
  return "WEAK";
}

function computeConfidence(report: CalibrationReport): CalibrationDigestConfidence {
  const scored = report.statistics.scoredMemberCount;
  const failureDenominator = report.evaluatedCount > 0 ? report.evaluatedCount : report.cohortSize;
  const failureRate =
    failureDenominator > 0
      ? (report.errorCount + report.validationFailureCount) / failureDenominator
      : 1;
  if (
    scored >= THRESHOLDS.minSampleForHighConfidence &&
    failureRate <= THRESHOLDS.maxFailureRateHighConfidence
  ) {
    return "HIGH";
  }
  if (
    scored >= THRESHOLDS.minSampleForMediumConfidence &&
    failureRate <= THRESHOLDS.maxFailureRateMediumConfidence
  ) {
    return "MEDIUM";
  }
  return "LOW";
}

function buildHeadline(report: CalibrationReport, assessment: CalibrationDigestAssessment): string {
  const mo = report.statistics.monotonicOrdering;
  const n = report.statistics.scoredMemberCount;
  switch (assessment) {
    case "INSUFFICIENT_EVIDENCE":
      return `Insufficient evidence: only ${n} of ${report.cohortSize} cohort member(s) produced a comparable score.`;
    case "STRONG":
      return `Strong agreement between expected ordering and observed scores across ${n} scored member(s) (Spearman ${fmt(mo.labelScoreSpearman)}).`;
    case "MODERATE":
      return `Moderate agreement between expected ordering and observed scores across ${n} scored member(s) (Spearman ${fmt(mo.labelScoreSpearman)}).`;
    case "WEAK":
    default:
      return `Weak or inconsistent agreement between expected ordering and observed scores across ${n} scored member(s) (Spearman ${fmt(mo.labelScoreSpearman)}).`;
  }
}

function buildOrderingFinding(report: CalibrationReport): DigestFinding {
  const mo = report.statistics.monotonicOrdering;
  const spearman = mo.labelScoreSpearman;
  const concordance = mo.pairwiseConcordance;
  let severity: CalibrationPreflightSeverity;
  let verdict: string;
  if (
    spearman == null ||
    concordance == null ||
    mo.sampleSize < THRESHOLDS.minSampleForAssessment
  ) {
    severity = "WARNING";
    verdict = "cannot be reliably assessed with the current sample";
  } else if (spearman >= THRESHOLDS.spearmanStrong && concordance >= THRESHOLDS.concordanceStrong) {
    severity = "INFO";
    verdict = "shows strong agreement with expected qualitative ordering";
  } else if (
    spearman >= THRESHOLDS.spearmanModerate &&
    concordance >= THRESHOLDS.concordanceModerate
  ) {
    severity = "INFO";
    verdict = "shows moderate agreement with expected qualitative ordering";
  } else {
    severity = "WARNING";
    verdict = "shows weak or inconsistent agreement with expected qualitative ordering";
  }
  return finding({
    code: "RANK_ORDERING_QUALITY",
    title: "Rank-ordering quality",
    body:
      `Observed scores ${verdict} (Spearman=${fmt(spearman)}, pairwise concordance=${fmt(concordance)}, ` +
      `pairwise discordance=${fmt(mo.pairwiseDiscordance)}, ties=${mo.pairwiseTies ?? "n/a"}, n=${mo.sampleSize}).`,
    severity,
    metrics: [
      { name: "monotonicOrdering.labelScoreSpearman", value: spearman },
      { name: "monotonicOrdering.pairwiseConcordance", value: concordance },
      { name: "monotonicOrdering.pairwiseDiscordance", value: mo.pairwiseDiscordance },
      { name: "monotonicOrdering.sampleSize", value: mo.sampleSize },
    ],
  });
}

function buildInversionsFinding(report: CalibrationReport): DigestFinding | null {
  const inversions = report.statistics.monotonicOrdering.inversions;
  if (inversions.length === 0) return null;
  const listed = inversions.slice(0, THRESHOLDS.maxListedInversions);
  const memberIds: string[] = [];
  for (const inv of listed) {
    if (!memberIds.includes(inv.higherExpectedId)) memberIds.push(inv.higherExpectedId);
    if (!memberIds.includes(inv.lowerExpectedId)) memberIds.push(inv.lowerExpectedId);
  }
  const details = listed
    .map(
      (inv) =>
        `${inv.higherExpectedId} (expected ${inv.higherExpectedLabel}, score ${fmt(inv.higherScore, 1)}) ` +
        `did not outrank ${inv.lowerExpectedId} (expected ${inv.lowerExpectedLabel}, score ${fmt(inv.lowerScore, 1)})`,
    )
    .join("; ");
  const severity: CalibrationPreflightSeverity =
    inversions.length >= THRESHOLDS.smallSliceCount ? "WARNING" : "INFO";
  return finding({
    code: "RANK_INVERSIONS",
    title: "Expected-label rank inversions",
    body:
      `${inversions.length} pair(s) of members scored in the opposite order from their expected labels` +
      (inversions.length > listed.length ? ` (top ${listed.length} shown)` : "") +
      `: ${details}.`,
    severity,
    metrics: [{ name: "monotonicOrdering.inversions.count", value: inversions.length }],
    memberIds,
  });
}

function buildOutliersFinding(report: CalibrationReport): DigestFinding | null {
  const outliers = report.statistics.outliers;
  if (outliers.length === 0) return null;
  const byReason = new Map<string, number>();
  for (const o of outliers) byReason.set(o.reason, (byReason.get(o.reason) ?? 0) + 1);
  const listed = outliers.slice(0, THRESHOLDS.maxListedOutliers);
  const metrics: Metric[] = [
    { name: "outliers.count", value: outliers.length },
    ...[...byReason.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, count]) => ({ name: `outliers.count.${reason}`, value: count })),
  ];
  return finding({
    code: "EXPECTED_VERSUS_ACTUAL_OUTLIERS",
    title: "Expected-versus-actual outliers",
    body:
      `${outliers.length} member(s) diverge notably from their expected label` +
      (outliers.length > listed.length ? ` (showing ${listed.length})` : "") +
      `: ${listed.map((o) => `${o.memberId} (${o.reason}, expected ${o.expectedLabel}, score ${fmt(o.actualScore, 1)})`).join("; ")}.`,
    severity: "WARNING",
    metrics,
    memberIds: listed.map((o) => o.memberId),
  });
}

function buildSliceSummaryFinding(code: string, title: string, slices: SliceSummary[]): DigestFinding {
  const nonEmpty = slices.filter((s) => s.count > 0);
  const body =
    nonEmpty.length === 0
      ? "No members in any slice."
      : `${nonEmpty
          .map(
            (s) =>
              `${s.key}: n=${s.count}, scored=${s.scoredCount}, meanScore=${fmt(s.meanScore, 1)}, meanConfidence=${fmt(s.meanConfidence, 2)}`,
          )
          .join("; ")}.`;
  return finding({
    code,
    title,
    body,
    severity: "INFO",
    metrics: nonEmpty.flatMap((s) => [
      { name: `${s.key}.count`, value: s.count },
      { name: `${s.key}.scoredCount`, value: s.scoredCount },
      { name: `${s.key}.meanScore`, value: s.meanScore },
    ]),
    sliceKeys: nonEmpty.map((s) => s.key),
  });
}

function buildSmallSlicesFinding(slices: SliceSummary[], sliceKindLabel: string): DigestFinding | null {
  const small = slices.filter((s) => s.count > 0 && s.count < THRESHOLDS.smallSliceCount);
  if (small.length === 0) return null;
  const codeLabel = sliceKindLabel.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return finding({
    code: `SMALL_${codeLabel}_SLICES`,
    title: `Small ${sliceKindLabel} slices`,
    body:
      `${small.length} ${sliceKindLabel} slice(s) have fewer than ${THRESHOLDS.smallSliceCount} member(s) ` +
      `and should be read with caution: ${small.map((s) => `${s.key} (n=${s.count})`).join("; ")}.`,
    severity: "WARNING",
    metrics: small.map((s) => ({ name: `${s.key}.count`, value: s.count })),
    sliceKeys: small.map((s) => s.key),
  });
}

function buildDimensionSaturationFindings(dims: DimensionSaturationSummary[]): {
  strengths: DigestFinding[];
  issues: DigestFinding[];
} {
  const strengths: DigestFinding[] = [];
  const issues: DigestFinding[] = [];
  const sorted = [...dims].sort((a, b) => a.dimension.localeCompare(b.dimension));
  for (const d of sorted) {
    const concerning =
      d.floorRate >= THRESHOLDS.highFloorRate ||
      d.saturationRate >= THRESHOLDS.highSaturationRate ||
      d.missingRate >= THRESHOLDS.highMissingRate;
    const f = finding({
      code: `DIMENSION_DISTRIBUTION_${d.dimension}`,
      title: `${d.dimension} dimension distribution`,
      body:
        `${d.dimension}: floor rate ${pct(d.floorRate)}, saturation rate ${pct(d.saturationRate)}, ` +
        `missing rate ${pct(d.missingRate)}, mean score ${fmt(d.meanScore, 1)} (n=${d.scoredCount}).`,
      severity: concerning ? "WARNING" : "INFO",
      metrics: [
        { name: `dimensionSaturation.${d.dimension}.floorRate`, value: d.floorRate },
        { name: `dimensionSaturation.${d.dimension}.saturationRate`, value: d.saturationRate },
        { name: `dimensionSaturation.${d.dimension}.missingRate`, value: d.missingRate },
        { name: `dimensionSaturation.${d.dimension}.meanScore`, value: d.meanScore },
        { name: `dimensionSaturation.${d.dimension}.scoredCount`, value: d.scoredCount },
      ],
      sliceKeys: [d.dimension],
    });
    if (concerning) issues.push(f);
    else strengths.push(f);
  }
  return { strengths, issues };
}

function buildConfidenceCoverageFinding(report: CalibrationReport): DigestFinding | null {
  const points = report.statistics.confidenceVersusCoverage;
  if (points.length === 0) return null;
  const lowConfidence = points.filter((p) => p.confidence < THRESHOLDS.lowConfidenceThreshold);
  const meanConfidence = points.reduce((sum, p) => sum + p.confidence, 0) / points.length;
  const severity: CalibrationPreflightSeverity =
    lowConfidence.length / points.length >= THRESHOLDS.lowConfidenceFractionWarn ? "WARNING" : "INFO";
  return finding({
    code: "CONFIDENCE_VERSUS_COVERAGE",
    title: "Confidence versus evidence coverage",
    body:
      `${lowConfidence.length} of ${points.length} scored member(s) have confidence below ` +
      `${pct(THRESHOLDS.lowConfidenceThreshold)} (mean confidence ${fmt(meanConfidence, 2)}).`,
    severity,
    metrics: [
      { name: "confidenceVersusCoverage.count", value: points.length },
      { name: "confidenceVersusCoverage.lowConfidenceCount", value: lowConfidence.length },
      { name: "confidenceVersusCoverage.meanConfidence", value: meanConfidence },
    ],
    memberIds: lowConfidence.map((p) => p.memberId),
  });
}

function buildMissingDataFinding(report: CalibrationReport): DigestFinding | null {
  const slices = report.statistics.missingDataSlices.filter((s) => s.count > 0);
  if (slices.length === 0) return null;
  return finding({
    code: "MISSING_OR_PARTIAL_EVIDENCE",
    title: "Missing, partial, or low-confidence evidence",
    body: `${slices.map((s) => `${s.key}: n=${s.count} (meanScore=${fmt(s.meanScore, 1)})`).join("; ")}.`,
    severity: "WARNING",
    metrics: slices.map((s) => ({ name: `${s.key}.count`, value: s.count })),
    sliceKeys: slices.map((s) => s.key),
  });
}

function buildGradeDistributionFinding(report: CalibrationReport): DigestFinding {
  const entries = Object.entries(report.statistics.gradeDistribution).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return finding({
    code: "GRADE_DISTRIBUTION",
    title: "Grade distribution",
    body:
      entries.length === 0
        ? "No grades observed."
        : `Observed grades: ${entries.map(([g, c]) => `${g}=${c}`).join(", ")}.`,
    severity: "INFO",
    metrics: entries.map(([g, c]) => ({ name: `gradeDistribution.${g}`, value: c ?? 0 })),
  });
}

function buildSampleSizeFinding(report: CalibrationReport): DigestFinding {
  const stats = report.statistics;
  const severity: CalibrationPreflightSeverity =
    stats.scoredMemberCount < THRESHOLDS.minSampleForAssessment
      ? "BLOCKING"
      : stats.scoredMemberCount < THRESHOLDS.minSampleForMediumConfidence
        ? "WARNING"
        : "INFO";
  return finding({
    code: "EVIDENCE_SAMPLE_SIZE",
    title: "Evaluated sample size",
    body:
      `${stats.scoredMemberCount} of ${report.cohortSize} cohort member(s) produced a comparable score ` +
      `(${report.evaluatedCount} evaluated, ${report.errorCount} scoring error(s), ` +
      `${report.validationFailureCount} evidence validation failure(s)).`,
    severity,
    metrics: [
      { name: "cohortSize", value: report.cohortSize },
      { name: "evaluatedCount", value: report.evaluatedCount },
      { name: "scoredMemberCount", value: stats.scoredMemberCount },
      { name: "failedMemberCount", value: stats.failedMemberCount },
      { name: "errorCount", value: report.errorCount },
      { name: "validationFailureCount", value: report.validationFailureCount },
    ],
  });
}

function buildValidationFailuresFinding(report: CalibrationReport): DigestFinding | null {
  if (report.validationFailures.length === 0) return null;
  const byCode = new Map<string, number>();
  const memberIds: string[] = [];
  for (const failure of report.validationFailures) {
    byCode.set(failure.code, (byCode.get(failure.code) ?? 0) + 1);
    if (failure.memberId && !memberIds.includes(failure.memberId)) memberIds.push(failure.memberId);
  }
  const metrics: Metric[] = [...byCode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => ({ name: `validationFailureCount.${code}`, value: count }));
  return finding({
    code: "EVIDENCE_VALIDATION_FAILURES",
    title: "Evidence validation failures excluded members",
    body: `${report.validationFailureCount} cohort member(s) were excluded from score aggregates because their evidence failed provenance validation.`,
    severity: "WARNING",
    metrics,
    memberIds,
  });
}

/** Deterministic phrasing keyed by finding code prefix — never mentions weight changes. */
function buildNextActionBody(f: DigestFinding): string {
  if (f.code === "RANK_ORDERING_QUALITY") {
    return "Review the flagged inversions, outliers, and slice-level detail to understand what is driving the ordering result before drawing conclusions.";
  }
  if (f.code === "RANK_INVERSIONS") {
    return "Review the flagged members and confirm their expected labels, rationale, and underlying evidence are correct.";
  }
  if (f.code === "EXPECTED_VERSUS_ACTUAL_OUTLIERS") {
    return "Review the flagged members' underlying evidence and expected-label rationale for data-entry or evidence-quality issues.";
  }
  if (f.code === "EVIDENCE_SAMPLE_SIZE") {
    return "Expand the cohort or resolve evaluation errors/validation failures to increase the number of comparable scored members.";
  }
  if (f.code === "EVIDENCE_VALIDATION_FAILURES") {
    return "Resolve the evidence-provenance issues for the excluded members so they can be included in a future run.";
  }
  if (f.code === "CONFIDENCE_VERSUS_COVERAGE") {
    return "Investigate why the flagged members have low confidence and whether additional evidence collection would raise it.";
  }
  if (f.code === "MISSING_OR_PARTIAL_EVIDENCE") {
    return "Investigate the missing or partial evidence identified for the affected members and slices.";
  }
  if (f.code.startsWith("SMALL_")) {
    return "Add more cohort members to the flagged slices before drawing conclusions from them.";
  }
  if (f.code.startsWith("DIMENSION_DISTRIBUTION_")) {
    return "Review the underlying metric inputs behind this dimension's floor, saturation, or missing rates for evidence-quality issues.";
  }
  return "Review the supporting metrics before drawing further conclusions.";
}

function buildNextAction(f: DigestFinding): DigestFinding {
  return finding({
    code: `NEXT_ACTION_${f.code}`,
    title: `Follow up: ${f.title}`,
    body: buildNextActionBody(f),
    severity: f.severity,
    metrics: f.metrics,
    memberIds: f.memberIds,
    sliceKeys: f.sliceKeys,
  });
}

/**
 * Builds a fully deterministic Phase 1 digest from an already-computed CalibrationReport.
 * Summarizes only facts present in the report; makes no LLM calls and recommends no weight changes.
 */
export function buildCalibrationDigestV1(report: CalibrationReport): CalibrationDigestV1 {
  const overallAssessment = computeOverallAssessment(report);
  const confidence = computeConfidence(report);

  const strengths: DigestFinding[] = [];
  const issues: DigestFinding[] = [];
  const limitations: DigestFinding[] = [];

  const ordering = buildOrderingFinding(report);
  if (ordering.severity === "INFO") strengths.push(ordering);
  else issues.push(ordering);

  strengths.push(buildGradeDistributionFinding(report));

  const inversionsFinding = buildInversionsFinding(report);
  if (inversionsFinding) issues.push(inversionsFinding);

  const outliersFinding = buildOutliersFinding(report);
  if (outliersFinding) issues.push(outliersFinding);

  strengths.push(buildSliceSummaryFinding("ROLE_SLICES", "Role slices", report.statistics.roleSlices));
  strengths.push(
    buildSliceSummaryFinding("META_VERSUS_NON_META", "Meta versus non-meta", [
      report.statistics.metaVersusNonMeta.meta,
      report.statistics.metaVersusNonMeta.nonMeta,
    ]),
  );

  const smallRoleSlices = buildSmallSlicesFinding(report.statistics.roleSlices, "role");
  if (smallRoleSlices) limitations.push(smallRoleSlices);
  const smallClassSpecSlices = buildSmallSlicesFinding(report.statistics.classSpecSlices, "class/spec");
  if (smallClassSpecSlices) limitations.push(smallClassSpecSlices);

  const dimFindings = buildDimensionSaturationFindings(report.statistics.dimensionSaturation);
  strengths.push(...dimFindings.strengths);
  issues.push(...dimFindings.issues);

  const confidenceCoverageFinding = buildConfidenceCoverageFinding(report);
  if (confidenceCoverageFinding) limitations.push(confidenceCoverageFinding);

  const missingDataFinding = buildMissingDataFinding(report);
  if (missingDataFinding) limitations.push(missingDataFinding);

  limitations.push(buildSampleSizeFinding(report));

  const validationFailuresFinding = buildValidationFailuresFinding(report);
  if (validationFailuresFinding) limitations.push(validationFailuresFinding);

  const nextActions = [...issues, ...limitations]
    .filter((f) => f.severity !== "INFO")
    .map(buildNextAction);

  return {
    headline: buildHeadline(report, overallAssessment),
    overallAssessment,
    strengths,
    issues,
    limitations,
    nextActions,
    confidence,
    algorithmVersion: CALIBRATION_DIGEST_ALGORITHM_VERSION,
  };
}
