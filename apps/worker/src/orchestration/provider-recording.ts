import type { ProviderResult } from "@mplus/contracts";
import { getMetricsRegistry } from "@mplus/observability";
import type { WorkerRepositories } from "../persistence/index.js";

export async function recordProviderResult(
  repositories: WorkerRepositories,
  result: ProviderResult<unknown>,
): Promise<string | null> {
  const started = Date.parse(result.metadata.requestedAt);
  const completed = result.metadata.completedAt ? Date.parse(result.metadata.completedAt) : started;
  const durationMs = Math.max(0, completed - started);

  getMetricsRegistry().recordProviderRequest({
    provider: result.metadata.provider,
    endpointKey: result.metadata.endpointKey,
    statusCode: result.metadata.statusCode,
    durationMs,
    cacheHit: result.metadata.cacheHit,
  });

  const { payload } = await repositories.externalRequest.recordRequestAndPayload({
    provider: result.metadata.provider,
    requestFingerprint: result.metadata.requestFingerprint,
    endpointKey: result.metadata.endpointKey,
    method: "GET",
    requestedAt: new Date(result.metadata.requestedAt),
    completedAt: result.metadata.completedAt ? new Date(result.metadata.completedAt) : null,
    statusCode: result.metadata.statusCode,
    cacheHit: result.metadata.cacheHit,
    retryCount: result.metadata.retryCount,
    costUnits: result.metadata.costUnits,
    expiresAt: result.freshness.expiresAt ? new Date(result.freshness.expiresAt) : null,
    payload: result.data,
    schemaVersion: result.provenance.schemaVersion,
  });

  return payload?.id ?? null;
}
