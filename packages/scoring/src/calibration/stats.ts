import type { Grade } from "@mplus/contracts";
import { LABEL_RANK } from "./manifest.js";
import { spearmanRankCorrelation } from "./ranking.js";
import type {
  BootstrapInterval,
  CalibrationStatistics,
  ConfidenceCoveragePoint,
  DimensionSaturationSummary,
  PerCharacterCalibrationResult,
  QualitativeLabel,
  RankConfusionSummary,
  SliceSummary,
  WeightAblationResult,
} from "./types.js";

const FLOOR = 5;
const CEILING = 95;

/** Exploratory outlier heuristics — not production calibration significance. */
const OUTLIER_HIGH_LABEL_LOW_SCORE = 45;
const OUTLIER_LOW_LABEL_HIGH_SCORE = 75;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function isScored(row: PerCharacterCalibrationResult): boolean {
  return row.overallScore != null && !row.error && !row.validationFailure;
}

function gradeDist(rows: PerCharacterCalibrationResult[]): Partial<Record<Grade, number>> {
  const out: Partial<Record<Grade, number>> = {};
  for (const row of rows) {
    if (!row.grade) continue;
    out[row.grade] = (out[row.grade] ?? 0) + 1;
  }
  return out;
}

function labelDist(
  rows: PerCharacterCalibrationResult[],
): Partial<Record<QualitativeLabel, number>> {
  const out: Partial<Record<QualitativeLabel, number>> = {};
  for (const row of rows) {
    out[row.expectedLabel] = (out[row.expectedLabel] ?? 0) + 1;
  }
  return out;
}

function sliceOf(key: string, rows: PerCharacterCalibrationResult[]): SliceSummary {
  const scored = rows.filter(isScored);
  const scores = scored.map((r) => r.overallScore!);
  const confs = scored
    .map((r) => r.confidence)
    .filter((c): c is number => typeof c === "number");
  return {
    key,
    count: rows.length,
    scoredCount: scored.length,
    meanScore: mean(scores),
    meanConfidence: confs.length === 0 ? null : mean(confs),
    gradeDistribution: gradeDist(rows),
    labelDistribution: labelDist(rows),
  };
}

/** Deterministic mulberry32 PRNG for exploratory bootstrap. */
export function createSeededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeRankConfusion(
  rows: PerCharacterCalibrationResult[],
): RankConfusionSummary {
  const scored = rows.filter(isScored);
  let concordant = 0;
  let discordant = 0;
  let ties = 0;
  const inversions: RankConfusionSummary["inversions"] = [];

  for (let i = 0; i < scored.length; i++) {
    for (let j = i + 1; j < scored.length; j++) {
      const a = scored[i]!;
      const b = scored[j]!;
      const labelDiff = LABEL_RANK[a.expectedLabel] - LABEL_RANK[b.expectedLabel];
      const scoreDiff = (a.overallScore ?? 0) - (b.overallScore ?? 0);
      if (labelDiff === 0 || scoreDiff === 0) {
        ties += 1;
        continue;
      }
      if (Math.sign(labelDiff) === Math.sign(scoreDiff)) {
        concordant += 1;
      } else {
        discordant += 1;
        const higher = labelDiff > 0 ? a : b;
        const lower = labelDiff > 0 ? b : a;
        inversions.push({
          higherExpectedId: higher.memberId,
          lowerExpectedId: lower.memberId,
          higherExpectedLabel: higher.expectedLabel,
          lowerExpectedLabel: lower.expectedLabel,
          higherScore: higher.overallScore,
          lowerScore: lower.overallScore,
        });
      }
    }
  }

  const denom = concordant + discordant;
  const pairwiseConcordance = denom === 0 ? null : concordant / denom;

  // Spearman: qualitative strength vs score values (ascending midranks on both).
  const labelValues = scored.map((r) => LABEL_RANK[r.expectedLabel]);
  const scoreValues = scored.map((r) => r.overallScore!);
  const spearman = spearmanRankCorrelation(labelValues, scoreValues);

  return {
    labelScoreSpearman: spearman,
    tieMethod: "average-ranks",
    pairwiseConcordance,
    pairwiseDiscordance: denom === 0 ? null : discordant / denom,
    pairwiseTies: scored.length < 2 ? null : ties,
    sampleSize: scored.length,
    inversions: inversions.slice(0, 50),
  };
}

export function detectOutliers(
  rows: PerCharacterCalibrationResult[],
): CalibrationStatistics["outliers"] {
  const outliers: CalibrationStatistics["outliers"] = [];
  for (const row of rows) {
    if (!isScored(row)) continue;
    const rank = LABEL_RANK[row.expectedLabel];
    if (rank >= 4 && row.overallScore! < OUTLIER_HIGH_LABEL_LOW_SCORE) {
      outliers.push({
        memberId: row.memberId,
        reason: "high_expected_label_low_score",
        expectedLabel: row.expectedLabel,
        actualGrade: row.grade,
        actualScore: row.overallScore,
      });
    }
    if (rank <= 2 && row.overallScore! > OUTLIER_LOW_LABEL_HIGH_SCORE) {
      outliers.push({
        memberId: row.memberId,
        reason: "low_expected_label_high_score",
        expectedLabel: row.expectedLabel,
        actualGrade: row.grade,
        actualScore: row.overallScore,
      });
    }
    if (row.isUnrated && rank >= 4) {
      outliers.push({
        memberId: row.memberId,
        reason: "high_expected_but_unrated",
        expectedLabel: row.expectedLabel,
        actualGrade: row.grade,
        actualScore: row.overallScore,
      });
    }
  }
  return outliers;
}

export function computeDimensionSaturation(
  rows: PerCharacterCalibrationResult[],
): DimensionSaturationSummary[] {
  const byDim = new Map<
    string,
    { scores: number[]; missing: number; total: number }
  >();

  for (const row of rows) {
    if (row.error || row.validationFailure) continue;
    for (const dim of row.dimensions) {
      let bucket = byDim.get(dim.dimension);
      if (!bucket) {
        bucket = { scores: [], missing: 0, total: 0 };
        byDim.set(dim.dimension, bucket);
      }
      bucket.total += 1;
      if (dim.score == null || dim.state === "UNAVAILABLE") {
        bucket.missing += 1;
      } else {
        bucket.scores.push(dim.score);
      }
    }
  }

  return [...byDim.entries()].map(([dimension, bucket]) => {
    const scoredCount = bucket.scores.length;
    const floorRate =
      scoredCount === 0 ? 0 : bucket.scores.filter((s) => s <= FLOOR).length / scoredCount;
    const saturationRate =
      scoredCount === 0
        ? 0
        : bucket.scores.filter((s) => s >= CEILING).length / scoredCount;
    return {
      dimension,
      scoredCount,
      floorRate,
      saturationRate,
      missingRate: bucket.total === 0 ? 0 : bucket.missing / bucket.total,
      meanScore: mean(bucket.scores),
    };
  });
}

export function confidenceVersusCoverage(
  rows: PerCharacterCalibrationResult[],
): ConfidenceCoveragePoint[] {
  return rows
    .filter((r) => r.confidence != null && !r.error && !r.validationFailure)
    .map((r) => {
      const selectedRunCoverage = r.evidenceCoverage?.selectedRunCoverage ?? null;
      const modelCoverageRatio = r.evidenceCoverage?.modelCoverageRatio ?? null;
      const dimensionAvailabilityRatio =
        r.evidenceCoverage?.dimensionAvailabilityRatio ?? null;
      const coverageRatio =
        selectedRunCoverage ?? modelCoverageRatio ?? dimensionAvailabilityRatio;
      return {
        memberId: r.memberId,
        confidence: r.confidence!,
        selectedRunCoverage,
        modelCoverageRatio,
        dimensionAvailabilityRatio,
        coverageRatio,
        grade: r.grade,
      };
    });
}

function mulberryBootstrapMean(
  values: number[],
  iterations: number,
  seed: number,
): { lower: number; upper: number; estimate: number } | null {
  if (values.length < 5) return null;
  const rng = createSeededRng(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) {
      const idx = Math.floor(rng() * values.length);
      sum += values[idx]!;
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(0.025 * means.length)]!;
  const hi = means[Math.min(means.length - 1, Math.floor(0.975 * means.length))]!;
  return { lower: lo, upper: hi, estimate: mean(values)! };
}

export function computeBootstrapIntervals(
  rows: PerCharacterCalibrationResult[],
  seed: number,
  iterations: number,
): BootstrapInterval[] {
  const note =
    "Exploratory bootstrap percentile interval — not a production calibration claim.";
  const scored = rows.filter(isScored);
  const scores = scored.map((r) => r.overallScore!);
  const confs = scored
    .map((r) => r.confidence)
    .filter((c): c is number => typeof c === "number");

  const out: BootstrapInterval[] = [];
  const scoreBoot = mulberryBootstrapMean(scores, iterations, seed);
  if (scoreBoot) {
    out.push({
      metric: "meanOverallScore",
      sampleSize: scores.length,
      estimate: scoreBoot.estimate,
      lower: scoreBoot.lower,
      upper: scoreBoot.upper,
      iterations,
      exploratory: true,
      note,
    });
  }
  const confBoot = mulberryBootstrapMean(confs, iterations, seed + 17);
  if (confBoot) {
    out.push({
      metric: "meanConfidence",
      sampleSize: confs.length,
      estimate: confBoot.estimate,
      lower: confBoot.lower,
      upper: confBoot.upper,
      iterations,
      exploratory: true,
      note,
    });
  }
  return out;
}

export function buildCalibrationStatistics(
  rows: PerCharacterCalibrationResult[],
  opts: {
    bootstrapSeed: number;
    bootstrapIterations: number;
    weightAblation?: WeightAblationResult[];
  },
): CalibrationStatistics {
  const meta = rows.filter((r) => r.meta);
  const nonMeta = rows.filter((r) => !r.meta);
  const byRole = new Map<string, PerCharacterCalibrationResult[]>();
  const byClassSpec = new Map<string, PerCharacterCalibrationResult[]>();
  const missing: PerCharacterCalibrationResult[] = [];
  const unrated: PerCharacterCalibrationResult[] = [];
  const lowConf: PerCharacterCalibrationResult[] = [];

  for (const row of rows) {
    const roleKey = row.role;
    byRole.set(roleKey, [...(byRole.get(roleKey) ?? []), row]);
    const cs = `${row.classSlug}/${row.specSlug}`;
    byClassSpec.set(cs, [...(byClassSpec.get(cs) ?? []), row]);
    const hasMissingDim = row.dimensions.some(
      (d) => d.score == null || d.state === "UNAVAILABLE" || d.state === "PARTIAL",
    );
    if (hasMissingDim || row.error || row.validationFailure) missing.push(row);
    if (row.isUnrated) unrated.push(row);
    if (row.lowConfidence) lowConf.push(row);
  }

  const scoredMemberCount = rows.filter(isScored).length;
  const failedMemberCount = rows.filter((r) => r.error || r.validationFailure).length;

  return {
    monotonicOrdering: computeRankConfusion(rows),
    outliers: detectOutliers(rows),
    dimensionSaturation: computeDimensionSaturation(rows),
    confidenceVersusCoverage: confidenceVersusCoverage(rows),
    metaVersusNonMeta: {
      meta: sliceOf("meta", meta),
      nonMeta: sliceOf("non-meta", nonMeta),
    },
    roleSlices: [...byRole.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => sliceOf(key, group)),
    classSpecSlices: [...byClassSpec.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => sliceOf(key, group)),
    missingDataSlices: [
      sliceOf("missing-or-partial-dimension", missing),
      sliceOf("unrated-U", unrated),
      sliceOf("low-confidence", lowConf),
    ],
    // Grade distribution retains U; failed rows without grade are omitted from counts.
    gradeDistribution: gradeDist(rows.filter((r) => !r.error && !r.validationFailure)),
    gradeDistributionNote:
      "Observed grade counts only — no forced quotas at grade assignment time. U retained when present.",
    weightAblation: opts.weightAblation ?? [],
    bootstrapIntervals: computeBootstrapIntervals(
      rows,
      opts.bootstrapSeed,
      opts.bootstrapIterations,
    ),
    failedMemberCount,
    scoredMemberCount,
  };
}
