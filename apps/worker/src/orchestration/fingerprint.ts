import { createHash } from "node:crypto";
import type { MetricObservationDTO, RefreshContractVersions } from "@mplus/contracts";
import { hashRefreshContract } from "@mplus/contracts";

export interface ScoreInputFingerprintOptions {
  /** Full refresh contract — preferred over ad-hoc adapter fields. */
  refreshContract?: RefreshContractVersions | null;
  /** @deprecated Prefer refreshContract.wclAdapterVersion */
  performanceAdapterVersion?: string | null;
  /** Selected-run identity so concrete run sets cannot collide across refreshes. */
  scoringRunSelectionKey?: string | null;
  /** When force-refreshing, include the job request time so a new snapshot is always published. */
  forceRefreshToken?: string | null;
  /** Overall score formula — invalidates snapshots when v6 formula strategy changes. */
  overallFormula?: string | null;
}

/** Deterministic fingerprint of the inputs feeding a score calculation (for snapshot dedupe). */
export function fingerprintObservations(
  characterId: string,
  modelKey: string,
  modelVersion: number,
  observations: MetricObservationDTO[],
  options: ScoreInputFingerprintOptions = {},
): string {
  const contractHash = options.refreshContract
    ? hashRefreshContract(options.refreshContract)
    : "";
  const material = [
    characterId,
    modelKey,
    String(modelVersion),
    options.overallFormula ?? "LEGACY_AUTHENTICITY_CONFIDENCE_BLEND",
    contractHash,
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
