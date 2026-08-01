/**
 * Admission WCL snapshot capability / readiness / single-flight regressions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWclRateLimitFetchContext,
  hasWarcraftLogsRateLimitCapability,
  WCL_RATE_LIMIT_CONTEXT_REGION,
  type ProviderFetchContext,
  type WarcraftLogsProvider,
  type WclRateBudgetDecisionDTO,
} from "@mplus/contracts";
import { createDisabledProvider } from "../../providers/fixture-providers.js";
import { createWarcraftLogsProvider } from "@mplus/provider-warcraftlogs";
import {
  bootstrapWclAdmissionSnapshotRefresher,
  checkAdmissionSnapshotReadiness,
  InMemoryAdmissionRedis,
  readWclAdmissionSnapshot,
  startWclAdmissionSnapshotRefresher,
  validateAdmissionRateSnapshot,
  writeWclAdmissionSnapshot,
} from "./index.js";
import type { RefreshAdmissionRateSnapshot } from "./types.js";

function freshSnapshot(
  overrides: Partial<RefreshAdmissionRateSnapshot> = {},
): RefreshAdmissionRateSnapshot {
  const fetchedAt = "2026-07-31T12:00:00.000Z";
  const resetAt = "2026-07-31T13:00:00.000Z";
  return {
    pointsRemaining: 500,
    pointsLimit: 1000,
    resetAt,
    fetchedAt,
    windowId: `win:${Math.floor(Date.parse(resetAt) / 1000)}`,
    ...overrides,
  };
}

function capableProvider(
  overrides: {
    decision?: WclRateBudgetDecisionDTO;
    fetchImpl?: (ctx: ProviderFetchContext) => Promise<WclRateBudgetDecisionDTO>;
  } = {},
): WarcraftLogsProvider {
  const decision: WclRateBudgetDecisionDTO = overrides.decision ?? {
    action: "OK",
    utilizationPercent: 10,
    snapshot: {
      pointsRemaining: 500,
      pointsLimit: 1000,
      resetAt: "2026-07-31T13:00:00.000Z",
      fetchedAt: new Date().toISOString(),
    },
  };
  return {
    name: "warcraftlogs",
    rateLimitSupported: true,
    fetchRateLimit: overrides.fetchImpl ?? (async () => decision),
    discoverCharacterRuns: async () => {
      throw new Error("not used");
    },
    getReportFightDetails: async () => {
      throw new Error("not used");
    },
  };
}

function incapableProvider(): WarcraftLogsProvider {
  return {
    name: "warcraftlogs",
    // no rateLimitSupported / fetchRateLimit
    discoverCharacterRuns: async () => {
      throw new Error("not used");
    },
    getReportFightDetails: async () => {
      throw new Error("not used");
    },
  };
}

describe("WCL admission snapshot capability & readiness", () => {
  it("1. enforce + WCL enabled + missing capability does not report ready", async () => {
    const redis = new InMemoryAdmissionRedis();
    const handle = await bootstrapWclAdmissionSnapshotRefresher({
      redis,
      appEnv: "test",
      warcraftlogs: incapableProvider(),
      intervalMs: 10_000,
      maxAgeSeconds: 60,
      admissionMode: "enforce",
      wclEnabled: true,
    });
    expect(handle.started).toBe(false);
    expect(handle.reason).toBe("capability_missing");

    const ready = await checkAdmissionSnapshotReadiness({
      env: {
        REFRESH_ADMISSION_MODE: "enforce",
        WCL_ENABLED: true,
        APP_ENV: "test",
        REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS: 60,
      },
      redis,
      refresherUnavailable: true,
    });
    expect(ready.ok).toBe(false);
    expect(ready.detail).toBe("admission_snapshot_refresher_unavailable");
  });

  it("2. shadow + missing capability warns but may continue", async () => {
    const warnings: string[] = [];
    const redis = new InMemoryAdmissionRedis();
    const handle = await bootstrapWclAdmissionSnapshotRefresher({
      redis,
      appEnv: "test",
      warcraftlogs: incapableProvider(),
      logger: {
        warn: (obj: unknown, msg?: string) => {
          warnings.push(typeof msg === "string" ? msg : JSON.stringify(obj));
        },
        error: () => undefined,
        info: () => undefined,
      } as never,
      intervalMs: 10_000,
      maxAgeSeconds: 60,
      admissionMode: "shadow",
      wclEnabled: true,
    });
    expect(handle.started).toBe(false);
    expect(handle.reason).toBe("capability_missing");
    expect(warnings.some((w) => w.includes("shadow"))).toBe(true);

    const ready = await checkAdmissionSnapshotReadiness({
      env: {
        REFRESH_ADMISSION_MODE: "shadow",
        WCL_ENABLED: true,
        APP_ENV: "test",
        REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS: 60,
      },
      redis,
    });
    expect(ready.ok).toBe(true);
    expect(ready.detail).toBe("admission_snapshot_not_required");
  });

  it("3. enforce + WCL disabled does not require a snapshot", async () => {
    const redis = new InMemoryAdmissionRedis();
    const handle = await bootstrapWclAdmissionSnapshotRefresher({
      redis,
      appEnv: "test",
      warcraftlogs: incapableProvider(),
      intervalMs: 10_000,
      maxAgeSeconds: 60,
      admissionMode: "enforce",
      wclEnabled: false,
    });
    expect(handle.started).toBe(false);
    expect(handle.reason).toBe("wcl_disabled_not_required");

    const ready = await checkAdmissionSnapshotReadiness({
      env: {
        REFRESH_ADMISSION_MODE: "enforce",
        WCL_ENABLED: false,
        APP_ENV: "test",
        REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS: 60,
      },
      redis,
    });
    expect(ready.ok).toBe(true);
    expect(ready.required).toBe(false);
  });

  it("4. initial snapshot is awaited before ready (started=true only after write)", async () => {
    const redis = new InMemoryAdmissionRedis();
    let resolveFetch!: (v: WclRateBudgetDecisionDTO) => void;
    const delayed = new Promise<WclRateBudgetDecisionDTO>((r) => {
      resolveFetch = r;
    });
    const provider = capableProvider({
      fetchImpl: async () => delayed,
    });

    let started = false;
    const pending = startWclAdmissionSnapshotRefresher({
      redis,
      appEnv: "test",
      warcraftlogs: provider,
      intervalMs: 60_000,
      enabled: true,
      maxAgeSeconds: 60,
      awaitInitial: true,
    }).then((h) => {
      started = true;
      return h;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(started).toBe(false);
    expect(await readWclAdmissionSnapshot(redis, "test")).toBeNull();

    resolveFetch({
      action: "OK",
      utilizationPercent: 5,
      snapshot: {
        pointsRemaining: 400,
        pointsLimit: 1000,
        resetAt: "2026-07-31T13:00:00.000Z",
        fetchedAt: new Date().toISOString(),
      },
    });
    const handle = await pending;
    expect(handle.started).toBe(true);
    expect(handle.initialSnapshot?.pointsRemaining).toBe(400);
    await handle.stop();
  });

  it("5. valid snapshot makes readiness pass", async () => {
    const redis = new InMemoryAdmissionRedis();
    await writeWclAdmissionSnapshot(redis, "test", {
      ...freshSnapshot(),
      fetchedAt: new Date().toISOString(),
    });
    const ready = await checkAdmissionSnapshotReadiness({
      env: {
        REFRESH_ADMISSION_MODE: "enforce",
        WCL_ENABLED: true,
        APP_ENV: "test",
        REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS: 60,
      },
      redis,
    });
    expect(ready).toEqual({ ok: true, detail: "ok", required: true });
  });

  it("6. missing snapshot makes readiness fail", async () => {
    const redis = new InMemoryAdmissionRedis();
    const ready = await checkAdmissionSnapshotReadiness({
      env: {
        REFRESH_ADMISSION_MODE: "enforce",
        WCL_ENABLED: true,
        APP_ENV: "test",
        REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS: 60,
      },
      redis,
    });
    expect(ready.ok).toBe(false);
    expect(ready.detail).toBe("admission_snapshot_missing");
  });

  it("7. stale snapshot makes readiness fail", async () => {
    const redis = new InMemoryAdmissionRedis();
    await writeWclAdmissionSnapshot(
      redis,
      "test",
      freshSnapshot({ fetchedAt: "2026-07-31T12:00:00.000Z" }),
      { nowMs: Date.parse("2026-07-31T12:00:30.000Z") },
    );
    const ready = await checkAdmissionSnapshotReadiness({
      env: {
        REFRESH_ADMISSION_MODE: "enforce",
        WCL_ENABLED: true,
        APP_ENV: "test",
        REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS: 60,
      },
      redis,
      nowMs: Date.parse("2026-07-31T12:05:00.000Z"),
    });
    expect(ready.ok).toBe(false);
    expect(ready.detail).toBe("admission_snapshot_stale");
  });

  it("8. malformed snapshot is not written", async () => {
    const redis = new InMemoryAdmissionRedis();
    const good = {
      ...freshSnapshot(),
      fetchedAt: new Date().toISOString(),
    };
    await writeWclAdmissionSnapshot(redis, "test", good);
    const before = await readWclAdmissionSnapshot(redis, "test");

    const result = await writeWclAdmissionSnapshot(redis, "test", {
      pointsRemaining: Number.NaN,
      pointsLimit: 1000,
      resetAt: good.resetAt,
      fetchedAt: good.fetchedAt,
      windowId: good.windowId,
    });
    expect(result.written).toBe(false);
    expect(result.reason).toBe("points_remaining_invalid");

    const after = await readWclAdmissionSnapshot(redis, "test");
    expect(after?.pointsRemaining).toBe(before?.pointsRemaining);
  });

  it("9. failed refresh preserves last still-fresh valid snapshot", async () => {
    const redis = new InMemoryAdmissionRedis();
    const fetchedAt = new Date().toISOString();
    await writeWclAdmissionSnapshot(redis, "test", {
      ...freshSnapshot(),
      fetchedAt,
    });

    let calls = 0;
    const provider = capableProvider({
      fetchImpl: async () => {
        calls += 1;
        throw new Error("provider down");
      },
    });
    const { refreshWclAdmissionSnapshot } = await import("./snapshot-refresher.js");
    const preserved = await refreshWclAdmissionSnapshot({
      redis,
      appEnv: "test",
      warcraftlogs: provider,
      maxAgeSeconds: 60,
    });
    expect(calls).toBe(1);
    expect(preserved?.pointsRemaining).toBe(500);
    expect(await readWclAdmissionSnapshot(redis, "test")).not.toBeNull();
  });

  it("10. overlapping ticks produce only one provider call", async () => {
    const redis = new InMemoryAdmissionRedis();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const provider = capableProvider({
      fetchImpl: async () => {
        calls += 1;
        await gate;
        return {
          action: "OK",
          utilizationPercent: 1,
          snapshot: {
            pointsRemaining: 500,
            pointsLimit: 1000,
            resetAt: "2026-07-31T13:00:00.000Z",
            fetchedAt: new Date().toISOString(),
          },
        };
      },
    });
    const logs: string[] = [];
    const pending = startWclAdmissionSnapshotRefresher({
      redis,
      appEnv: "test",
      warcraftlogs: provider,
      logger: {
        info: (_o: unknown, msg?: string) => {
          if (typeof msg === "string") logs.push(msg);
        },
        warn: () => undefined,
        error: () => undefined,
      } as never,
      intervalMs: 40,
      enabled: true,
      maxAgeSeconds: 60,
      awaitInitial: true,
    });
    // While initial fetch is gated, an interval tick must skip rather than call again.
    await new Promise((r) => setTimeout(r, 80));
    expect(calls).toBe(1);
    expect(logs).toContain("snapshot_refresh_skipped_inflight");
    release();
    const handle = await pending;
    expect(handle.started).toBe(true);
    await handle.stop();
  });

  it("11. shutdown prevents further ticks", async () => {
    const redis = new InMemoryAdmissionRedis();
    let calls = 0;
    const provider = capableProvider({
      fetchImpl: async () => {
        calls += 1;
        return {
          action: "OK",
          utilizationPercent: 1,
          snapshot: {
            pointsRemaining: 500,
            pointsLimit: 1000,
            resetAt: "2026-07-31T13:00:00.000Z",
            fetchedAt: new Date().toISOString(),
          },
        };
      },
    });
    const handle = await startWclAdmissionSnapshotRefresher({
      redis,
      appEnv: "test",
      warcraftlogs: provider,
      intervalMs: 30,
      enabled: true,
      maxAgeSeconds: 60,
      awaitInitial: true,
    });
    expect(calls).toBe(1);
    await handle.stop();
    const afterStop = calls;
    await new Promise((r) => setTimeout(r, 80));
    expect(calls).toBe(afterStop);
  });

  it("12. fixture and live provider capabilities are explicit and type-safe", () => {
    const fixture = createWarcraftLogsProvider("fixture");
    expect(hasWarcraftLogsRateLimitCapability(fixture)).toBe(true);
    expect(fixture.rateLimitSupported).toBe(true);

    const disabled = createDisabledProvider<"warcraftlogs">("warcraftlogs");
    expect(hasWarcraftLogsRateLimitCapability(disabled)).toBe(false);
    expect(disabled.rateLimitSupported).toBe(false);
  });

  it("13. no unknown/unchecked cast remains in snapshot refresher path", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "snapshot-refresher.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/warcraftlogs:\s*unknown/);
    expect(src).not.toMatch(/as Partial</);
    expect(src).not.toMatch(/as AdmissionRateLimitFetcher/);
    expect(src).toContain("hasWarcraftLogsRateLimitCapability");
    expect(src).toContain("buildWclRateLimitFetchContext");
  });

  it("14. refresh Worker concurrency remains exactly 1", () => {
    const processorsPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../processors.ts",
    );
    const src = readFileSync(processorsPath, "utf8");
    expect(src).toMatch(/keep effective refresh concurrency at 1/);
    expect(src).not.toMatch(/QUEUE_NAMES\.refreshCharacter[\s\S]{0,400}concurrency:\s*[2-9]/);
  });

  it("15. admission still occurs before all character provider calls", () => {
    const pipelinePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../refresh-pipeline.ts",
    );
    const src = readFileSync(pipelinePath, "utf8");
    const admissionIdx = src.indexOf("runPipelineAdmission");
    const blizzardIdx = src.indexOf("pre_blizzard");
    expect(admissionIdx).toBeGreaterThan(0);
    expect(blizzardIdx).toBeGreaterThan(admissionIdx);
  });

  it("buildWclRateLimitFetchContext uses documented synthetic region", () => {
    const ctx = buildWclRateLimitFetchContext({ requestId: "r1" });
    expect(ctx.region).toBe(WCL_RATE_LIMIT_CONTEXT_REGION);
    expect(ctx.requestId).toBe("r1");
    expect(ctx.forceRefresh).toBe(true);
    expect(ctx.now).toBeTruthy();
  });

  it("validateAdmissionRateSnapshot rejects negative / non-positive limits", () => {
    expect(
      validateAdmissionRateSnapshot(freshSnapshot({ pointsRemaining: -1 })).ok,
    ).toBe(false);
    expect(validateAdmissionRateSnapshot(freshSnapshot({ pointsLimit: 0 })).ok).toBe(false);
    expect(
      validateAdmissionRateSnapshot(
        freshSnapshot({ fetchedAt: new Date(Date.now() + 60_000).toISOString() }),
      ).ok,
    ).toBe(false);
  });

  it("mode off does not require refresher", async () => {
    const handle = await bootstrapWclAdmissionSnapshotRefresher({
      redis: new InMemoryAdmissionRedis(),
      appEnv: "test",
      warcraftlogs: capableProvider(),
      intervalMs: 10_000,
      maxAgeSeconds: 60,
      admissionMode: "off",
      wclEnabled: true,
    });
    expect(handle.reason).toBe("mode_off_not_required");
    expect(handle.started).toBe(false);
  });
});
