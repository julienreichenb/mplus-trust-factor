/**
 * Tie-aware ranking helpers for calibration statistics.
 *
 * Average (mid) ranks are used for ties. Perfect agreement between higher
 * qualitative labels and higher scores yields Spearman ≈ +1; perfect inverse
 * ordering yields ≈ −1. Constant vectors return null.
 */

/** Assign 1-based average ranks for tied values (ascending: lower value → lower rank). */
export function averageRanksAscending(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v || a.i - b.i);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i + 1;
    while (j < indexed.length && indexed[j]!.v === indexed[i]!.v) j += 1;
    // Mid-rank of the 1-based positions [i+1, j].
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      ranks[indexed[k]!.i] = avg;
    }
    i = j;
  }
  return ranks;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return null;
  return num / den;
}

/**
 * Spearman rank correlation with average ranks for ties.
 * Both series use ascending ranks (larger values → higher ranks).
 */
export function spearmanRankCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  return pearson(averageRanksAscending(xs), averageRanksAscending(ys));
}
