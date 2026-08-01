/**
 * Offline analysis metrics for boost-shadow Phase 2.
 * Confusion / PR only over research-labeled supervised rows — never authenticity as GT.
 */

import type { BoostShadowExperimentParamsV1 } from "./experiment-params.js";
import {
  PHASE2_FEATURE_KEYS,
  type AuthenticityCompareSummary,
  type BoostShadowBacktestAnalysisV1,
  type BoostShadowFeatureRowV1,
  type BoostShadowSplitAssignmentV1,
  type ConfusionMatrixV1,
  type FeatureAvailabilitySummary,
  type FeatureDistributionSummary,
  type FixedTeamVersusStrongerSummary,
  type PairwiseOverlapSummary,
  type Phase2FeatureKey,
  type PrecisionRecallSummary,
  type SliceSummaryV1,
  type TemporalStabilitySummary,
} from "./types.js";

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const v = values.reduce((acc, x) => acc + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Average-rank Spearman (tie-aware). */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const rank = (vals: number[]): number[] => {
    const indexed = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(vals.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[indexed[k]!.i] = avg;
      i = j + 1;
    }
    return ranks;
  };
  return pearson(rank(xs), rank(ys));
}

export function isLabeledForSupervised(
  row: BoostShadowFeatureRowV1,
  params: BoostShadowExperimentParamsV1,
): boolean {
  const label = row.label;
  if (label.class === "unlabeled" || label.class === "uncertain") return false;
  if (label.class === "synthetic_fixture") {
    return label.confidence == null || label.confidence >= params.minLabelConfidenceForSupervised;
  }
  if (label.class === "suspicious_consensus" || label.class === "legitimate_consensus") {
    if (label.confidence == null || label.confidence < params.minLabelConfidenceForSupervised) {
      return false;
    }
    if (
      label.reviewerCount != null &&
      label.reviewerCount < params.minReviewerCountForConsensus
    ) {
      return false;
    }
    return true;
  }
  return false;
}

export function isPositiveLabel(row: BoostShadowFeatureRowV1): boolean {
  return (
    row.label.class === "suspicious_consensus" ||
    (row.label.class === "synthetic_fixture" && row.label.source.includes("suspicious"))
  );
}

export function experimentalUnusualPattern(
  row: BoostShadowFeatureRowV1,
  params: BoostShadowExperimentParamsV1,
): boolean {
  const gap = row.features.teammateScoreGap;
  const cohort = row.features.repeatedStrongerTeammateCohort;
  const conc = row.features.highKeyGroupConcentration;
  const t = params.experimentalUnusualPattern;
  return (
    gap != null &&
    gap >= t.teammateScoreGapMin &&
    cohort != null &&
    cohort >= t.repeatedStrongerCohortMin &&
    conc != null &&
    conc >= t.highKeyConcentrationMin
  );
}

export function classifyPattern(
  row: Pick<BoostShadowFeatureRowV1, "features">,
  params: BoostShadowExperimentParamsV1,
): BoostShadowFeatureRowV1["patternClass"] {
  const gap = row.features.teammateScoreGap;
  const cohort = row.features.repeatedStrongerTeammateCohort;
  const conc = row.features.highKeyGroupConcentration;
  const vel = row.features.progressionVelocity;
  const d = params.patternDiscrimination;

  const hasCore = gap != null || cohort != null || conc != null || vel != null;
  if (!hasCore) return "insufficient_evidence";

  // Priority order matches plan §10 — distinguish fixed team vs stronger cohort first.
  if (
    conc != null &&
    conc >= d.concentrationHighMin &&
    gap != null &&
    gap <= d.gapLowMax
  ) {
    return "fixed_team_low_gap";
  }
  if (
    cohort != null &&
    cohort >= d.cohortHighMin &&
    gap != null &&
    gap >= d.gapHighMin
  ) {
    return "repeated_stronger_teammate";
  }
  if (gap != null && gap >= d.gapHighMin && (cohort == null || cohort < d.cohortHighMin)) {
    return "high_gap_diverse";
  }
  if (vel != null && vel >= 0.5) {
    return "rapid_progression";
  }
  return "unknown";
}

function featureValues(
  rows: BoostShadowFeatureRowV1[],
  key: Phase2FeatureKey,
): number[] {
  return rows
    .map((r) => r.features[key])
    .filter((v): v is number => typeof v === "number");
}

function availability(
  rows: BoostShadowFeatureRowV1[],
): FeatureAvailabilitySummary[] {
  return PHASE2_FEATURE_KEYS.map((featureKey) => {
    let computedCount = 0;
    let omittedCount = 0;
    const omissionReasonCounts: Record<string, number> = {};
    for (const row of rows) {
      if (row.features[featureKey] != null) {
        computedCount += 1;
      } else {
        omittedCount += 1;
        const reason =
          row.omittedFeatures.find((o) => o.featureKey === featureKey)?.reasonCode ??
          "OMITTED";
        omissionReasonCounts[reason] = (omissionReasonCounts[reason] ?? 0) + 1;
      }
    }
    const total = rows.length || 1;
    return {
      featureKey,
      computedCount,
      omittedCount,
      missingnessRate: omittedCount / total,
      omissionReasonCounts,
    };
  });
}

function distributions(rows: BoostShadowFeatureRowV1[]): FeatureDistributionSummary[] {
  return PHASE2_FEATURE_KEYS.map((featureKey) => {
    const values = featureValues(rows, featureKey).sort((a, b) => a - b);
    return {
      featureKey,
      sampleSize: values.length,
      mean: mean(values),
      stdev: stdev(values),
      min: values[0] ?? null,
      max: values.length ? values[values.length - 1]! : null,
      p25: percentile(values, 0.25),
      p50: percentile(values, 0.5),
      p75: percentile(values, 0.75),
    };
  });
}

function correlations(rows: BoostShadowFeatureRowV1[]) {
  const out: BoostShadowBacktestAnalysisV1["correlationMatrix"] = [];
  for (let i = 0; i < PHASE2_FEATURE_KEYS.length; i++) {
    for (let j = i; j < PHASE2_FEATURE_KEYS.length; j++) {
      const a = PHASE2_FEATURE_KEYS[i]!;
      const b = PHASE2_FEATURE_KEYS[j]!;
      const pairs: Array<[number, number]> = [];
      for (const row of rows) {
        const va = row.features[a];
        const vb = row.features[b];
        if (typeof va === "number" && typeof vb === "number") {
          pairs.push([va, vb]);
        }
      }
      out.push({
        featureA: a,
        featureB: b,
        pearson: pearson(
          pairs.map((p) => p[0]),
          pairs.map((p) => p[1]),
        ),
        sampleSize: pairs.length,
      });
    }
  }
  return out;
}

function pairwiseOverlap(rows: BoostShadowFeatureRowV1[]): PairwiseOverlapSummary[] {
  const out: PairwiseOverlapSummary[] = [];
  for (let i = 0; i < PHASE2_FEATURE_KEYS.length; i++) {
    for (let j = i + 1; j < PHASE2_FEATURE_KEYS.length; j++) {
      const a = PHASE2_FEATURE_KEYS[i]!;
      const b = PHASE2_FEATURE_KEYS[j]!;
      let both = 0;
      let either = 0;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const row of rows) {
        const va = row.features[a];
        const vb = row.features[b];
        const hasA = typeof va === "number";
        const hasB = typeof vb === "number";
        if (hasA || hasB) either += 1;
        if (hasA && hasB) {
          both += 1;
          xs.push(va!);
          ys.push(vb!);
        }
      }
      out.push({
        featureA: a,
        featureB: b,
        bothComputed: both,
        eitherComputed: either,
        overlapRate: either === 0 ? null : both / either,
        pearson: pearson(xs, ys),
      });
    }
  }
  return out;
}

function confusionAndPr(
  rows: BoostShadowFeatureRowV1[],
  params: BoostShadowExperimentParamsV1,
): { confusion: ConfusionMatrixV1 | null; pr: PrecisionRecallSummary | null } {
  const labeled = rows.filter((r) => r.labeledForSupervised);
  const unlabeledExcluded = rows.length - labeled.length;
  if (labeled.length === 0) {
    return {
      confusion: {
        truePositive: 0,
        falsePositive: 0,
        trueNegative: 0,
        falseNegative: 0,
        labeledSampleSize: 0,
        unlabeledExcluded,
      },
      pr: {
        precision: null,
        recall: null,
        falsePositiveRate: null,
        sampleSize: 0,
        note: "No research-labeled supervised rows; authenticity is not ground truth.",
      },
    };
  }

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const row of labeled) {
    const pred = experimentalUnusualPattern(row, params);
    const actual = isPositiveLabel(row);
    if (pred && actual) tp += 1;
    else if (pred && !actual) fp += 1;
    else if (!pred && !actual) tn += 1;
    else fn += 1;
  }

  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const fpr = fp + tn === 0 ? null : fp / (fp + tn);

  return {
    confusion: {
      truePositive: tp,
      falsePositive: fp,
      trueNegative: tn,
      falseNegative: fn,
      labeledSampleSize: labeled.length,
      unlabeledExcluded,
    },
    pr: {
      precision,
      recall,
      falsePositiveRate: fpr,
      sampleSize: labeled.length,
      note: "Offline non-product experimental classifier vs research labels only.",
    },
  };
}

function temporalStability(rows: BoostShadowFeatureRowV1[]): TemporalStabilitySummary[] {
  const timed = [...rows]
    .filter((r) => r.facts.calculatedAt)
    .sort((a, b) => a.facts.calculatedAt.localeCompare(b.facts.calculatedAt));
  const mid = Math.floor(timed.length / 2);
  const early = timed.slice(0, mid);
  const late = timed.slice(mid);
  return PHASE2_FEATURE_KEYS.map((featureKey) => {
    const n = Math.min(early.length, late.length);
    if (n < 2) {
      return { featureKey, earlyLateSpearman: null, sampleSize: n };
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = early[i]!.features[featureKey];
      const b = late[i]!.features[featureKey];
      if (typeof a === "number" && typeof b === "number") {
        xs.push(a);
        ys.push(b);
      }
    }
    return {
      featureKey,
      earlyLateSpearman: spearman(xs, ys),
      sampleSize: xs.length,
    };
  });
}

function sliceBy(
  rows: BoostShadowFeatureRowV1[],
  keyFn: (r: BoostShadowFeatureRowV1) => string,
): SliceSummaryV1[] {
  const groups = new Map<string, BoostShadowFeatureRowV1[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, group]) => {
      const meanFeatureValues: Partial<Record<Phase2FeatureKey, number | null>> = {};
      for (const fk of PHASE2_FEATURE_KEYS) {
        meanFeatureValues[fk] = mean(featureValues(group, fk));
      }
      return {
        key,
        count: group.length,
        labeledCount: group.filter((r) => r.labeledForSupervised).length,
        meanFeatureValues,
      };
    });
}

function fixedTeamSummary(rows: BoostShadowFeatureRowV1[]): FixedTeamVersusStrongerSummary {
  const fixedTeamLowGapCount = rows.filter((r) => r.patternClass === "fixed_team_low_gap").length;
  const repeatedStrongerTeammateCount = rows.filter(
    (r) => r.patternClass === "repeated_stronger_teammate",
  ).length;
  const highGapDiverseCount = rows.filter((r) => r.patternClass === "high_gap_diverse").length;
  return {
    fixedTeamLowGapCount,
    repeatedStrongerTeammateCount,
    highGapDiverseCount,
    distinguishable:
      fixedTeamLowGapCount > 0 &&
      repeatedStrongerTeammateCount > 0 &&
      fixedTeamLowGapCount !== repeatedStrongerTeammateCount,
    note: "High concentration + low gap → fixed team; high gap + recurrent stronger cohort → unusual pattern candidate (shadow only).",
  };
}

function authenticityCompare(rows: BoostShadowFeatureRowV1[]): AuthenticityCompareSummary {
  let rowsWithAuthenticity = 0;
  let bothPositive = 0;
  let shadowOnly = 0;
  let authenticityOnly = 0;
  let bothNegative = 0;
  let unlabeledOrMissing = 0;

  for (const row of rows) {
    const auth = row.productionAuthenticity;
    if (auth.source === "none" || auth.authenticityScore == null) {
      unlabeledOrMissing += 1;
      continue;
    }
    rowsWithAuthenticity += 1;
    const authPos = auth.boostSuspected === true;
    const shadowPos = row.patternClass === "repeated_stronger_teammate";
    if (!row.labeledForSupervised) {
      // Still count agreement surface, but note unlabeled separately in note.
    }
    if (shadowPos && authPos) bothPositive += 1;
    else if (shadowPos && !authPos) shadowOnly += 1;
    else if (!shadowPos && authPos) authenticityOnly += 1;
    else bothNegative += 1;
  }

  return {
    rowsWithAuthenticity,
    boostSuspectedAgreement: {
      bothPositive,
      shadowOnly,
      authenticityOnly,
      bothNegative,
      unlabeledOrMissing,
    },
    note: "Compare-only vs production authenticity — authenticity is never used as ground truth.",
  };
}

export function buildBacktestAnalysis(args: {
  rows: BoostShadowFeatureRowV1[];
  assignments: BoostShadowSplitAssignmentV1[];
  params: BoostShadowExperimentParamsV1;
  membersRequested: number;
}): BoostShadowBacktestAnalysisV1 {
  const { rows, assignments, params } = args;
  const { confusion, pr } = confusionAndPr(rows, params);

  const labelDistribution: Record<string, number> = {};
  for (const row of rows) {
    labelDistribution[row.label.class] = (labelDistribution[row.label.class] ?? 0) + 1;
  }

  return {
    featureAvailability: availability(rows),
    featureDistributions: distributions(rows),
    correlationMatrix: correlations(rows),
    pairwiseOverlap: pairwiseOverlap(rows),
    labelDistribution,
    confusionMatrix: confusion,
    precisionRecall: pr,
    temporalStability: temporalStability(rows),
    roleSlices: sliceBy(rows, (r) => r.role ?? "unknown"),
    keyBandSlices: sliceBy(rows, (r) => r.keyBand ?? "unknown"),
    fixedTeamVersusStronger: fixedTeamSummary(rows),
    authenticityCompare: authenticityCompare(rows),
    evidenceCoverage: {
      membersRequested: args.membersRequested,
      membersWithRuns: rows.filter((r) => r.facts.highKeySet.runsEligible + r.facts.highKeySet.runsExcluded > 0 || r.facts.sourceProvenance.runSourceCounts).length,
      membersWithAlignedRatings: rows.filter(
        (r) =>
          r.features.teammateScoreGap != null ||
          r.omittedFeatures.some((o) => o.reasonCode !== "NO_TIME_ALIGNED_SUBJECT_RATING"),
      ).length,
      membersMissingRuns: rows.filter((r) => r.error === "NO_EVIDENCE" || r.highKeyRunsEligible + r.highKeyRunsExcluded === 0 && Object.keys(r.facts.sourceProvenance.runSourceCounts ?? {}).length === 0).length,
      unlabeledRetainedForCoverage: rows.filter((r) => !r.labeledForSupervised).length,
      labeledSupervisedCount: rows.filter((r) => r.labeledForSupervised).length,
    },
    splitProvenance: {
      trainCount: assignments.filter((a) => a.split === "train").length,
      evaluationCount: assignments.filter((a) => a.split === "evaluation").length,
      coverageOnlyCount: assignments.filter((a) => a.split === "coverage_only").length,
      assignments,
    },
  };
}
