/**
 * Refresh admission / concurrency policy.
 *
 * Defaults keep live admission off, Worker concurrency unwired, BullMQ priority,
 * ETA population, and multi-attempt retries disabled.
 * Stage 3: REFRESH_ADMISSION_MODE=enforce enables Redis admit/release at serial
 * concurrency 1. REFRESH_CONCURRENCY_ENABLED raises caps later (Stage 6+).
 * See doc/architecture/parallel-refresh-scheduling.md §§4, 17–19.
 */

export type RefreshAdmissionMode = "off" | "shadow" | "enforce";

/** Env fields required to build admission policy — kept local to avoid circular imports. */
export type RefreshAdmissionEnv = {
  REFRESH_ADMISSION_MODE: RefreshAdmissionMode;
  REFRESH_WORKER_CONCURRENCY: number;
  REFRESH_GLOBAL_CONCURRENCY: number;
  REFRESH_WORKER_HARD_MAX: number;
  REFRESH_GLOBAL_HARD_MAX: number;
  REFRESH_SAFETY_RESERVE_FRACTION: number;
  REFRESH_MIN_EMERGENCY_RESERVE_POINTS: number;
  REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS: number;
  REFRESH_LEASE_TTL_MS: number;
  REFRESH_LEASE_HEARTBEAT_MS: number;
  REFRESH_ETA_ENABLED: boolean;
  REFRESH_PRIORITY_IN_BULLMQ: boolean;
  REFRESH_CONCURRENCY_ENABLED: boolean;
};

export interface RefreshAdmissionConfig {
  version: string;
  /** off = no predict/enforce; shadow = predict only; enforce = live Redis admit. */
  mode: RefreshAdmissionMode;
  /** Process-local BullMQ Worker concurrency (unused until concurrency activation). */
  workerConcurrency: number;
  /** Environment-wide admitted pipeline cap (distributed semaphore; unused until activation). */
  globalConcurrency: number;
  workerHardMax: number;
  globalHardMax: number;
  safetyReserveFraction: number;
  minEmergencyReservePoints: number;
  wclSnapshotMaxAgeSeconds: number;
  leaseTtlMs: number;
  leaseHeartbeatMs: number;
  etaEnabled: boolean;
  priorityInBullmq: boolean;
  /** Master switch for applying global/local concurrency caps. Default false. */
  concurrencyEnabled: boolean;
}

export const REFRESH_ADMISSION_POLICY_VERSION = "2026-07-31";

export const DEFAULT_REFRESH_WORKER_HARD_MAX = 8;
export const DEFAULT_REFRESH_GLOBAL_HARD_MAX = 8;
export const DEFAULT_REFRESH_MIN_EMERGENCY_RESERVE_POINTS = 50;
export const DEFAULT_REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS = 60;
export const DEFAULT_REFRESH_LEASE_TTL_MS = 45_000;
export const DEFAULT_REFRESH_LEASE_HEARTBEAT_MS = 15_000;

/**
 * Clamp configured worker concurrency to [1, hardMax].
 * Does not enable Worker concurrency by itself.
 */
export function clampWorkerConcurrency(requested: number, hardMax: number): number {
  const max = Math.max(1, Math.floor(hardMax));
  const value = Math.floor(requested);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(value, max);
}

/**
 * Clamp configured global concurrency to [1, hardMax].
 * Does not enable distributed admission by itself.
 */
export function clampGlobalConcurrency(requested: number, hardMax: number): number {
  return clampWorkerConcurrency(requested, hardMax);
}

export function buildRefreshAdmissionConfig(env: RefreshAdmissionEnv): RefreshAdmissionConfig {
  const workerHardMax = Math.max(1, Math.floor(env.REFRESH_WORKER_HARD_MAX));
  const globalHardMax = Math.max(1, Math.floor(env.REFRESH_GLOBAL_HARD_MAX));
  return {
    version: REFRESH_ADMISSION_POLICY_VERSION,
    mode: env.REFRESH_ADMISSION_MODE,
    workerConcurrency: clampWorkerConcurrency(env.REFRESH_WORKER_CONCURRENCY, workerHardMax),
    globalConcurrency: clampGlobalConcurrency(env.REFRESH_GLOBAL_CONCURRENCY, globalHardMax),
    workerHardMax,
    globalHardMax,
    safetyReserveFraction: env.REFRESH_SAFETY_RESERVE_FRACTION,
    minEmergencyReservePoints: Math.max(0, Math.floor(env.REFRESH_MIN_EMERGENCY_RESERVE_POINTS)),
    wclSnapshotMaxAgeSeconds: Math.max(1, Math.floor(env.REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS)),
    leaseTtlMs: Math.max(1_000, Math.floor(env.REFRESH_LEASE_TTL_MS)),
    leaseHeartbeatMs: Math.max(500, Math.floor(env.REFRESH_LEASE_HEARTBEAT_MS)),
    etaEnabled: env.REFRESH_ETA_ENABLED,
    priorityInBullmq: env.REFRESH_PRIORITY_IN_BULLMQ,
    concurrencyEnabled: env.REFRESH_CONCURRENCY_ENABLED,
  };
}

/**
 * Whether enforce mode may mutate Redis reservation / slot state.
 * Stage 3: `REFRESH_ADMISSION_MODE=enforce` alone enables live admit/release.
 * `REFRESH_CONCURRENCY_ENABLED` only raises admitted/worker caps above serial 1.
 */
export function isRefreshAdmissionRedisMutationEnabled(config: RefreshAdmissionConfig): boolean {
  return config.mode === "enforce";
}

/** Shadow prediction is allowed only in shadow mode (not off, not enforce). */
export function isRefreshAdmissionShadowEnabled(config: RefreshAdmissionConfig): boolean {
  return config.mode === "shadow";
}

/**
 * Effective global admitted-slot limit for the live gate.
 * Until concurrency activation, enforce keeps serial capacity (1).
 */
export function effectiveAdmissionGlobalConcurrency(config: RefreshAdmissionConfig): number {
  if (!config.concurrencyEnabled) return 1;
  return clampGlobalConcurrency(config.globalConcurrency, config.globalHardMax);
}

/**
 * Whether BullMQ Worker concurrency may be wired above the default of 1.
 * Stage 3 keeps this false — do not raise Worker concurrency here.
 */
export function isRefreshWorkerConcurrencyWiringEnabled(config: RefreshAdmissionConfig): boolean {
  return config.concurrencyEnabled;
}

/**
 * Emergency reserve from window pointsLimit (not pointsRemaining).
 * Integer-only; floor fraction then apply min floor.
 */
export function computeEmergencyReservePoints(
  pointsLimit: number,
  safetyReserveFraction: number,
  minEmergencyReservePoints: number,
): number {
  if (!Number.isFinite(pointsLimit) || pointsLimit <= 0) return 0;
  const fromFraction = Math.floor(pointsLimit * safetyReserveFraction);
  return Math.max(fromFraction, Math.max(0, Math.floor(minEmergencyReservePoints)));
}

export function computeNormalAvailablePoints(input: {
  pointsRemaining: number;
  emergencyReservePoints: number;
  activeReservedPoints: number;
}): number {
  return Math.max(
    0,
    Math.floor(input.pointsRemaining) -
      Math.floor(input.emergencyReservePoints) -
      Math.floor(input.activeReservedPoints),
  );
}

export function computeEmergencyAvailablePoints(input: {
  pointsRemaining: number;
  activeReservedPoints: number;
}): number {
  return Math.max(
    0,
    Math.floor(input.pointsRemaining) - Math.floor(input.activeReservedPoints),
  );
}

export function deriveWclWindowId(resetAt: Date | string | number | null | undefined): string | null {
  if (resetAt == null) return null;
  const ms =
    typeof resetAt === "number"
      ? resetAt
      : typeof resetAt === "string"
        ? Date.parse(resetAt)
        : resetAt.getTime();
  if (!Number.isFinite(ms)) return null;
  return `win:${Math.floor(ms / 1000)}`;
}

export function isWclSnapshotFresh(input: {
  fetchedAt: Date | string | number;
  maxAgeSeconds: number;
  nowMs?: number;
}): boolean {
  const fetchedMs =
    typeof input.fetchedAt === "number"
      ? input.fetchedAt
      : typeof input.fetchedAt === "string"
        ? Date.parse(input.fetchedAt)
        : input.fetchedAt.getTime();
  if (!Number.isFinite(fetchedMs)) return false;
  const nowMs = input.nowMs ?? Date.now();
  const maxAgeMs = Math.max(0, Math.floor(input.maxAgeSeconds)) * 1000;
  return nowMs - fetchedMs <= maxAgeMs;
}
