/**
 * Redis-backed distributed singleflight for capability package acquisition.
 * Reuses acquireSourceSingleflight / complete / release from wcl-concurrency.
 *
 * Lifecycle:
 * 1. Caller checks PostgreSQL for a compatible package (before lock).
 * 2. Acquire distributed lease (full compatibility scope in key when known).
 * 3. Re-check PostgreSQL after becoming owner (another worker may have finished).
 * 4. Only the owner may call WCL; waiters poll/reload and never call WCL.
 * 5. Heartbeat the lease during long paginated work.
 * 6. complete → ready value, or release on failure; finally always cleans up.
 * 7. Expired lease is never proof that no package was persisted — always re-check DB.
 */
import { randomUUID } from "node:crypto";
import {
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
} from "@mplus/contracts";
import {
  acquireSourceSingleflight,
  completeSourceSingleflight,
  releaseSourceSingleflight,
  wclConcurrencyKeyPrefix,
  WCL_PERMIT_LEASE_TTL_MS,
  WCL_PERMIT_RENEW_INTERVAL_MS,
  type WclConcurrencyRedis,
} from "../wcl-concurrency/permits.js";
import {
  sourceFightKey,
  type RunOrchestrationPorts,
  type SourceFightIdentity,
} from "./orchestrator.js";

export interface CapabilityPackageLockScope {
  sourceFight: SourceFightIdentity;
  actorSetHash?: string | null;
  abilityFilterHash?: string | null;
  catalogVersion?: string | null;
  acquisitionPlanVersion?: string;
  graphqlQueryVersion?: string;
}

export function capabilityPackageSingleflightKey(
  appEnv: string,
  scope: CapabilityPackageLockScope,
): string {
  const sf = scope.sourceFight;
  const parts = [
    wclConcurrencyKeyPrefix(appEnv),
    "sf-cap-pkg",
    sf.reportCode,
    String(sf.fightId),
    String(sf.reportRevision),
    scope.actorSetHash ?? "actors-pending",
    scope.abilityFilterHash ?? "filter-pending",
    scope.catalogVersion ?? "catalog-pending",
    scope.acquisitionPlanVersion ?? CAPABILITY_ACQUISITION_PLAN_VERSION,
    scope.graphqlQueryVersion ?? WCL_GRAPHQL_QUERY_VERSION,
  ];
  return parts.join(":");
}

export interface CreateRedisSourceFightLockInput {
  redis: WclConcurrencyRedis;
  appEnv: string;
  /**
   * Re-check for a completed package. Called before lock, after becoming owner,
   * and while waiting. Must never call WCL.
   */
  findCompatiblePackage: RunOrchestrationPorts["findCompatibleCapabilityPackage"];
  /** Resolve lock scope hashes when known (optional). */
  resolveLockScope?: (
    sourceFight: SourceFightIdentity,
  ) => Promise<Omit<CapabilityPackageLockScope, "sourceFight">>;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  leaseMs?: number;
  renewIntervalMs?: number;
}

/**
 * Distributed withSourceFightLock: waiters reuse the owner's persisted package.
 */
export function createRedisSourceFightLock(
  input: CreateRedisSourceFightLockInput,
): RunOrchestrationPorts["withSourceFightLock"] {
  const waitTimeoutMs = input.waitTimeoutMs ?? 120_000;
  const pollIntervalMs = input.pollIntervalMs ?? 250;
  const leaseMs = input.leaseMs ?? WCL_PERMIT_LEASE_TTL_MS;
  const renewIntervalMs = input.renewIntervalMs ?? WCL_PERMIT_RENEW_INTERVAL_MS;

  return async (sourceFight, work) => {
    // 1. Fast path — package already persisted.
    const pre = await input.findCompatiblePackage({ sourceFight });
    if (pre) return work();

    const scopeExtra = (await input.resolveLockScope?.(sourceFight)) ?? {};
    const key = capabilityPackageSingleflightKey(input.appEnv, {
      sourceFight,
      ...scopeExtra,
    });

    const started = Date.now();
    let token: string | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stopHeartbeat = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    try {
      for (;;) {
        if (Date.now() - started > waitTimeoutMs) {
          // Lease expiry is not proof of absence — final DB check.
          const late = await input.findCompatiblePackage({ sourceFight });
          if (late) return work();
          throw Object.assign(
            new Error(
              `source_fight_lease_timeout:${sourceFightKey(sourceFight)}`,
            ),
            { code: "SOURCE_FIGHT_LEASE_TIMEOUT" },
          );
        }

        const acquired = await acquireSourceSingleflight({
          redis: input.redis,
          key,
          token: token ?? randomUUID(),
          leaseMs,
        });

        if (acquired.role === "ready") {
          const hit = await input.findCompatiblePackage({ sourceFight });
          if (hit) return work();
          // Ready marker without package — clear and retry (stale ready).
          await input.redis.del(key);
          continue;
        }

        if (acquired.role === "waiter") {
          await sleep(pollIntervalMs);
          const hit = await input.findCompatiblePackage({ sourceFight });
          if (hit) return work();
          continue;
        }

        // Owner
        token = acquired.token;

        // 3. Double-check after lease — another owner may have finished before we set NX.
        const afterLease = await input.findCompatiblePackage({ sourceFight });
        if (afterLease) {
          await completeSourceSingleflight({
            redis: input.redis,
            key,
            token,
            value: afterLease.packageArtifactId,
          });
          return work();
        }

        heartbeat = setInterval(() => {
          void input.redis
            .set(key, `owner:${token}`, "PX", leaseMs, "XX")
            .catch(() => undefined);
        }, renewIntervalMs);
        // Unref so tests / short processes can exit.
        if (typeof heartbeat.unref === "function") heartbeat.unref();

        try {
          const result = await work();
          const persisted = await input.findCompatiblePackage({ sourceFight });
          await completeSourceSingleflight({
            redis: input.redis,
            key,
            token,
            value: persisted?.packageArtifactId ?? `done:${sourceFightKey(sourceFight)}`,
          });
          return result;
        } catch (err) {
          await releaseSourceSingleflight({
            redis: input.redis,
            key,
            token,
          });
          throw err;
        } finally {
          stopHeartbeat();
          token = null;
        }
      }
    } finally {
      stopHeartbeat();
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-memory dual-instance harness for singleflight tests without Redis.
 * Shared map of tails simulates two workers on one process.
 */
export function createSharedMemorySourceFightLock(): {
  lock: RunOrchestrationPorts["withSourceFightLock"];
  acquireCount: () => number;
} {
  const tails = new Map<string, Promise<unknown>>();
  let acquires = 0;
  const lock: RunOrchestrationPorts["withSourceFightLock"] = async (
    sourceFight,
    work,
  ) => {
    const key = sourceFightKey(sourceFight);
    const prev = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    tails.set(
      key,
      gate.then(
        () => undefined,
        () => undefined,
      ),
    );
    await prev.catch(() => undefined);
    acquires += 1;
    try {
      return await work();
    } finally {
      release();
    }
  };
  return { lock, acquireCount: () => acquires };
}
