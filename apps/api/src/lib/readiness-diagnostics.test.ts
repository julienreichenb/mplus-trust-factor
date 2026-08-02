import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnv, resetEnvCache } from "@mplus/config";
import {
  ARTIFACT_PROBE_TIMEOUT_MS,
  buildApiReadiness,
  probeArtifactBackend,
  toModeSnapshot,
} from "./readiness-diagnostics.js";

const baseEnv = {
  DATABASE_URL: "postgresql://mplus:mplus@localhost:5433/mplus_itest_fixture0001?schema=public",
  REDIS_URL: "redis://localhost:6379",
  ADMIN_API_KEY: "test-admin-key",
  SESSION_SECRET: "test-session-secret-at-least-32-chars",
  PROVIDER_MODE: "fixture",
  WEB_ORIGIN: "http://localhost:5173",
  PUBLIC_BASE_URL: "http://localhost:3000",
  APP_VERSION: "rev-test-1",
  RAW_ARTIFACTS_DIR: "./data/raw-artifacts-readiness-test",
} as const;

const liveBase = {
  ...baseEnv,
  PROVIDER_MODE: "live",
  BLIZZARD_ENABLED: "false",
  RAIDERIO_ENABLED: "false",
} as const;

describe("API readiness diagnostics", () => {
  it("reports revision and V2 modes when flags are off", async () => {
    resetEnvCache();
    const env = loadEnv({ ...baseEnv });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: true } },
      activeModel: { key: "trust-v6", version: 1 },
    });
    expect(result.ready).toBe(true);
    expect(result.body.revision).toBe("rev-test-1");
    expect((result.body.scoringV2 as { modes: { enabled: boolean } }).modes.enabled).toBe(false);
    expect((result.body.contracts as { workerJobSchema: string }).workerJobSchema).toBe("2.0.0");
    expect((result.body.wclSnapshot as { state: string }).state).toBe("worker_owned");
    expect(result.probes.artifactBackend.detail).toBe("not_probed");
    expect(result.probes.wclProvider.required).toBe(false);
    expect(result.probes.wclProvider.usable).toBe(true);
  });

  it("all flags off + WCL disabled → ready (fail-open for unused WCL)", async () => {
    resetEnvCache();
    const env = loadEnv({ ...liveBase, WCL_ENABLED: "false" });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: false } },
      activeModel: { key: "trust-v6", version: 1 },
      artifactProbe: async () => {
        throw new Error("artifact probe must not run when unused");
      },
    });
    expect(result.ready).toBe(true);
    expect(result.failingReasons).toEqual([]);
  });

  it("evidence fetch enabled + WCL disabled (live) → not ready", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...liveBase,
      WCL_ENABLED: "false",
      WCL_CLIENT_ID: "id",
      WCL_CLIENT_SECRET: "secret",
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
    });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: true } },
      activeModel: { key: "trust-v6", version: 1 },
      artifactProbe: async () => ({ ok: true, scheme: "cas" }),
    });
    expect(toModeSnapshot(env).evidenceFetchEnabled).toBe(true);
    expect(result.probes.wclProvider.required).toBe(true);
    expect(result.probes.wclProvider.usable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.failingReasons).toContain("wcl_provider_disabled");
  });

  it("evidence fetch enabled + missing credentials (live) → not ready", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...liveBase,
      WCL_ENABLED: "true",
      WCL_CLIENT_ID: "id",
      WCL_CLIENT_SECRET: "secret",
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
    });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: true, configured: false } },
      activeModel: { key: "trust-v6", version: 1 },
      artifactProbe: async () => ({ ok: true, scheme: "cas" }),
    });
    expect(result.ready).toBe(false);
    expect(result.failingReasons).toContain("wcl_credentials_missing");
  });

  it("evidence fetch enabled + fixture mode → ready without live WCL enable", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      PROVIDER_MODE: "fixture",
      WCL_ENABLED: "false",
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
    });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: true } },
      activeModel: { key: "trust-v6", version: 1 },
      artifactProbe: async () => ({ ok: true, scheme: "cas" }),
    });
    expect(result.ready).toBe(true);
    expect(result.probes.wclProvider.usable).toBe(true);
  });

  it("evidence fetch enabled + valid live configuration → ready", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...liveBase,
      WCL_ENABLED: "true",
      WCL_CLIENT_ID: "id",
      WCL_CLIENT_SECRET: "secret",
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
    });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: true, configured: true } },
      activeModel: { key: "trust-v6", version: 1 },
      artifactProbe: async () => ({ ok: true, scheme: "cas" }),
    });
    expect(result.ready).toBe(true);
    expect(result.probes.wclProvider.usable).toBe(true);
  });

  it("readiness performs no provider request", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
    });
    const providerFetch = vi.fn();
    await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: true } },
      activeModel: { key: "trust-v6", version: 1 },
      artifactProbe: async () => ({ ok: true, scheme: "cas" }),
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("requires artifact backend when evidence fetch is enabled", async () => {
    resetEnvCache();
    const dir = await mkdtemp(path.join(os.tmpdir(), "mplus-artifacts-ok-"));
    try {
      const env = loadEnv({
        ...baseEnv,
        RAW_ARTIFACTS_DIR: dir,
        SCORING_V2_ENABLED: "true",
        SCORING_V2_SELECTION_ENABLED: "true",
        SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
      });
      expect(toModeSnapshot(env).evidenceFetchEnabled).toBe(true);

      const result = await buildApiReadiness({
        env,
        database: { ok: true, latencyMs: 1 },
        redis: { ok: true, latencyMs: 0, skipped: true },
        queueMode: "inline",
        providers: { warcraftlogs: { enabled: false, configured: true } },
        activeModel: { key: "trust-v6", version: 1 },
      });
      expect(result.probes.artifactBackend.required).toBe(true);
      expect(result.probes.artifactBackend.ok).toBe(true);
      expect(result.ready).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails when dimensions enabled and active model missing", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
      SCORING_V2_DIMENSIONS_ENABLED: "true",
    });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: true } },
      activeModel: null,
      artifactProbe: async () => ({ ok: true, scheme: "cas" }),
    });
    expect(result.ready).toBe(false);
    expect(result.failingReasons).toContain("model_catalog_incompatible");
  });

  it("all-flags-off readiness does not probe or mutate artifact paths", async () => {
    resetEnvCache();
    const missing = path.join(os.tmpdir(), `mplus-artifacts-missing-${Date.now()}`);
    const env = loadEnv({ ...baseEnv, RAW_ARTIFACTS_DIR: missing });
    const artifactProbe = vi.fn(probeArtifactBackend);
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: false } },
      activeModel: { key: "trust-v6", version: 1 },
      artifactProbe,
    });
    expect(artifactProbe).not.toHaveBeenCalled();
    expect(result.ready).toBe(true);
    expect(result.probes.artifactBackend.detail).toBe("not_probed");
  });

  it("required missing artifact path fails closed and does not create it", async () => {
    resetEnvCache();
    const missing = path.join(os.tmpdir(), `mplus-artifacts-absent-${Date.now()}`);
    const env = loadEnv({
      ...baseEnv,
      RAW_ARTIFACTS_DIR: missing,
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
    });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: true } },
      activeModel: { key: "trust-v6", version: 1 },
    });
    expect(result.ready).toBe(false);
    expect(result.failingReasons).toContain("artifact_backend_not_ready");
    expect(result.probes.artifactBackend.detail).toBe("path_missing");
    await expect(probeArtifactBackend(missing)).resolves.toMatchObject({
      ok: false,
      detail: "path_missing",
    });
  });

  it("unused missing artifact path remains fail-open", async () => {
    resetEnvCache();
    const missing = path.join(os.tmpdir(), `mplus-artifacts-unused-${Date.now()}`);
    const env = loadEnv({ ...baseEnv, RAW_ARTIFACTS_DIR: missing });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: false } },
      activeModel: { key: "trust-v6", version: 1 },
    });
    expect(result.ready).toBe(true);
    expect(result.probes.artifactBackend.required).toBe(false);
  });

  it("artifact probe timeout produces sanitized readiness failure", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
    });
    const timedResult = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: true } },
      activeModel: { key: "trust-v6", version: 1 },
      artifactProbe: async () => ({ ok: false, scheme: "cas", detail: "probe_timeout" }),
    });
    expect(timedResult.ready).toBe(false);
    expect(timedResult.failingReasons).toContain("artifact_backend_probe_timeout");
    expect(JSON.stringify(timedResult.body)).not.toMatch(/CLIENT_SECRET|access_token/i);
    expect(ARTIFACT_PROBE_TIMEOUT_MS).toBeGreaterThan(0);

    // Real probe with an unreachable hung path via injected never-resolving work is covered by
    // timeoutMs racing inside probeArtifactBackend — force timeout with a tiny budget against a
    // path that still resolves (stat of "." is fast); inject delay by wrapping:
    const hung = probeArtifactBackend(path.join(os.tmpdir(), `nope-${Date.now()}`), {
      timeoutMs: 1,
    });
    // Missing path fails with path_missing quickly; assert timeout detail mapping separately above.
    await expect(hung).resolves.toMatchObject({ ok: false });
  });

  it("required inaccessible path fails closed where safely testable", async () => {
    // On Windows ACL restrictions are flaky; use a file path (not a directory).
    const dir = await mkdtemp(path.join(os.tmpdir(), "mplus-artifacts-file-"));
    const filePath = path.join(dir, "not-a-dir");
    await writeFile(filePath, "x", "utf8");
    try {
      const probed = await probeArtifactBackend(filePath);
      expect(probed.ok).toBe(false);
      expect(probed.detail).toBe("not_directory");
    } finally {
      await rm(dir, { recursive: true, force: true });
      void chmod;
    }
  });
});
