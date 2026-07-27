import { createHash } from "node:crypto";
import type { MetricObservationDTO } from "@mplus/contracts";

/** Deterministic fingerprint of the inputs feeding a score calculation (for snapshot dedupe). */
export function fingerprintObservations(
  characterId: string,
  modelKey: string,
  modelVersion: number,
  observations: MetricObservationDTO[],
): string {
  const material = [
    characterId,
    modelKey,
    String(modelVersion),
    ...observations
      .map((o) => `${o.metricKey}:${o.rawValue ?? "null"}:${o.normalizedValue ?? "null"}:${o.confidence}`)
      .sort(),
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}
