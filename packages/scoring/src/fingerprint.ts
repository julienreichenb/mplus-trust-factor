import { createHash } from "node:crypto";
import type { MetricObservationDTO } from "@mplus/contracts";
import type { ScoreModelConfigV1, ScoringContext } from "./types.js";

export function computeInputFingerprint(parts: {
  characterId: string;
  seasonSlug: string;
  model: Pick<ScoreModelConfigV1, "key" | "version">;
  scopeType: string;
  scopeKey: string | null;
  observations: MetricObservationDTO[];
  context: ScoringContext;
}): string {
  const obs = [...parts.observations]
    .map((o) => ({
      metricKey: o.metricKey,
      dimension: o.dimension,
      rawValue: o.rawValue,
      normalizedValue: o.normalizedValue,
      confidence: o.confidence,
      observedAt: o.observedAt,
      sourceProvider: o.sourceProvider,
      coverage: o.coverage,
      context: o.context,
    }))
    .sort((a, b) => a.metricKey.localeCompare(b.metricKey));

  const payload = JSON.stringify({
    characterId: parts.characterId,
    seasonSlug: parts.seasonSlug,
    modelKey: parts.model.key,
    modelVersion: parts.model.version,
    scopeType: parts.scopeType,
    scopeKey: parts.scopeKey,
    observations: obs,
    context: {
      role: parts.context.role,
      classSlug: parts.context.classSlug ?? null,
      specSlug: parts.context.specSlug ?? null,
      freshness: parts.context.freshness ?? null,
      selectedRunCoverage: parts.context.selectedRunCoverage ?? null,
      mechanicCatalogVersion: parts.context.mechanicCatalogVersion ?? null,
      authenticity: parts.context.authenticity ?? null,
    },
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
