import { randomUUID } from "node:crypto";
import type { RunAnalysis } from "@mplus/database";
import { normalizeRegion } from "@mplus/domain";
import { ExternalApiError, type AnalyzeRunJob, type ProviderFetchContext } from "@mplus/contracts";
import type { WorkerContainer } from "../container.js";

/**
 * Standalone analyze-run stage for the `analyze-run` queue (admin re-analysis, backfills).
 * The `refresh-character` pipeline runs this logic inline for newly discovered runs.
 */
export async function runAnalyzeRun(container: WorkerContainer, job: AnalyzeRunJob): Promise<RunAnalysis> {
  const { repositories, providers } = container;

  const character = await repositories.character.findById(job.characterId);
  if (!character) {
    throw new ExternalApiError({
      message: `Character ${job.characterId} not found`,
      code: "NOT_FOUND",
      provider: "warcraftlogs",
      retryable: false,
    });
  }

  const source = await repositories.run.findWclSource(job.runId);
  if (!source) {
    throw new ExternalApiError({
      message: `No Warcraft Logs source reference found for run ${job.runId}`,
      code: "NOT_FOUND",
      provider: "warcraftlogs",
      retryable: false,
    });
  }

  const region = await container.prisma.region.findUnique({ where: { id: character.regionId } });
  const now = new Date();
  const ctx: ProviderFetchContext = {
    region: normalizeRegion(region?.code ?? "EU"),
    requestId: randomUUID(),
    correlationId: null,
    forceRefresh: false,
    now: now.toISOString(),
  };

  const details = await providers.warcraftlogs.getReportFightDetails(source.reportCode, source.fightId, ctx);

  return repositories.run.upsertRunAnalysis({
    runId: job.runId,
    characterId: job.characterId,
    analysisVersion: job.analysisVersion,
    analyzedAt: now,
    coverage: 1,
    summary: details.data,
  });
}
