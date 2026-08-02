/**
 * Pure Scoring V2 readiness evaluation.
 * Probes supply booleans; this module decides which failures are gate-worthy
 * based on enabled feature modes.
 */

export interface ScoringV2ModeSnapshot {
  enabled: boolean;
  selectionEnabled: boolean;
  evidenceFetchEnabled: boolean;
  dimensionsEnabled: boolean;
  publicationEnabled: boolean;
  incompatibleReasons: string[];
  relativeDamageMode?: string;
  utilityOpportunityMode?: string;
  referenceComparisonMode?: string;
  calibrationV2Enabled?: boolean;
}

export interface WclProviderProbe {
  /** WCL_ENABLED (or equivalent) — implementation toggle. */
  enabled: boolean;
  /** Credentials present, or fixture mode marks configured. */
  configured: boolean;
  /** Required by enabled Scoring V2 modes (e.g. evidence fetch). */
  required: boolean;
  /**
   * Actually usable for the current execution mode.
   * Fixture mode may satisfy when configured; live mode needs enabled+configured.
   */
  usable: boolean;
  providerMode?: "fixture" | "live" | string;
  detail?: string;
}

export interface ReadinessProbeResults {
  revision: string;
  apiContractVersion: string;
  workerJobSchemaVersion: string;
  scoringV2: ScoringV2ModeSnapshot;
  databaseOk: boolean;
  redisOk: boolean;
  redisSkipped: boolean;
  queueMode: "inline" | "bullmq" | string;
  /** Artifact backend reachable/writable when probed. */
  artifactBackend: {
    ok: boolean;
    scheme: string;
    required: boolean;
    detail?: string;
  };
  /** WCL rate snapshot age/state (worker-owned in enforce mode). */
  wclSnapshot: {
    state: "ok" | "stale" | "missing" | "invalid" | "not_required" | "not_probed" | "worker_owned";
    ageSeconds?: number | null;
    required: boolean;
    detail?: string;
  };
  /** Active model / catalog compatibility for enabled modes. */
  modelCatalog: {
    ok: boolean;
    required: boolean;
    activeModelKey?: string | null;
    activeModelVersion?: number | null;
    detail?: string;
  };
  /** Provider config required by enabled V2 fetch. */
  wclProvider: WclProviderProbe;
}

export interface ReadinessEvaluation {
  ready: boolean;
  failingReasons: string[];
  body: Record<string, unknown>;
}

/**
 * Decide whether WCL is usable when Scoring V2 modes require it.
 * Never treats WCL_ENABLED=false as making a required dependency optional.
 */
export function evaluateWclProviderUsability(input: {
  required: boolean;
  enabled: boolean;
  configured: boolean;
  providerMode: string;
}): Pick<WclProviderProbe, "usable" | "detail"> {
  if (!input.required) {
    return { usable: true };
  }
  // Repository-supported fixture mode satisfies WCL without live credentials.
  if (input.providerMode === "fixture" && input.configured) {
    return { usable: true };
  }
  if (!input.configured) {
    return { usable: false, detail: "wcl_credentials_missing" };
  }
  if (!input.enabled) {
    return { usable: false, detail: "wcl_provider_disabled" };
  }
  return { usable: true };
}

/**
 * Fail readiness only for conditions required by enabled modes.
 * Baseline DB/Redis rules stay: DB always required; Redis required unless skipped/inline.
 */
export function evaluateReadiness(probes: ReadinessProbeResults): ReadinessEvaluation {
  const failingReasons: string[] = [];

  if (!probes.databaseOk) {
    failingReasons.push("database_unreachable");
  }
  if (!probes.redisOk && !probes.redisSkipped) {
    failingReasons.push("redis_unreachable");
  }

  if (probes.scoringV2.incompatibleReasons.length > 0) {
    failingReasons.push("scoring_v2_flag_incompatible");
  }

  if (probes.artifactBackend.required && !probes.artifactBackend.ok) {
    failingReasons.push(
      probes.artifactBackend.detail === "probe_timeout"
        ? "artifact_backend_probe_timeout"
        : "artifact_backend_not_ready",
    );
  }

  if (probes.wclSnapshot.required && probes.wclSnapshot.state !== "ok" && probes.wclSnapshot.state !== "worker_owned") {
    failingReasons.push(`wcl_snapshot_${probes.wclSnapshot.state}`);
  }

  if (probes.modelCatalog.required && !probes.modelCatalog.ok) {
    failingReasons.push("model_catalog_incompatible");
  }

  if (probes.wclProvider.required && !probes.wclProvider.usable) {
    failingReasons.push(probes.wclProvider.detail ?? "wcl_provider_not_usable");
  }

  // Evidence fetch in bullmq mode needs queue connectivity (redis).
  if (
    probes.scoringV2.evidenceFetchEnabled &&
    probes.queueMode !== "inline" &&
    !probes.redisOk
  ) {
    if (!failingReasons.includes("redis_unreachable")) {
      failingReasons.push("queue_connectivity_required");
    }
  }

  const ready = failingReasons.length === 0;
  return {
    ready,
    failingReasons,
    body: {
      status: ready ? "ready" : "not_ready",
      revision: probes.revision,
      contracts: {
        api: probes.apiContractVersion,
        workerJobSchema: probes.workerJobSchemaVersion,
        evidenceManifest: SCORING_V2_CONTRACT_VERSIONS.evidenceManifest,
        acquisitionPlan: SCORING_V2_CONTRACT_VERSIONS.acquisitionPlan,
      },
      scoringV2: {
        modes: probes.scoringV2,
        incompatibleReasons: probes.scoringV2.incompatibleReasons,
      },
      database: { ok: probes.databaseOk },
      redis: {
        ok: probes.redisOk,
        ...(probes.redisSkipped ? { skipped: true } : {}),
      },
      queueMode: probes.queueMode,
      artifactBackend: probes.artifactBackend,
      wclSnapshot: probes.wclSnapshot,
      modelCatalog: probes.modelCatalog,
      wclProvider: probes.wclProvider,
      failingReasons,
    },
  };
}

export const SCORING_V2_CONTRACT_VERSIONS = {
  evidenceManifest: "2.0.0",
  acquisitionPlan: "2.0.0",
  workerJobSchema: "2.0.0",
  apiExplainability: "2.0.0",
} as const;

/** Derive which probes are required from V2 modes. */
export function requiredProbesForModes(modes: ScoringV2ModeSnapshot): {
  artifactBackend: boolean;
  wclProviderConfigured: boolean;
  modelCatalog: boolean;
  /** Snapshot freshness is worker-owned; API reports worker_owned unless enforce probe is supplied. */
  wclSnapshot: boolean;
} {
  return {
    artifactBackend: modes.evidenceFetchEnabled,
    wclProviderConfigured: modes.evidenceFetchEnabled,
    modelCatalog: modes.dimensionsEnabled || modes.publicationEnabled,
    wclSnapshot: false,
  };
}
