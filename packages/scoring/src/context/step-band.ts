import type { ScoreContextPercentileAnchor } from "@mplus/contracts";

export interface ResolvedKeyAnchor {
  percentileBps: number;
  keyThreshold: number;
  factor: number;
}

export interface StepBandPick {
  applied: ResolvedKeyAnchor;
  next: ResolvedKeyAnchor | null;
}

/**
 * V1 step-band lookup. Duplicate concrete thresholds: greatest percentileBps wins.
 * Below the lowest threshold uses the lowest-threshold group (greatest bps in that group).
 * Above the highest threshold uses the highest-threshold group (greatest bps).
 */
export function pickStepBandAnchor(
  medianKeyLevel: number,
  resolved: readonly ResolvedKeyAnchor[],
): StepBandPick | null {
  if (!Number.isFinite(medianKeyLevel) || resolved.length === 0) return null;

  const sorted = [...resolved].sort((a, b) => {
    if (a.keyThreshold !== b.keyThreshold) return a.keyThreshold - b.keyThreshold;
    return a.percentileBps - b.percentileBps;
  });

  const atOrBelow = sorted.filter((a) => a.keyThreshold <= medianKeyLevel);
  const groupThreshold =
    atOrBelow.length > 0
      ? Math.max(...atOrBelow.map((a) => a.keyThreshold))
      : Math.min(...sorted.map((a) => a.keyThreshold));
  const groupSource = atOrBelow.length > 0 ? atOrBelow : sorted;
  const group = groupSource.filter((a) => a.keyThreshold === groupThreshold);
  const applied = group.reduce((best, a) =>
    a.percentileBps > best.percentileBps ? a : best,
  );

  const later = sorted.filter(
    (a) =>
      a.keyThreshold > applied.keyThreshold ||
      (a.keyThreshold === applied.keyThreshold && a.percentileBps > applied.percentileBps),
  );
  return { applied, next: later[0] ?? null };
}

export function resolveAnchorsAgainstDistribution(input: {
  anchors: readonly ScoreContextPercentileAnchor[];
  points: readonly { percentileBps: number; medianKeyThreshold: number }[];
}): ResolvedKeyAnchor[] {
  const byBps = new Map(input.points.map((p) => [p.percentileBps, p.medianKeyThreshold]));
  const out: ResolvedKeyAnchor[] = [];
  for (const anchor of input.anchors) {
    const threshold = byBps.get(anchor.percentileBps);
    if (threshold == null || !Number.isFinite(anchor.factor) || anchor.factor <= 0) continue;
    out.push({
      percentileBps: anchor.percentileBps,
      keyThreshold: threshold,
      factor: anchor.factor,
    });
  }
  return out;
}
