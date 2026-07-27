import { clamp, clamp01 } from "./math.js";
import type { HistoricalDecayWeights, NormalizationSpec } from "./types.js";

export function normalizeRawValue(
  raw: number,
  spec: NormalizationSpec | undefined,
): number {
  const effective: NormalizationSpec = spec ?? { type: "identity" };
  let value = raw;

  if (effective.type === "winsorize" || effective.winsorizeMin != null || effective.winsorizeMax != null) {
    const lo = effective.winsorizeMin ?? Number.NEGATIVE_INFINITY;
    const hi = effective.winsorizeMax ?? Number.POSITIVE_INFINITY;
    value = Math.min(hi, Math.max(lo, value));
  }

  let normalized: number;
  switch (effective.type) {
    case "identity":
    case "percentile":
    case "winsorize":
      normalized = value;
      break;
    case "logistic": {
      const mid = effective.midpoint ?? 50;
      const steep = effective.steepness ?? 0.1;
      normalized = 100 / (1 + Math.exp(-steep * (value - mid)));
      break;
    }
    case "piecewise": {
      normalized = piecewise(value, effective.points ?? []);
      break;
    }
    case "season_decay":
      // Caller should pre-combine seasons; treat as identity here.
      normalized = value;
      break;
    default:
      normalized = value;
  }

  if (effective.invert) {
    normalized = 100 - normalized;
  }
  return clamp(normalized);
}

function piecewise(raw: number, points: Array<[number, number]>): number {
  if (points.length === 0) return clamp(raw);
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  if (raw <= sorted[0]![0]) return sorted[0]![1];
  if (raw >= sorted[sorted.length - 1]![0]) return sorted[sorted.length - 1]![1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, y0] = sorted[i]!;
    const [x1, y1] = sorted[i + 1]!;
    if (raw >= x0 && raw <= x1) {
      const t = (raw - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return clamp(raw);
}

/** Combine already season-normalized scores with decay weights. */
export function applyHistoricalDecay(
  scores: { current?: number | null; previous?: number | null; older?: number | null },
  decay: HistoricalDecayWeights,
): number | null {
  const parts: Array<{ score: number; weight: number }> = [];
  if (scores.current != null && Number.isFinite(scores.current)) {
    parts.push({ score: scores.current, weight: decay.currentSeason });
  }
  if (scores.previous != null && Number.isFinite(scores.previous)) {
    parts.push({ score: scores.previous, weight: decay.previousSeason });
  }
  if (scores.older != null && Number.isFinite(scores.older)) {
    parts.push({ score: scores.older, weight: decay.olderSeasons });
  }
  if (parts.length === 0) return null;
  const totalW = parts.reduce((s, p) => s + p.weight, 0);
  if (totalW <= 0) return null;
  return clamp(parts.reduce((s, p) => s + p.score * (p.weight / totalW), 0));
}

export function sampleSizeConfidence(sampleSize: number, halfLife: number): number {
  if (!(sampleSize > 0) || !(halfLife > 0)) return 0;
  return clamp01(1 - Math.exp(-sampleSize / halfLife));
}
