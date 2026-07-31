import type { Grade } from "@mplus/contracts";
import { LABEL_RANK } from "./manifest.js";
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

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
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
  const scores = rows
    .map((r) => r.overallScore)
    .filter((s): s is number => typeof s === "number");
  const confs = rows
    .map((r) => r.confidence)
    .filter((c): c is number => typeof c === "number");
  return {
    key,
    count: rows.length,
    meanScore: mean(scores),
    meanConfidence: mean(confs),
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
  const scored = rows.filter((r) => r.overallScore != null && !r.error);
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
  // Spearman via rank correlation of label-rank vs score-rank
  const n = scored.length;
  let spearman: number | null = null;
  if (n >= 2) {
    const byScore = [...scored].sort(
      (a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0),
    );
    const scoreRank = new Map(byScore.map((r, idx) => [r.memberId, idx + 1]));
    const labelRanks = scored.map((r) => LABEL_RANK[r.expectedLabel]);
    const scoreRanks = scored.map((r) => scoreRank.get(r.memberId)!);
    const meanL = mean(labelRanks)!;
    const meanS = mean(scoreRanks)!;
    let num = 0;
    let denL = 0;
    let denS = 0;
    for (let i = 0; i < n; i++) {
      const dl = labelRanks[i]! - meanL;
      const ds = scoreRanks[i]! - meanS;
      num += dl * ds;
      denL += dl * dl;
      denS += ds * ds;
    }
    const den = Math.sqrt(denL * denS);
    spearman = den === 0 ? null : num / den;
  }

  return {
    labelScoreSpearman: spearman,
    pairwiseConcordance,
    pairwiseDiscordance: denom === 0 ? null : discordant / denom,
    pairwiseTies: scored.length < 2 ? null : ties,
    inversions: inversions.slice(0, 50),
  };
}

export function detectOutliers(
  rows: PerCharacterCalibrationResult[],
): CalibrationStatistics["outliers"] {
  const outliers: CalibrationStatistics["outliers"] = [];
  for (const row of rows) {
    if (row.error || row.overallScore == null) continue;
    const rank = LABEL_RANK[row.expectedLabel];
    if (rank >= 4 && row.overallScore < 45) {
      outliers.push({
        memberId: row.memberId,
        reason: "high_expected_label_low_score",
        expectedLabel: row.expectedLabel,
        actualGrade: row.grade,
        actualScore: row.overallScore,
      });
    }
    if (rank <= 2 && row.overallScore > 75) {
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
    .filter((r) => r.confidence != null)
    .map((r) => {
      const present = r.dimensions.filter((d) => d.score != null).length;
      const expected = r.dimensions.length || 1;
      return {
        memberId: r.memberId,
        confidence: r.confidence!,
        coverageRatio: present / expected,
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
  const scores = rows
    .map((r) => r.overallScore)
    .filter((s): s is number => typeof s === "number");
  const confs = rows
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

/**
 * Lightweight weight ablation: re-score deltas are supplied by caller via
 * precomputed alternate mean scores, or computed here as dimension-weight
 * leave-one-out sensitivity on already-scored rows (no model mutation).
 */
export function computeWeightAblationFromRows(
  rows: PerCharacterCalibrationResult[],
): WeightAblationResult[] {
  const dims = new Set<string>();
  for (const row of rows) {
    for (const d of row.dimensions) dims.add(d.dimension);
  }

  const baselineScores = rows
    .filter((r) => r.overallScore != null)
    .map((r) => ({ id: r.memberId, score: r.overallScore!, grade: r.grade }));

  const results: WeightAblationResult[] = [];
  for (const dimension of [...dims].sort()) {
    // Approximate leave-one-out by renormalizing remaining dimension scores.
    let deltaSum = 0;
    let gradeChanges = 0;
    let n = 0;
    for (const row of rows) {
      if (row.overallScore == null) continue;
      const available = row.dimensions.filter(
        (d) => d.dimension !== dimension && d.score != null && d.weight > 0,
      );
      const weightSum = available.reduce((s, d) => s + d.weight, 0);
      if (weightSum <= 0) continue;
      const ablated =
        available.reduce((s, d) => s + (d.score ?? 0) * (d.weight / weightSum), 0);
      deltaSum += ablated - row.overallScore;
      n += 1;
      // Grade change heuristic vs original letter (ignore U transitions detail).
      const base = baselineScores.find((b) => b.id === row.memberId);
      if (base && base.grade && base.grade !== "U") {
        const shifted = Math.abs(ablated - row.overallScore) >= 5;
        if (shifted) gradeChanges += 1;
      }
    }
    if (n === 0) continue;
    results.push({
      weightKey: dimension,
      delta: -1,
      meanScoreDelta: deltaSum / n,
      gradeChangeCount: gradeChanges,
      exploratory: true,
    });
  }
  return results;
}

export function buildCalibrationStatistics(
  rows: PerCharacterCalibrationResult[],
  opts: { bootstrapSeed: number; bootstrapIterations: number },
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
    if (hasMissingDim || row.error) missing.push(row);
    if (row.isUnrated) unrated.push(row);
    if (row.lowConfidence) lowConf.push(row);
  }

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
    gradeDistribution: gradeDist(rows),
    gradeDistributionNote:
      "Observed grade counts only — no forced quotas at grade assignment time.",
    weightAblation: computeWeightAblationFromRows(rows),
    bootstrapIntervals: computeBootstrapIntervals(
      rows,
      opts.bootstrapSeed,
      opts.bootstrapIterations,
    ),
  };
}
