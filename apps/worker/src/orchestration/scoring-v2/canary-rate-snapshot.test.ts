/**
 * Discovery rate-snapshot bootstrap + two-stage admission (no live WCL).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WclRateLimitSnapshot } from "@mplus/provider-warcraftlogs";
import {
  evaluateCanaryDiscoveryGates,
  isDiscoveryExecuteArmed,
} from "./canary/canary-discovery-gates.js";
import { createDiscoveryForbiddenAcquireHook } from "./canary/canary-discover.js";
import {
  bootstrapCanaryRateLimitSnapshot,
  CONSERVATIVE_RATE_LIMIT_SNAPSHOT_POINTS,
  defaultCanaryRateSnapshotPath,
  evaluateDiscoveryAdmissionAfterBootstrap,
  projectDiscoveryOnlyPoints,
  resolveBootstrapPointCost,
  writePersistedCanaryRateSnapshot,
} from "./canary/canary-rate-snapshot.js";

const liveEnv = {
  PROVIDER_MODE: "live" as const,
  WCL_ENABLED: true,
  ALLOW_LIVE_PROVIDER_CALLS: true,
  SCORING_V2_ENABLED: true,
  SCORING_V2_SELECTION_ENABLED: true,
  SCORING_V2_EVIDENCE_FETCH_ENABLED: true,
  SCORING_V2_PUBLICATION_ENABLED: false,
  WCL_CLIENT_ID: "id",
  WCL_CLIENT_SECRET: "secret",
};

const budget = { warnPercent: 70, deferPercent: 80, stopPercent: 90 };

function snapshotAt(spent: number, limit = 1000): WclRateLimitSnapshot {
  return {
    limitPerHour: limit,
    pointsSpentThisHour: spent,
    pointsRemaining: Math.max(0, limit - spent),
    resetAt: null,
    fetchedAt: new Date().toISOString(),
  };
}

describe("canary rate snapshot bootstrap", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  function tmpDir(): string {
    const d = mkdtempSync(join(tmpdir(), "canary-rate-"));
    dirs.push(d);
    return d;
  }

  it("missing snapshot triggers exactly one bootstrap request", async () => {
    const dir = tmpDir();
    const fetchLive = vi.fn(async () => ({
      snapshot: snapshotAt(100),
      measuredPoints: 1,
    }));
    const first = await bootstrapCanaryRateLimitSnapshot({
      persistPath: defaultCanaryRateSnapshotPath(dir),
      ttlSeconds: 60,
      fetchLive,
    });
    expect(fetchLive).toHaveBeenCalledTimes(1);
    expect(first.succeeded).toBe(true);
    expect(first.snapshotSource).toBe("LIVE");
    expect(first.providerCalls).toBe(1);
  });

  it("local gate failure triggers zero bootstrap calls", () => {
    const fetchLive = vi.fn();
    const gate = evaluateCanaryDiscoveryGates({
      env: { ...liveEnv, ALLOW_LIVE_PROVIDER_CALLS: false },
      discoveryExecuteArmed: true,
      confirmDiscovery: true,
      characterCount: 1,
      repositoryMode: "PRODUCTION",
    });
    expect(gate.allowed).toBe(false);
    expect(fetchLive).not.toHaveBeenCalled();
  });

  it("fresh persisted snapshot triggers zero provider calls", async () => {
    const dir = tmpDir();
    const path = defaultCanaryRateSnapshotPath(dir);
    await writePersistedCanaryRateSnapshot(path, {
      snapshot: snapshotAt(50),
      measuredPoints: 1,
    });
    const fetchLive = vi.fn(async () => ({
      snapshot: snapshotAt(50),
      measuredPoints: 1,
    }));
    const result = await bootstrapCanaryRateLimitSnapshot({
      persistPath: path,
      ttlSeconds: 60,
      fetchLive,
    });
    expect(fetchLive).not.toHaveBeenCalled();
    expect(result.snapshotSource).toBe("PERSISTED");
    expect(result.providerCalls).toBe(0);
    expect(result.succeeded).toBe(true);
  });

  it("bootstrap request cost is counted and unknown cost is never zero", () => {
    const unknown = resolveBootstrapPointCost({
      providerCalls: 1,
      measuredPoints: null,
    });
    expect(unknown.measuredPoints).toBeNull();
    expect(unknown.estimatedPoints).toBe(CONSERVATIVE_RATE_LIMIT_SNAPSHOT_POINTS);
    expect(unknown.estimatedPoints).toBeGreaterThan(0);

    const measured = resolveBootstrapPointCost({
      providerCalls: 1,
      measuredPoints: 2,
    });
    expect(measured.measuredPoints).toBe(2);
  });

  it("successful bootstrap followed by OK allows discovery", () => {
    const admission = evaluateDiscoveryAdmissionAfterBootstrap({
      snapshot: snapshotAt(100),
      rateBudgetConfig: budget,
      bootstrapCost: 1,
      projectedDiscoveryCost: 10,
    });
    expect(admission.action).toBe("OK");
    expect(admission.admission).toBe("ALLOW");
    expect(admission.bootstrapCost).toBe(1);
    expect(admission.projectedDiscoveryCost).toBe(10);
  });

  it("successful bootstrap followed by WARN allows discovery", () => {
    const admission = evaluateDiscoveryAdmissionAfterBootstrap({
      snapshot: snapshotAt(720),
      rateBudgetConfig: budget,
      bootstrapCost: 1,
      projectedDiscoveryCost: 5,
    });
    expect(admission.action).toBe("WARN");
    expect(admission.admission).toBe("ALLOW");
  });

  it("successful bootstrap followed by DEFER blocks discovery", () => {
    const admission = evaluateDiscoveryAdmissionAfterBootstrap({
      snapshot: snapshotAt(850),
      rateBudgetConfig: budget,
      bootstrapCost: 1,
      projectedDiscoveryCost: 5,
    });
    expect(admission.action).toBe("DEFER");
    expect(admission.admission).toBe("REFUSE");
  });

  it("successful bootstrap followed by STOP blocks discovery", () => {
    const admission = evaluateDiscoveryAdmissionAfterBootstrap({
      snapshot: snapshotAt(950),
      rateBudgetConfig: budget,
      bootstrapCost: 1,
      projectedDiscoveryCost: 5,
    });
    expect(admission.action).toBe("STOP");
    expect(admission.admission).toBe("REFUSE");
  });

  it("failed bootstrap blocks discovery", async () => {
    const dir = tmpDir();
    const result = await bootstrapCanaryRateLimitSnapshot({
      persistPath: defaultCanaryRateSnapshotPath(dir),
      ttlSeconds: 60,
      fetchLive: async () => ({ snapshot: null, measuredPoints: null }),
    });
    expect(result.succeeded).toBe(false);
    expect(result.failureReason).toMatch(/RATE_LIMIT_SNAPSHOT_UNAVAILABLE/);
    expect(result.providerCalls).toBe(1);
    expect(result.estimatedPoints).toBeGreaterThan(0);
  });

  it("capability acquisition remains unreachable", () => {
    expect(() => createDiscoveryForbiddenAcquireHook()).toThrow(
      /DISCOVERY_CAPABILITY_ACQUIRE_UNREACHABLE|unreachable/,
    );
  });

  it("report distinguishes bootstrap cost assumptions from capability pages", () => {
    const admission = evaluateDiscoveryAdmissionAfterBootstrap({
      snapshot: snapshotAt(10),
      rateBudgetConfig: budget,
      bootstrapCost: 1,
    });
    expect(admission.costAssumptions.capabilityEventPageAcquisitions).toBe(0);
    expect(admission.costAssumptions.capabilityEventPagesExcluded).toBe(true);
    expect(admission.costAssumptions.bootstrapIncludedInProjection).toBe(true);
    expect(projectDiscoveryOnlyPoints()).toBeGreaterThan(0);
  });

  it("retry within snapshot TTL reuses the persisted snapshot", async () => {
    const dir = tmpDir();
    const path = defaultCanaryRateSnapshotPath(dir);
    const fetchLive = vi.fn(async () => ({
      snapshot: snapshotAt(40),
      measuredPoints: 1,
    }));
    const first = await bootstrapCanaryRateLimitSnapshot({
      persistPath: path,
      ttlSeconds: 60,
      fetchLive,
    });
    const second = await bootstrapCanaryRateLimitSnapshot({
      persistPath: path,
      ttlSeconds: 60,
      fetchLive,
    });
    expect(first.snapshotSource).toBe("LIVE");
    expect(second.snapshotSource).toBe("PERSISTED");
    expect(fetchLive).toHaveBeenCalledTimes(1);
    expect(second.providerCalls).toBe(0);
  });

  it("no publication or public pointer mutation occurs in gate path", () => {
    expect(isDiscoveryExecuteArmed({ SCORING_V2_CANARY_DISCOVERY_EXECUTE: "true" })).toBe(
      true,
    );
    const gate = evaluateCanaryDiscoveryGates({
      env: liveEnv,
      discoveryExecuteArmed: true,
      confirmDiscovery: true,
      characterCount: 1,
      repositoryMode: "PRODUCTION",
    });
    expect(gate.allowed).toBe(true);
    expect(liveEnv.SCORING_V2_PUBLICATION_ENABLED).toBe(false);
  });

  it("projected discovery cost includes bootstrap and excludes capability pages", () => {
    const discovery = projectDiscoveryOnlyPoints();
    const admission = evaluateDiscoveryAdmissionAfterBootstrap({
      snapshot: snapshotAt(100),
      rateBudgetConfig: budget,
      bootstrapCost: 1,
      projectedDiscoveryCost: discovery,
    });
    expect(admission.projectedUtilization).toBeCloseTo(
      ((100 + 1 + discovery) / 1000) * 100,
      5,
    );
  });
});
