import { createHash } from "node:crypto";
import type { MedianKeyDistributionPoint } from "@mplus/contracts";
import { KEY_CONTEXT_PERCENTILE_BPS } from "@mplus/contracts";

/**
 * Empirical-CDF inverse (no interpolation).
 *
 * F(x) = (# observations with value <= x) / n
 * Q(p) = min { observed x : F(x) >= p }
 *
 * "Minimum observed median-key threshold representing at least percentile P."
 * Valid x are discrete .5 increments produced by averaging two integer key levels.
 */
export function empiricalCdfQuantile(
  histogram: ReadonlyMap<number, number> | Readonly<Record<number, number>>,
  percentileBps: number,
): number {
  if (!Number.isInteger(percentileBps) || percentileBps < 1 || percentileBps > 10_000) {
    throw new Error("percentileBps must be an integer in 1..10000");
  }
  const entries = [...(histogram instanceof Map ? histogram.entries() : Object.entries(histogram).map(
    ([k, v]) => [Number(k), v] as [number, number],
  ))]
    .filter(([, n]) => n > 0)
    .sort((a, b) => a[0] - b[0]);
  const n = entries.reduce((sum, [, c]) => sum + c, 0);
  if (n <= 0) {
    throw new Error("histogram is empty");
  }
  const target = (percentileBps / 10_000) * n;
  let cumulative = 0;
  for (const [value, count] of entries) {
    cumulative += count;
    if (cumulative + 1e-12 >= target) return value;
  }
  return entries[entries.length - 1]![0];
}

export function characterMedianOfEightLevels(levels: readonly number[]): number {
  if (levels.length !== 8) {
    throw new Error("median requires exactly 8 dungeon levels");
  }
  const sorted = [...levels].sort((a, b) => a - b);
  return (sorted[3]! + sorted[4]!) / 2;
}

export function isCompleteEightDungeonLevels(levels: readonly number[]): boolean {
  return levels.length === 8 && levels.every((lv) => Number.isInteger(lv) && lv > 0);
}

export function pointsFromHistogram(
  histogram: ReadonlyMap<number, number>,
  percentileBpsList: readonly number[] = KEY_CONTEXT_PERCENTILE_BPS,
): MedianKeyDistributionPoint[] {
  return percentileBpsList.map((percentileBps) => ({
    percentileBps,
    medianKeyThreshold: empiricalCdfQuantile(histogram, percentileBps),
  }));
}

export function medianKeySnapshotIdentityHash(input: {
  source: string;
  sourceVersion: string | null;
  assetSha256?: string | null;
  points: readonly MedianKeyDistributionPoint[];
}): string {
  const ordered = [...input.points].sort((a, b) => a.percentileBps - b.percentileBps);
  return createHash("sha256")
    .update(
      JSON.stringify({
        source: input.source,
        sourceVersion: input.sourceVersion,
        assetSha256: input.assetSha256 ?? null,
        points: ordered,
      }),
    )
    .digest("hex");
}
