/**
 * Worker concurrency-settings observation heartbeats for control-center sync state.
 * Keys: mplus:{env}:refresh:concurrency:observe:{workerId}
 */
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { ScoringV2ConcurrencySyncState } from "@mplus/contracts";
import { refreshAdmissionKeyPrefix } from "./redis-keys.js";
import { isolateLaneAppEnv } from "./lane-permits.js";

/** Redis key TTL — slightly above freshness window so keys expire after going stale. */
export const CONCURRENCY_OBSERVATION_TTL_SEC = 90;
/** Observations older than this are not considered fresh. */
export const CONCURRENCY_OBSERVATION_FRESHNESS_MS = 90_000;

export interface ConcurrencyObservationPayload {
  settingsVersion: number;
  concurrencyCalibration: number;
  concurrencyOperation: number;
  observedAt: string;
}

export interface ConcurrencyObservation extends ConcurrencyObservationPayload {
  workerId: string;
  observedAtMs: number;
}

export interface ConcurrencyObserveRedis {
  // Intentionally loose — ioredis Redis overloads are not assignable to narrow signatures.
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  scan(cursor: string | number, ...args: unknown[]): Promise<[string | Buffer, Array<string | Buffer>]>;
  mget(...keys: string[]): Promise<Array<string | null>>;
}

let cachedWorkerId: string | null = null;

export function getConcurrencyObserverWorkerId(): string {
  if (cachedWorkerId == null) {
    cachedWorkerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  }
  return cachedWorkerId;
}

/** Test helper — reset module-level worker id. */
export function resetConcurrencyObserverWorkerIdForTests(): void {
  cachedWorkerId = null;
}

export function concurrencyObserveKeyPrefix(appEnv: string): string {
  return `${refreshAdmissionKeyPrefix(isolateLaneAppEnv(appEnv))}concurrency:observe:`;
}

export function concurrencyObserveKey(appEnv: string, workerId: string): string {
  return `${concurrencyObserveKeyPrefix(appEnv)}${workerId}`;
}

export function serializeConcurrencyObservation(
  payload: Omit<ConcurrencyObservationPayload, "observedAt"> & { observedAt?: string; nowMs?: number },
): string {
  const observedAt =
    payload.observedAt ?? new Date(payload.nowMs ?? Date.now()).toISOString();
  const body: ConcurrencyObservationPayload = {
    settingsVersion: payload.settingsVersion,
    concurrencyCalibration: payload.concurrencyCalibration,
    concurrencyOperation: payload.concurrencyOperation,
    observedAt,
  };
  return JSON.stringify(body);
}

export function parseConcurrencyObservation(
  workerId: string,
  raw: string | null | undefined,
): ConcurrencyObservation | null {
  if (raw == null || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConcurrencyObservationPayload>;
    const settingsVersion = Number(parsed.settingsVersion);
    const concurrencyCalibration = Number(parsed.concurrencyCalibration);
    const concurrencyOperation = Number(parsed.concurrencyOperation);
    const observedAt = typeof parsed.observedAt === "string" ? parsed.observedAt : null;
    if (
      !Number.isFinite(settingsVersion) ||
      !Number.isFinite(concurrencyCalibration) ||
      !Number.isFinite(concurrencyOperation) ||
      observedAt == null
    ) {
      return null;
    }
    const observedAtMs = Date.parse(observedAt);
    if (!Number.isFinite(observedAtMs)) return null;
    return {
      workerId,
      settingsVersion,
      concurrencyCalibration,
      concurrencyOperation,
      observedAt,
      observedAtMs,
    };
  } catch {
    return null;
  }
}

export async function writeConcurrencyObservation(input: {
  redis: ConcurrencyObserveRedis;
  appEnv: string;
  workerId?: string;
  settingsVersion: number;
  concurrencyCalibration: number;
  concurrencyOperation: number;
  nowMs?: number;
  ttlSec?: number;
}): Promise<{ key: string; workerId: string }> {
  const workerId = input.workerId ?? getConcurrencyObserverWorkerId();
  const key = concurrencyObserveKey(input.appEnv, workerId);
  const value = serializeConcurrencyObservation({
    settingsVersion: input.settingsVersion,
    concurrencyCalibration: input.concurrencyCalibration,
    concurrencyOperation: input.concurrencyOperation,
    nowMs: input.nowMs,
  });
  const ttl = input.ttlSec ?? CONCURRENCY_OBSERVATION_TTL_SEC;
  await input.redis.set(key, value, "EX", ttl);
  return { key, workerId };
}

function workerIdFromObserveKey(prefix: string, key: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

/**
 * SCAN + MGET all observation keys under the env prefix.
 * Returns null when Redis ops fail (caller should treat as UNKNOWN).
 */
export async function listConcurrencyObservations(input: {
  redis: ConcurrencyObserveRedis;
  appEnv: string;
}): Promise<ConcurrencyObservation[] | null> {
  const prefix = concurrencyObserveKeyPrefix(input.appEnv);
  const pattern = `${prefix}*`;
  const keys: string[] = [];
  try {
    let cursor: string | number = "0";
    do {
      const reply = await input.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      const nextCursor = String(reply[0]);
      const batch = (reply[1] as Array<string | Buffer>).map((k) =>
        typeof k === "string" ? k : Buffer.from(k).toString("utf8"),
      );
      keys.push(...batch);
      cursor = nextCursor;
    } while (String(cursor) !== "0");

    if (keys.length === 0) return [];

    const values = await input.redis.mget(...keys);
    const out: ConcurrencyObservation[] = [];
    for (let i = 0; i < keys.length; i++) {
      const parsed = parseConcurrencyObservation(
        workerIdFromObserveKey(prefix, keys[i]!),
        values[i],
      );
      if (parsed) out.push(parsed);
    }
    return out;
  } catch {
    return null;
  }
}

export interface DeriveConcurrencySyncStateInput {
  redisAvailable: boolean;
  observations: ConcurrencyObservation[];
  settingsVersion: number;
  configuredCalibration: number;
  configuredOperation: number;
  nowMs?: number;
  freshnessMs?: number;
}

export interface DeriveConcurrencySyncStateResult {
  syncState: ScoringV2ConcurrencySyncState;
  synchronized: boolean;
  observedReplicaCount: number;
  oldestObservationAt: string | null;
  newestObservationAt: string | null;
  /** Observed effective limits when any observation exists; else configured. */
  effectiveCalibration: number;
  effectiveOperation: number;
}

/**
 * Pure sync-state derivation from Redis observations vs current DB settings.
 *
 * - Redis unavailable → UNKNOWN
 * - No observations → UNKNOWN
 * - All observations stale → STALE
 * - Mix of fresh + stale → PARTIALLY_OBSERVED
 * - Fresh versions/values disagree with settings (or each other) → UNSYNCHRONIZED
 * - All fresh and match → SYNCHRONIZED
 */
export function deriveConcurrencySyncState(
  input: DeriveConcurrencySyncStateInput,
): DeriveConcurrencySyncStateResult {
  const nowMs = input.nowMs ?? Date.now();
  const freshnessMs = input.freshnessMs ?? CONCURRENCY_OBSERVATION_FRESHNESS_MS;
  const observations = [...input.observations].sort((a, b) => a.observedAtMs - b.observedAtMs);
  const observedReplicaCount = observations.length;
  const oldestObservationAt =
    observations.length > 0 ? observations[0]!.observedAt : null;
  const newestObservationAt =
    observations.length > 0 ? observations[observations.length - 1]!.observedAt : null;

  const newest = observations.length > 0 ? observations[observations.length - 1]! : null;
  const effectiveCalibration = newest?.concurrencyCalibration ?? input.configuredCalibration;
  const effectiveOperation = newest?.concurrencyOperation ?? input.configuredOperation;

  const base = {
    observedReplicaCount,
    oldestObservationAt,
    newestObservationAt,
    effectiveCalibration,
    effectiveOperation,
  };

  if (!input.redisAvailable) {
    return {
      ...base,
      syncState: "UNKNOWN",
      synchronized: false,
      effectiveCalibration: input.configuredCalibration,
      effectiveOperation: input.configuredOperation,
      observedReplicaCount: 0,
      oldestObservationAt: null,
      newestObservationAt: null,
    };
  }

  if (observations.length === 0) {
    return {
      ...base,
      syncState: "UNKNOWN",
      synchronized: false,
      effectiveCalibration: input.configuredCalibration,
      effectiveOperation: input.configuredOperation,
    };
  }

  const fresh = observations.filter((o) => nowMs - o.observedAtMs <= freshnessMs);
  const stale = observations.filter((o) => nowMs - o.observedAtMs > freshnessMs);

  if (fresh.length === 0) {
    return { ...base, syncState: "STALE", synchronized: false };
  }

  if (stale.length > 0) {
    return { ...base, syncState: "PARTIALLY_OBSERVED", synchronized: false };
  }

  const matchesSettings = (o: ConcurrencyObservation): boolean =>
    o.settingsVersion === input.settingsVersion &&
    o.concurrencyCalibration === input.configuredCalibration &&
    o.concurrencyOperation === input.configuredOperation;

  const allMatch = fresh.every(matchesSettings);
  if (!allMatch) {
    return { ...base, syncState: "UNSYNCHRONIZED", synchronized: false };
  }

  return { ...base, syncState: "SYNCHRONIZED", synchronized: true };
}
