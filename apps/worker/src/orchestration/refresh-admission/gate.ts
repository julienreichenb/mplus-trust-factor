/**
 * Refresh admission gate.
 *
 * - mode=off: no-op (pipeline proceeds without admission)
 * - mode=shadow: pure prediction + optional observer (no Redis writes)
 * - mode=enforce: atomic Redis reserve/slot via Lua; fail closed on Redis/snapshot errors
 *
 * Does not replace Refresh Control cancel/eligibility or publication barriers.
 */

import {
  buildRefreshAdmissionConfig,
  deriveWclWindowId,
  effectiveAdmissionGlobalConcurrency,
  isRefreshAdmissionRedisMutationEnabled,
  isRefreshAdmissionShadowEnabled,
  mergeRefreshAdmissionRuntimeOverrides,
  resolveAdmissionReservePolicy,
  type RefreshAdmissionConfig,
  type RefreshAdmissionEnv,
} from "@mplus/config";
import type { Logger } from "@mplus/observability";
import { OBS_EVENTS } from "@mplus/observability";
import { predictRefreshAdmission } from "./shadow-predict.js";
import type { RefreshAdmissionRepository } from "./repository.js";
import {
  evalReleaseAdmission,
  evalRenewAdmission,
  evalReserveAdmission,
  readActiveGlobalSlots,
  readActiveReservedPoints,
  readJobOwnership,
  readSchedulingState,
  readWclAdmissionSnapshot,
  resolveJobWindowId,
  type AdmissionRedis,
} from "./redis-ops.js";
import type {
  RefreshAdmissionDecisionReason,
  RefreshAdmissionLiveResult,
  RefreshAdmissionPredictInput,
  RefreshAdmissionPrediction,
  RefreshAdmissionReleaseResult,
} from "./types.js";
import { REFRESH_ADMISSION_DEFER_REASONS } from "./types.js";

export type RefreshAdmissionObserver = (prediction: RefreshAdmissionPrediction) => void | Promise<void>;

export interface RefreshAdmissionGate {
  readonly config: RefreshAdmissionConfig;
  predict(input: RefreshAdmissionPredictInput): Promise<RefreshAdmissionPrediction>;
  /**
   * Live admit for enforce mode. Shadow/off return prediction-only outcomes.
   * Fail closed on Redis errors when enforce is active.
   */
  tryAdmit(input: RefreshAdmissionPredictInput): Promise<RefreshAdmissionLiveResult>;
  /** Idempotent release of reservation + slot. */
  tryRelease(
    ingestionJobId: string,
    options?: { windowId?: string | null; status?: "SETTLED" | "RELEASED" | "CANCELLED" | "EXPIRED" },
  ): Promise<RefreshAdmissionReleaseResult>;
  /** Renew lease while the job remains healthy. */
  tryRenew(ingestionJobId: string, options?: { windowId?: string | null }): Promise<{ renewed: boolean; reason: string }>;
  /** Build predict input from Redis live state (snapshot / slots / ownership). */
  loadPredictContext(
    partial: Omit<
      RefreshAdmissionPredictInput,
      "snapshot" | "activeReservedPoints" | "activeGlobalSlots" | "existingReservationPoints" | "existingGlobalSlot" | "schedulingState"
    > &
      Partial<Pick<RefreshAdmissionPredictInput, "snapshot" | "schedulingState" | "providerStop">>,
  ): Promise<RefreshAdmissionPredictInput>;
}

function outcomeForDenial(reason: RefreshAdmissionDecisionReason): "deferred" | "denied" {
  return REFRESH_ADMISSION_DEFER_REASONS.has(reason) ? "deferred" : "denied";
}

function predictionFromLuaDenial(
  config: RefreshAdmissionConfig,
  input: RefreshAdmissionPredictInput,
  reason: RefreshAdmissionDecisionReason | string,
): RefreshAdmissionPrediction {
  const base = predictRefreshAdmission(config, input);
  return {
    ...base,
    admitted: false,
    reason: reason as RefreshAdmissionDecisionReason,
    wouldMutateRedis: true,
    metadata: {
      ...base.metadata,
      admitPath: "lua_denied",
      luaReason: reason,
    },
  };
}

export function createRefreshAdmissionGate(options: {
  env: RefreshAdmissionEnv & { APP_ENV?: string };
  config?: RefreshAdmissionConfig;
  runtimeOverrides?: { concurrencyEnabled?: boolean; wclPreResetDrainSeconds?: number } | null;
  redis?: AdmissionRedis | null;
  appEnv?: string;
  repository?: RefreshAdmissionRepository | null;
  logger?: Logger | null;
  onShadowPrediction?: RefreshAdmissionObserver;
}): RefreshAdmissionGate {
  const baseConfig = options.config ?? buildRefreshAdmissionConfig(options.env);
  const config = mergeRefreshAdmissionRuntimeOverrides(baseConfig, options.runtimeOverrides);
  const appEnv = options.appEnv ?? options.env.APP_ENV ?? "development";
  const redis = options.redis ?? null;
  const repository = options.repository ?? null;
  const logger = options.logger ?? null;

  async function predict(input: RefreshAdmissionPredictInput): Promise<RefreshAdmissionPrediction> {
    const prediction = predictRefreshAdmission(config, {
      ...input,
      // Use effective serial cap in predict when concurrency not enabled.
      activeGlobalSlots: input.activeGlobalSlots,
    });
    if (isRefreshAdmissionShadowEnabled(config) && options.onShadowPrediction) {
      await options.onShadowPrediction(prediction);
    }
    return prediction;
  }

  async function loadPredictContext(
    partial: Parameters<RefreshAdmissionGate["loadPredictContext"]>[0],
  ): Promise<RefreshAdmissionPredictInput> {
    if (!redis) {
      return {
        ...partial,
        snapshot: partial.snapshot ?? null,
        activeReservedPoints: 0,
        activeGlobalSlots: 0,
        existingReservationPoints: null,
        existingGlobalSlot: false,
        schedulingState: partial.schedulingState ?? "RUNNING",
      };
    }
    try {
      const schedulingState = partial.schedulingState ?? (await readSchedulingState(redis, appEnv));
      const snapshot = partial.snapshot ?? (await readWclAdmissionSnapshot(redis, appEnv));
      const windowId =
        snapshot?.windowId ?? deriveWclWindowId(snapshot?.resetAt ?? null) ?? null;
      const activeReservedPoints = windowId
        ? await readActiveReservedPoints(redis, appEnv, windowId)
        : 0;
      const activeGlobalSlots = await readActiveGlobalSlots(redis, appEnv);
      const ownership = await readJobOwnership(redis, appEnv, partial.ingestionJobId, windowId);
      return {
        ...partial,
        snapshot,
        activeReservedPoints,
        activeGlobalSlots,
        existingReservationPoints: ownership.reservationPoints,
        existingGlobalSlot: ownership.hasSlot,
        schedulingState,
      };
    } catch {
      return {
        ...partial,
        snapshot: partial.snapshot ?? null,
        activeReservedPoints: 0,
        activeGlobalSlots: effectiveAdmissionGlobalConcurrency(config),
        existingReservationPoints: null,
        existingGlobalSlot: false,
        schedulingState: partial.schedulingState ?? "RUNNING",
      };
    }
  }

  return {
    config,
    predict,
    loadPredictContext,

    async tryAdmit(input) {
      const prediction = await predict(input);

      if (config.mode === "off") {
        return {
          prediction: { ...prediction, wouldMutateRedis: false },
          outcome: "off",
          reservedPoints: 0,
          leaseExpiresAt: null,
          windowId: null,
          idempotent: false,
          providerCallsAvoided: false,
        };
      }

      if (config.mode === "shadow" || !isRefreshAdmissionRedisMutationEnabled(config)) {
        if (repository && config.mode === "shadow") {
          try {
            await repository.upsertShadowPrediction({
              jobId: input.ingestionJobId,
              characterId: input.characterId,
              estimatedWclPoints: prediction.estimatedWclPoints,
              emergencyOverride: Boolean(input.emergencyOverride),
              windowId: prediction.windowId ?? "shadow:none",
              leaseExpiresAt: new Date(Date.now() + config.leaseTtlMs),
              prediction: {
                reason: prediction.reason,
                admitted: prediction.admitted,
                lane: prediction.lane,
                shadowDivergence: prediction.shadowDivergence,
                serialRealityWouldProceed: prediction.serialRealityWouldProceed,
              },
            });
          } catch (err) {
            logger?.warn(
              { event: OBS_EVENTS.refreshAdmissionShadow, err, jobId: input.ingestionJobId },
              "shadow admission audit write failed",
            );
          }
        }
        logger?.info(
          {
            event: OBS_EVENTS.refreshAdmissionShadow,
            jobId: input.ingestionJobId,
            admissionReason: prediction.reason,
            admitted: prediction.admitted,
            estimatedPoints: prediction.estimatedWclPoints,
            schedulingState: input.schedulingState ?? "RUNNING",
            snapshotAgeMs: input.snapshot
              ? Date.now() - Date.parse(input.snapshot.fetchedAt)
              : null,
            shadowDivergence: prediction.shadowDivergence,
          },
          OBS_EVENTS.refreshAdmissionShadow,
        );
        return {
          prediction: { ...prediction, wouldMutateRedis: false },
          outcome: "shadow",
          reservedPoints: 0,
          leaseExpiresAt: null,
          windowId: prediction.windowId,
          idempotent: prediction.reason === "IDEMPOTENT_EXISTING",
          providerCallsAvoided: false,
        };
      }

      // Enforce path — fail closed without Redis.
      if (!redis) {
        const denied = {
          ...prediction,
          admitted: false,
          reason: "REDIS_UNAVAILABLE" as const,
          wouldMutateRedis: false,
          metadata: { ...prediction.metadata, admitPath: "redis_missing" },
        };
        return {
          prediction: denied,
          outcome: "deferred",
          reservedPoints: 0,
          leaseExpiresAt: null,
          windowId: null,
          idempotent: false,
          providerCallsAvoided: true,
        };
      }

      if (!prediction.admitted && prediction.reason !== "ENFORCE_NOT_ACTIVATED") {
        const outcome = outcomeForDenial(prediction.reason);
        logger?.info(
          {
            event:
              outcome === "deferred"
                ? OBS_EVENTS.refreshAdmissionDeferred
                : OBS_EVENTS.refreshAdmissionDenied,
            jobId: input.ingestionJobId,
            admissionReason: prediction.reason,
            estimatedPoints: prediction.estimatedWclPoints,
            schedulingState: input.schedulingState ?? "RUNNING",
            providerCallsAvoided: true,
          },
          outcome === "deferred"
            ? OBS_EVENTS.refreshAdmissionDeferred
            : OBS_EVENTS.refreshAdmissionDenied,
        );
        return {
          prediction: { ...prediction, wouldMutateRedis: true },
          outcome,
          reservedPoints: 0,
          leaseExpiresAt: null,
          windowId: prediction.windowId,
          idempotent: false,
          providerCallsAvoided: true,
        };
      }

      // Pre-checks passed (or ENFORCE_NOT_ACTIVATED legacy) — execute Lua.
      const estimated =
        input.wclRequired && input.estimatedWclPoints > 0
          ? Math.max(0, Math.floor(input.estimatedWclPoints))
          : 0;
      const expectedWindowId =
        estimated > 0
          ? (input.snapshot?.windowId ??
              deriveWclWindowId(input.snapshot?.resetAt ?? null) ??
              "")
          : "";

      let luaResult;
      const nowMs = input.nowMs ?? Date.now();
      const reservePolicy = resolveAdmissionReservePolicy({
        config,
        resetAt: input.snapshot?.resetAt ?? null,
        nowMs,
      });
      try {
        luaResult = await evalReserveAdmission({
          redis,
          appEnv,
          config,
          ingestionJobId: input.ingestionJobId,
          estimatedPoints: estimated,
          emergency: Boolean(input.emergencyOverride),
          expectedWindowId,
          nowMs,
          reservePolicy,
        });
      } catch (err) {
        logger?.warn(
          {
            event: OBS_EVENTS.refreshAdmissionDeferred,
            jobId: input.ingestionJobId,
            admissionReason: "REDIS_UNAVAILABLE",
            err,
            providerCallsAvoided: true,
          },
          OBS_EVENTS.refreshAdmissionDeferred,
        );
        return {
          prediction: {
            ...prediction,
            admitted: false,
            reason: "REDIS_UNAVAILABLE",
            wouldMutateRedis: false,
            metadata: { ...prediction.metadata, admitPath: "redis_eval_failed" },
          },
          outcome: "deferred",
          reservedPoints: 0,
          leaseExpiresAt: null,
          windowId: expectedWindowId || null,
          idempotent: false,
          providerCallsAvoided: true,
        };
      }

      if (!luaResult.ok) {
        const deniedPrediction = predictionFromLuaDenial(config, input, luaResult.reason);
        const outcome = outcomeForDenial(deniedPrediction.reason);
        logger?.info(
          {
            event:
              outcome === "deferred"
                ? OBS_EVENTS.refreshAdmissionDeferred
                : OBS_EVENTS.refreshAdmissionDenied,
            jobId: input.ingestionJobId,
            admissionReason: deniedPrediction.reason,
            estimatedPoints: estimated,
            reservedPoints: 0,
            providerCallsAvoided: true,
          },
          outcome === "deferred"
            ? OBS_EVENTS.refreshAdmissionDeferred
            : OBS_EVENTS.refreshAdmissionDenied,
        );
        return {
          prediction: deniedPrediction,
          outcome,
          reservedPoints: 0,
          leaseExpiresAt: null,
          windowId: expectedWindowId || null,
          idempotent: false,
          providerCallsAvoided: true,
        };
      }

      const leaseExpiresAt = new Date(nowMs + config.leaseTtlMs);
      const windowId =
        expectedWindowId ||
        (await resolveJobWindowId(redis, appEnv, input.ingestionJobId, null)) ||
        null;
      const idempotent = luaResult.reason === "IDEMPOTENT_EXISTING";

      if (repository) {
        try {
          await repository.upsertReserved({
            jobId: input.ingestionJobId,
            characterId: input.characterId,
            estimatedWclPoints: luaResult.reservedPoints,
            emergencyOverride: Boolean(input.emergencyOverride),
            windowId: windowId ?? "none",
            leaseExpiresAt,
            metadata: {
              reason: luaResult.reason,
              lane: prediction.lane,
              idempotent,
            },
          });
        } catch (err) {
          // Redis already holds — durable audit failure must not fail-open providers;
          // release Redis and defer.
          logger?.error(
            {
              event: OBS_EVENTS.refreshAdmissionDeferred,
              jobId: input.ingestionJobId,
              err,
              admissionReason: "REDIS_UNAVAILABLE",
            },
            "durable admission audit failed after Redis reserve — releasing",
          );
          await evalReleaseAdmission({
            redis,
            appEnv,
            ingestionJobId: input.ingestionJobId,
            windowId: windowId ?? "none",
          }).catch(() => undefined);
          return {
            prediction: {
              ...prediction,
              admitted: false,
              reason: "REDIS_UNAVAILABLE",
              wouldMutateRedis: true,
              metadata: { ...prediction.metadata, admitPath: "postgres_audit_failed" },
            },
            outcome: "deferred",
            reservedPoints: 0,
            leaseExpiresAt: null,
            windowId,
            idempotent: false,
            providerCallsAvoided: true,
          };
        }
      }

      const admittedPrediction: RefreshAdmissionPrediction = {
        ...prediction,
        admitted: true,
        reason: (luaResult.reason as RefreshAdmissionDecisionReason) || "OK",
        wouldMutateRedis: true,
        estimatedWclPoints: luaResult.reservedPoints,
        windowId,
        metadata: {
          ...prediction.metadata,
          admitPath: "lua_reserve",
          idempotent,
          effectiveGlobalConcurrency: effectiveAdmissionGlobalConcurrency(config),
        },
      };

      logger?.info(
        {
          event: OBS_EVENTS.refreshAdmissionReserved,
          jobId: input.ingestionJobId,
          admissionReason: admittedPrediction.reason,
          estimatedPoints: estimated,
          reservedPoints: luaResult.reservedPoints,
          schedulingState: input.schedulingState ?? "RUNNING",
          snapshotAgeMs: input.snapshot
            ? nowMs - Date.parse(input.snapshot.fetchedAt)
            : null,
          idempotent,
        },
        OBS_EVENTS.refreshAdmissionReserved,
      );
      if (luaResult.reservedPoints === 0) {
        logger?.info(
          { event: OBS_EVENTS.refreshSlotAcquired, jobId: input.ingestionJobId },
          OBS_EVENTS.refreshSlotAcquired,
        );
      }

      return {
        prediction: admittedPrediction,
        outcome: "admitted",
        reservedPoints: luaResult.reservedPoints,
        leaseExpiresAt,
        windowId,
        idempotent,
        providerCallsAvoided: false,
      };
    },

    async tryRelease(ingestionJobId, releaseOptions) {
      if (!isRefreshAdmissionRedisMutationEnabled(config)) {
        return { released: false, reason: "redis_mutation_disabled", releasedPoints: 0, hadSlot: false };
      }
      if (!redis) {
        // Durable cancel must succeed even when Redis cleanup fails.
        if (repository) {
          await repository
            .settle({
              jobId: ingestionJobId,
              status: releaseOptions?.status ?? "CANCELLED",
              metadata: { releaseReason: "redis_unavailable" },
            })
            .catch(() => undefined);
        }
        return { released: false, reason: "redis_unavailable", releasedPoints: 0, hadSlot: false };
      }

      let windowId = releaseOptions?.windowId ?? null;
      if (!windowId && repository) {
        const row = await repository.findByJobId(ingestionJobId);
        windowId = row?.windowId ?? null;
      }
      if (!windowId) {
        windowId = await resolveJobWindowId(redis, appEnv, ingestionJobId, null);
      }

      let result: RefreshAdmissionReleaseResult;
      try {
        result = await evalReleaseAdmission({
          redis,
          appEnv,
          ingestionJobId,
          windowId: windowId || "none",
        });
      } catch (err) {
        logger?.warn(
          {
            event: OBS_EVENTS.refreshSlotReleased,
            jobId: ingestionJobId,
            err,
            releaseFailed: true,
          },
          "admission redis release failed — durable status still updated",
        );
        if (repository) {
          await repository
            .settle({
              jobId: ingestionJobId,
              status: releaseOptions?.status ?? "CANCELLED",
              metadata: { releaseReason: "redis_release_failed" },
            })
            .catch(() => undefined);
        }
        return { released: false, reason: "redis_release_failed", releasedPoints: 0, hadSlot: false };
      }

      if (repository) {
        await repository
          .settle({
            jobId: ingestionJobId,
            status: releaseOptions?.status ?? "RELEASED",
            metadata: {
              releasedPoints: result.releasedPoints,
              hadSlot: result.hadSlot,
            },
          })
          .catch(() => undefined);
      }

      logger?.info(
        {
          event: OBS_EVENTS.refreshSlotReleased,
          jobId: ingestionJobId,
          releasedPoints: result.releasedPoints,
          hadSlot: result.hadSlot,
        },
        OBS_EVENTS.refreshSlotReleased,
      );
      return result;
    },

    async tryRenew(ingestionJobId, renewOptions) {
      if (!isRefreshAdmissionRedisMutationEnabled(config) || !redis) {
        return { renewed: false, reason: "redis_mutation_disabled" };
      }
      let windowId = renewOptions?.windowId ?? null;
      if (!windowId && repository) {
        const row = await repository.findByJobId(ingestionJobId);
        windowId = row?.windowId ?? null;
      }
      if (!windowId) {
        windowId = await resolveJobWindowId(redis, appEnv, ingestionJobId, null);
      }
      try {
        const result = await evalRenewAdmission({
          redis,
          appEnv,
          ingestionJobId,
          windowId: windowId || "none",
          leaseTtlMs: config.leaseTtlMs,
        });
        if (result.ok) {
          logger?.info(
            {
              event: OBS_EVENTS.refreshLeaseRenewed,
              jobId: ingestionJobId,
              leaseExpiresAtMs: result.leaseExpiresAtMs,
            },
            OBS_EVENTS.refreshLeaseRenewed,
          );
          if (repository && result.leaseExpiresAtMs != null) {
            const existing = await repository.findByJobId(ingestionJobId);
            if (existing?.status === "RESERVED") {
              await repository
                .upsertReserved({
                  jobId: ingestionJobId,
                  estimatedWclPoints: existing.estimatedWclPoints,
                  emergencyOverride: false,
                  windowId: existing.windowId || windowId || "none",
                  leaseExpiresAt: new Date(result.leaseExpiresAtMs),
                  metadata: { renewed: true },
                })
                .catch(() => undefined);
            }
          }
        }
        return { renewed: result.ok, reason: result.reason };
      } catch (err) {
        logger?.warn(
          { event: OBS_EVENTS.refreshLeaseRenewed, jobId: ingestionJobId, err },
          "lease renew failed",
        );
        return { renewed: false, reason: "redis_renew_failed" };
      }
    },
  };
}
