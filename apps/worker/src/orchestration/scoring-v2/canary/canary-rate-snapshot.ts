/**
 * Bounded WCL rate-limit snapshot bootstrap for discovery-only canary.
 * Uses RateLimitData only — never a character/report query to manufacture quota.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isWclSnapshotFresh } from "@mplus/config";
import {
  evaluateRateBudget,
  fetchRateLimitSnapshot,
  MAX_COVERAGE_AWARE_HYDRATION_REPORTS,
  type RateBudgetConfig,
  type WclGraphQlClient,
  type WclRateLimitSnapshot,
} from "@mplus/provider-warcraftlogs";

export const CANARY_RATE_SNAPSHOT_FILE_SCHEMA =
  "scoring-v2-canary-rate-snapshot-v1" as const;

/** Default TTL for reusing a persisted canary rate snapshot without a live call. */
export const DEFAULT_CANARY_RATE_SNAPSHOT_TTL_SECONDS = 60;

/**
 * Conservative points when a RateLimitData call ran but measured cost is unknown.
 * Never report 0 for work that executed.
 */
export const CONSERVATIVE_RATE_LIMIT_SNAPSHOT_POINTS = 1;

/** Conservative discovery-only overhead (excludes capability event pages). */
export const DISCOVERY_COST_ASSUMPTIONS = {
  zoneEncounterGraphqlRequests: 1,
  characterDiscoveryFlatGraphqlRequests: 5,
  maxHydrationReports: MAX_COVERAGE_AWARE_HYDRATION_REPORTS,
  /** Aligns with getReportMaster-class metadata hydration, not event pages. */
  pointsPerHydrationReport: 3,
  characterDiscoveryFlatPoints: 8,
  zoneEncounterPoints: 1,
  capabilityEventPageAcquisitions: 0,
} as const;

export type CanaryRateSnapshotSource = "PERSISTED" | "LIVE" | "ABSENT";

export interface PersistedCanaryRateSnapshotFile {
  schemaVersion: typeof CANARY_RATE_SNAPSHOT_FILE_SCHEMA;
  snapshot: WclRateLimitSnapshot;
  measuredPoints: number | null;
  operationName: "RateLimitData";
  persistedAt: string;
}

export interface CanaryRateSnapshotBootstrapReport {
  snapshotSource: CanaryRateSnapshotSource;
  snapshotAgeMs: number | null;
  providerCalls: number;
  measuredPoints: number | null;
  estimatedPoints: number | null;
  succeeded: boolean;
  failureReason: string | null;
  snapshot: WclRateLimitSnapshot | null;
  persistedPath: string | null;
}

export interface CanaryDiscoveryAdmissionReport {
  pointsSpent: number | null;
  hourlyLimit: number | null;
  utilizationBefore: number | null;
  bootstrapCost: number | null;
  projectedDiscoveryCost: number | null;
  projectedUtilization: number | null;
  action: "OK" | "WARN" | "DEFER" | "STOP";
  admission: "ALLOW" | "REFUSE";
  reasons: string[];
  costAssumptions: typeof DISCOVERY_COST_ASSUMPTIONS & {
    bootstrapIncludedInProjection: true;
    capabilityEventPagesExcluded: true;
  };
}

export function defaultCanaryRateSnapshotPath(outputDir: string): string {
  return join(outputDir, "rate-limit-snapshot.json");
}

export function snapshotAgeMs(
  snapshot: WclRateLimitSnapshot | null,
  nowMs = Date.now(),
): number | null {
  if (!snapshot?.fetchedAt) return null;
  const fetched = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetched)) return null;
  return Math.max(0, nowMs - fetched);
}

export function resolveBootstrapPointCost(input: {
  providerCalls: number;
  measuredPoints: number | null | undefined;
}): { measuredPoints: number | null; estimatedPoints: number | null } {
  if (input.providerCalls <= 0) {
    return { measuredPoints: 0, estimatedPoints: 0 };
  }
  if (input.measuredPoints != null && Number.isFinite(input.measuredPoints)) {
    return {
      measuredPoints: input.measuredPoints,
      estimatedPoints: input.measuredPoints,
    };
  }
  return {
    measuredPoints: null,
    estimatedPoints: CONSERVATIVE_RATE_LIMIT_SNAPSHOT_POINTS,
  };
}

export function projectDiscoveryOnlyPoints(): number {
  const a = DISCOVERY_COST_ASSUMPTIONS;
  return (
    a.zoneEncounterPoints +
    a.characterDiscoveryFlatPoints +
    a.maxHydrationReports * a.pointsPerHydrationReport
  );
}

export async function readPersistedCanaryRateSnapshot(
  path: string,
): Promise<PersistedCanaryRateSnapshotFile | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as PersistedCanaryRateSnapshotFile;
    if (
      parsed?.schemaVersion !== CANARY_RATE_SNAPSHOT_FILE_SCHEMA ||
      !parsed.snapshot ||
      typeof parsed.snapshot.limitPerHour !== "number" ||
      typeof parsed.snapshot.pointsSpentThisHour !== "number" ||
      typeof parsed.snapshot.fetchedAt !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writePersistedCanaryRateSnapshot(
  path: string,
  input: {
    snapshot: WclRateLimitSnapshot;
    measuredPoints: number | null;
    now?: Date;
  },
): Promise<void> {
  const body: PersistedCanaryRateSnapshotFile = {
    schemaVersion: CANARY_RATE_SNAPSHOT_FILE_SCHEMA,
    snapshot: input.snapshot,
    measuredPoints: input.measuredPoints,
    operationName: "RateLimitData",
    persistedAt: (input.now ?? new Date()).toISOString(),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(body, null, 2), "utf8");
}

/**
 * Obtain a fresh-enough rate-limit snapshot: reuse persisted within TTL, else
 * one RateLimitData GraphQL request.
 */
export async function bootstrapCanaryRateLimitSnapshot(input: {
  persistPath: string;
  ttlSeconds: number;
  now?: Date;
  /** Injected live fetch — must call RateLimitData only. */
  fetchLive: () => Promise<{
    snapshot: WclRateLimitSnapshot | null;
    measuredPoints: number | null;
  }>;
  /** When true, skip live fetch even if cache miss (tests / dry diagnostics). */
  allowLiveFetch?: boolean;
}): Promise<CanaryRateSnapshotBootstrapReport> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const allowLive = input.allowLiveFetch !== false;

  const persisted = await readPersistedCanaryRateSnapshot(input.persistPath);
  if (
    persisted &&
    isWclSnapshotFresh({
      fetchedAt: persisted.snapshot.fetchedAt,
      maxAgeSeconds: input.ttlSeconds,
      nowMs,
    })
  ) {
    return {
      snapshotSource: "PERSISTED",
      snapshotAgeMs: snapshotAgeMs(persisted.snapshot, nowMs),
      providerCalls: 0,
      measuredPoints: 0,
      estimatedPoints: 0,
      succeeded: true,
      failureReason: null,
      snapshot: persisted.snapshot,
      persistedPath: input.persistPath,
    };
  }

  if (!allowLive) {
    return {
      snapshotSource: "ABSENT",
      snapshotAgeMs: snapshotAgeMs(persisted?.snapshot ?? null, nowMs),
      providerCalls: 0,
      measuredPoints: 0,
      estimatedPoints: 0,
      succeeded: false,
      failureReason: "RATE_LIMIT_SNAPSHOT_UNAVAILABLE",
      snapshot: null,
      persistedPath: input.persistPath,
    };
  }

  try {
    const live = await input.fetchLive();
    const costs = resolveBootstrapPointCost({
      providerCalls: 1,
      measuredPoints: live.measuredPoints,
    });
    if (!live.snapshot) {
      return {
        snapshotSource: "ABSENT",
        snapshotAgeMs: null,
        providerCalls: 1,
        measuredPoints: costs.measuredPoints,
        estimatedPoints: costs.estimatedPoints,
        succeeded: false,
        failureReason: "RATE_LIMIT_SNAPSHOT_UNAVAILABLE",
        snapshot: null,
        persistedPath: input.persistPath,
      };
    }
    const snapshot: WclRateLimitSnapshot = {
      ...live.snapshot,
      fetchedAt: live.snapshot.fetchedAt || now.toISOString(),
    };
    await writePersistedCanaryRateSnapshot(input.persistPath, {
      snapshot,
      measuredPoints: costs.measuredPoints,
      now,
    });
    return {
      snapshotSource: "LIVE",
      snapshotAgeMs: snapshotAgeMs(snapshot, nowMs),
      providerCalls: 1,
      measuredPoints: costs.measuredPoints,
      estimatedPoints: costs.estimatedPoints,
      succeeded: true,
      failureReason: null,
      snapshot,
      persistedPath: input.persistPath,
    };
  } catch (err) {
    return {
      snapshotSource: "ABSENT",
      snapshotAgeMs: null,
      providerCalls: 1,
      measuredPoints: null,
      estimatedPoints: CONSERVATIVE_RATE_LIMIT_SNAPSHOT_POINTS,
      succeeded: false,
      failureReason:
        err instanceof Error
          ? `RATE_LIMIT_SNAPSHOT_UNAVAILABLE:${err.message}`
          : "RATE_LIMIT_SNAPSHOT_UNAVAILABLE",
      snapshot: null,
      persistedPath: input.persistPath,
    };
  }
}

/** Live RateLimitData fetch via existing GraphQL client helper. */
export async function fetchCanaryRateLimitSnapshotLive(
  client: WclGraphQlClient,
): Promise<{ snapshot: WclRateLimitSnapshot | null; measuredPoints: number | null }> {
  const { snapshot, costUnits } = await fetchRateLimitSnapshot(client, "global");
  return {
    snapshot,
    measuredPoints:
      costUnits != null && Number.isFinite(costUnits) ? costUnits : null,
  };
}

/**
 * Two-stage discovery admission: current budget action + projected discovery cost
 * (bootstrap included). Provider-free replay exception does NOT apply.
 */
export function evaluateDiscoveryAdmissionAfterBootstrap(input: {
  snapshot: WclRateLimitSnapshot;
  rateBudgetConfig: RateBudgetConfig;
  bootstrapCost: number;
  projectedDiscoveryCost?: number;
}): CanaryDiscoveryAdmissionReport {
  const projectedDiscoveryCost =
    input.projectedDiscoveryCost ?? projectDiscoveryOnlyPoints();
  const decision = evaluateRateBudget(input.snapshot, input.rateBudgetConfig);
  const pointsSpent = input.snapshot.pointsSpentThisHour;
  const hourlyLimit = input.snapshot.limitPerHour;
  const utilizationBefore = decision.utilizationPercent;
  const bootstrapCost = input.bootstrapCost;
  const projectedSpend = pointsSpent + bootstrapCost + projectedDiscoveryCost;
  const projectedUtilization =
    hourlyLimit > 0 ? (projectedSpend / hourlyLimit) * 100 : null;

  const reasons: string[] = [];
  let action: CanaryDiscoveryAdmissionReport["action"] = decision.action;
  let admission: "ALLOW" | "REFUSE" = "ALLOW";

  if (decision.action === "STOP") {
    admission = "REFUSE";
    reasons.push("rate_budget_STOP");
  } else if (decision.action === "DEFER") {
    admission = "REFUSE";
    reasons.push("rate_budget_DEFER");
  } else if (
    projectedUtilization != null &&
    projectedUtilization >= input.rateBudgetConfig.stopPercent
  ) {
    action = "STOP";
    admission = "REFUSE";
    reasons.push("projected_utilization_STOP");
  } else if (
    projectedUtilization != null &&
    projectedUtilization >= input.rateBudgetConfig.deferPercent
  ) {
    action = "DEFER";
    admission = "REFUSE";
    reasons.push("projected_utilization_DEFER");
  } else if (decision.action === "WARN") {
    action = "WARN";
    admission = "ALLOW";
    reasons.push("rate_budget_WARN_explicitly_permitted_for_discovery");
  } else {
    action = "OK";
    admission = "ALLOW";
    reasons.push("rate_budget_OK");
  }

  reasons.push("bootstrap_cost_included_in_projection");
  reasons.push("capability_event_pages_excluded_from_discovery_projection");

  return {
    pointsSpent,
    hourlyLimit,
    utilizationBefore,
    bootstrapCost,
    projectedDiscoveryCost,
    projectedUtilization,
    action,
    admission,
    reasons,
    costAssumptions: {
      ...DISCOVERY_COST_ASSUMPTIONS,
      bootstrapIncludedInProjection: true,
      capabilityEventPagesExcluded: true,
    },
  };
}

export function assertDiscoveryAdmissionAllows(report: CanaryDiscoveryAdmissionReport): void {
  if (report.admission === "REFUSE") {
    throw Object.assign(
      new Error(`canary_discovery_rate_admission_refused:${report.action}`),
      {
        code: "CANARY_DISCOVERY_RATE_ADMISSION_REFUSED",
        admission: report.action,
        reasons: report.reasons,
        discoveryAdmission: report,
      },
    );
  }
}
