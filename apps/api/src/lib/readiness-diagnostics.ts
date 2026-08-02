/**
 * Assembles /health/ready probes including Scoring V2 diagnostics.
 * Readiness probes are read-only: no mkdir, no writes, no provider calls.
 */

import { access, constants, stat } from "node:fs/promises";
import path from "node:path";
import {
  getScoringV2FlagSummary,
  type AppEnv,
} from "@mplus/config";
import {
  SCORING_V2_CONTRACT_VERSIONS,
  evaluateReadiness,
  evaluateWclProviderUsability,
  requiredProbesForModes,
  type ReadinessEvaluation,
  type ReadinessProbeResults,
  type ScoringV2ModeSnapshot,
} from "@mplus/observability";

export const ARTIFACT_PROBE_TIMEOUT_MS = 2_000;

function withTimeout<T>(timeoutMs: number, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error("probe_timeout"), { code: "probe_timeout" }));
    }, timeoutMs);
    work().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Read-only artifact backend probe. Never creates directories or files.
 */
export async function probeArtifactBackend(
  rootDir: string,
  options?: { timeoutMs?: number },
): Promise<{
  ok: boolean;
  scheme: string;
  detail?: string;
}> {
  const timeoutMs = options?.timeoutMs ?? ARTIFACT_PROBE_TIMEOUT_MS;
  try {
    await withTimeout(timeoutMs, async () => {
      const resolved = path.resolve(rootDir);
      const st = await stat(resolved);
      if (!st.isDirectory()) {
        throw Object.assign(new Error("not_directory"), { code: "not_directory" });
      }
      await access(resolved, constants.R_OK | constants.W_OK);
    });
    return { ok: true, scheme: "cas" };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "probe_timeout") {
      return { ok: false, scheme: "cas", detail: "probe_timeout" };
    }
    if (code === "ENOENT") {
      return { ok: false, scheme: "cas", detail: "path_missing" };
    }
    if (code === "not_directory") {
      return { ok: false, scheme: "cas", detail: "not_directory" };
    }
    return { ok: false, scheme: "cas", detail: "not_accessible" };
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
  /** Injectable for tests — defaults to real read-only probe. */
  artifactProbe?: typeof probeArtifactBackend;
}): Promise<ReadinessEvaluation & { probes: ReadinessProbeResults }> {
  const modes = toModeSnapshot(input.env);
  const required = requiredProbesForModes(modes);
  const probeFn = input.artifactProbe ?? probeArtifactBackend;

  // Do not touch the filesystem when artifact storage is unused.
  const artifact = required.artifactBackend
    ? await probeFn(input.env.RAW_ARTIFACTS_DIR)
    : { ok: true, scheme: "cas", detail: "not_probed" as const };

  const modelOk =
    !required.modelCatalog ||
    (input.activeModel != null &&
      typeof input.activeModel.key === "string" &&
      input.activeModel.key.length > 0);

  const wclRequired = required.wclProviderConfigured;
  const wclUsability = evaluateWclProviderUsability({
    required: wclRequired,
    enabled: input.providers.warcraftlogs.enabled,
    configured: input.providers.warcraftlogs.configured,
    providerMode: input.env.PROVIDER_MODE,
  });

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
      required: wclRequired,
      usable: wclUsability.usable,
      providerMode: input.env.PROVIDER_MODE,
      ...(wclUsability.detail ? { detail: wclUsability.detail } : {}),
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
