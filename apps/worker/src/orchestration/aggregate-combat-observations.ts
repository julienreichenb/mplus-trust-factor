import type { MetricObservationDTO } from "@mplus/contracts";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Merge per-run combat metric observations into character-level observations.
 * Averages normalized values across runs with available data; never invents zero for missing runs.
 */
export function aggregateCombatObservations(
  perRunObservations: MetricObservationDTO[][],
  observedAt: string,
  options: { selectedRunCount: number; detailedRunCount: number },
): MetricObservationDTO[] {
  if (perRunObservations.length === 0) return [];

  const byKey = new Map<string, MetricObservationDTO[]>();
  for (const runObs of perRunObservations) {
    for (const obs of runObs) {
      const bucket = byKey.get(obs.metricKey) ?? [];
      bucket.push(obs);
      byKey.set(obs.metricKey, bucket);
    }
  }

  const coverageRatio = options.selectedRunCount > 0 ? options.detailedRunCount / options.selectedRunCount : 0;
  const aggregated: MetricObservationDTO[] = [];

  for (const [metricKey, obsList] of byKey) {
    const available = obsList.filter((o) => o.normalizedValue != null);
    if (available.length === 0) continue;

    const avgNormalized =
      available.reduce((sum, o) => sum + (o.normalizedValue ?? 0), 0) / available.length;
    const avgRaw =
      available.reduce((sum, o) => sum + (o.rawValue ?? 0), 0) / available.length;
    const avgConfidence =
      available.reduce((sum, o) => sum + o.confidence, 0) / available.length;
    const dimension = available[0]!.dimension;

    aggregated.push({
      metricKey,
      dimension,
      rawValue: avgRaw,
      normalizedValue: avgNormalized,
      confidence: clamp01(avgConfidence * coverageRatio),
      observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: available.length,
        expected: options.selectedRunCount,
        ratio: coverageRatio,
      },
      context: {
        aggregatedFromRuns: available.length,
        selectedRunCount: options.selectedRunCount,
        detailedRunCount: options.detailedRunCount,
        perRun: available.map((o) => ({
          rawValue: o.rawValue,
          normalizedValue: o.normalizedValue,
          context: o.context,
        })),
      },
    });
  }

  return aggregated;
}
