import { createHash } from "node:crypto";
import type { MetricObservationDTO } from "@mplus/contracts";

export interface ScoreInputFingerprintOptions {
  /** Invalidates score snapshots when the WCL Performance adapter contract changes. */
  performanceAdapterVersion?: string | null;
  /** Selected-run identity so 9-run Icecrown selections cannot collide with 8-run pools. */
  scoringRunSelectionKey?: string | null;
  /** When force-refreshing, include the job request time so a new snapshot is always published. */
  forceRefreshToken?: string | null;
}

/** Deterministic fingerprint of the inputs feeding a score calculation (for snapshot dedupe). */
export function fingerprintObservations(
  characterId: string,
  modelKey: string,
  modelVersion: number,
  observations: MetricObservationDTO[],
  options: ScoreInputFingerprintOptions = {},
): string {
  const material = [
    characterId,
    modelKey,
    String(modelVersion),
    options.performanceAdapterVersion ?? "",
    options.scoringRunSelectionKey ?? "",
    options.forceRefreshToken ?? "",
    ...observations
      .map((o) => `${o.metricKey}:${o.rawValue ?? "null"}:${o.normalizedValue ?? "null"}:${o.confidence}`)
      .sort(),
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function buildScoringRunSelectionKey(
  selectedRuns: Array<{ dungeonSlug: string; canonicalRunId: string; keyLevel: number }>,
): string {
  return selectedRuns
    .map((r) => `${r.dungeonSlug}:${r.canonicalRunId}:${r.keyLevel}`)
    .sort()
    .join(",");
}
