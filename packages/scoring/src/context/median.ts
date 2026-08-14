/**
 * True statistical median. Even N uses the mean of the two central values (.5 preserved).
 */
export function computeTrueMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  if (values.some((v) => !Number.isFinite(v))) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}
