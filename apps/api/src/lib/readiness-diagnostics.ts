/**
 * Assembles /health/ready probes including Scoring V2 diagnostics.
 */

import { access, constants, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  getScoringV2FlagSummary,
  type AppEnv,
} from "@mplus/config";
import {
  SCORING_V2_CONTRACT_VERSIONS,
  evaluateReadiness,
  requiredProbesForModes,
  type ReadinessEvaluation,
  type ReadinessProbeResults,
  type ScoringV2ModeSnapshot,
} from "@mplus/observability";

export async function probeArtifactBackend(rootDir: string): Promise<{
  ok: boolean;
  scheme: string;
  detail?: string;
}> {
  try {
    const resolved = path.resolve(rootDir);
    await mkdir(resolved, { recursive: true });
    await access(resolved, constants.R_OK | constants.W_OK);
    return { ok: true, scheme: "cas" };
  } catch {
    return { ok: false, scheme: "cas", detail: "not_writable" };
  }
}

export function toModeSnapshot(env: AppEnv): ScoringV2ModeSnapshot {
  const summary = getScoringV2FlagSummary(env);
  return {
    enabled: summary.enabled,
    selectionEnabled: summary.selectionEnabled,
    evidenceFetchEnabled: summary.evidenceFetchEnabled,
    dimensionsEnabled: summary.dimensionsEnabled,
    publicationEnabled: summary.publicationEnabled,
    incompatibleReasons: summary.incompatibleReasons,
    relativeDamageMode: summary.relativeDamageMode,
    utilityOpportunityMode: summary.utilityOpportunityMode,
    referenceComparisonMode: summary.referenceComparisonMode,
    calibrationV2Enabled: summary.calibrationV2Enabled,
  };
}

export async function buildApiReadiness(input: {
  env: AppEnv;
  database: { ok: boolean; latencyMs: number };
  redis: { ok: boolean; latencyMs: number; skipped?: boolean };
  queueMode: string;
  providers: {
    warcraftlogs: { enabled: boolean; configured: boolean };
  };
  activeModel: { key: string; version: number } | null;
}): Promise<ReadinessEvaluation & { probes: ReadinessProbeResults }> {
  const modes = toModeSnapshot(input.env);
  const required = requiredProbesForModes(modes);
  const artifact = await probeArtifactBackend(input.env.RAW_ARTIFACTS_DIR);

  const modelOk =
    !required.modelCatalog ||
    (input.activeModel != null &&
      typeof input.activeModel.key === "string" &&
      input.activeModel.key.length > 0);

  const probes: ReadinessProbeResults = {
    revision: input.env.APP_VERSION,
    apiContractVersion: SCORING_V2_CONTRACT_VERSIONS.apiExplainability,
    workerJobSchemaVersion: SCORING_V2_CONTRACT_VERSIONS.workerJobSchema,
    scoringV2: modes,
    databaseOk: input.database.ok,
    redisOk: input.redis.ok,
    redisSkipped: Boolean(input.redis.skipped),
    queueMode: input.queueMode,
    artifactBackend: {
      ok: artifact.ok,
      scheme: artifact.scheme,
      required: required.artifactBackend,
      ...(artifact.detail ? { detail: artifact.detail } : {}),
    },
    // Snapshot freshness is enforced on the worker when admission mode requires it.
    wclSnapshot: {
      state: "worker_owned",
      required: false,
      ageSeconds: null,
      detail: "enforced_on_worker_when_admission_enforce",
    },
    modelCatalog: {
      ok: modelOk,
      required: required.modelCatalog,
      activeModelKey: input.activeModel?.key ?? null,
      activeModelVersion: input.activeModel?.version ?? null,
      ...(modelOk ? {} : { detail: "active_score_model_missing" }),
    },
    wclProvider: {
      enabled: input.providers.warcraftlogs.enabled,
      configured: input.providers.warcraftlogs.configured,
      required: required.wclProviderConfigured && input.providers.warcraftlogs.enabled,
    },
  };

  const evaluation = evaluateReadiness(probes);
  return {
    ...evaluation,
    body: {
      ...evaluation.body,
      database: {
        ok: input.database.ok,
        latencyMs: input.database.latencyMs,
        ...(input.database.ok ? {} : { error: "database unreachable" }),
      },
      redis: {
        ok: input.redis.ok,
        latencyMs: input.redis.latencyMs,
        ...(input.redis.skipped ? { skipped: true } : {}),
        ...(input.redis.ok ? {} : { error: "redis unreachable" }),
      },
      providers: input.providers,
    },
    probes,
  };
}
