/**
 * Refresh admission gate (foundation / shadow).
 *
 * - mode=off: no-op
 * - mode=shadow: pure prediction + optional observer callback (no Redis writes)
 * - mode=enforce: prediction only until REFRESH_CONCURRENCY_ENABLED; Redis mutate refused
 *
 * Does not replace Refresh Control cancel/eligibility or publication barriers.
 */

import {
  buildRefreshAdmissionConfig,
  isRefreshAdmissionRedisMutationEnabled,
  type RefreshAdmissionConfig,
  type RefreshAdmissionEnv,
} from "@mplus/config";
import { predictRefreshAdmission } from "./shadow-predict.js";
import type { RefreshAdmissionPredictInput, RefreshAdmissionPrediction } from "./types.js";

export type RefreshAdmissionObserver = (prediction: RefreshAdmissionPrediction) => void | Promise<void>;

export interface RefreshAdmissionGate {
  readonly config: RefreshAdmissionConfig;
  /** Pure / shadow prediction. Never mutates Redis on this foundation branch. */
  predict(input: RefreshAdmissionPredictInput): Promise<RefreshAdmissionPrediction>;
  /**
   * Attempt live admit. Foundation refuses Redis mutation and returns the prediction.
   * Later enforce branch will call Lua when mutation is enabled.
   */
  tryAdmit(input: RefreshAdmissionPredictInput): Promise<RefreshAdmissionPrediction>;
  /** Idempotent release hook placeholder — no Redis work while mutation disabled. */
  tryRelease(ingestionJobId: string): Promise<{ released: boolean; reason: string }>;
}

export function createRefreshAdmissionGate(options: {
  env: RefreshAdmissionEnv;
  config?: RefreshAdmissionConfig;
  onShadowPrediction?: RefreshAdmissionObserver;
}): RefreshAdmissionGate {
  const config = options.config ?? buildRefreshAdmissionConfig(options.env);

  async function predict(input: RefreshAdmissionPredictInput): Promise<RefreshAdmissionPrediction> {
    const prediction = predictRefreshAdmission(config, input);
    if (config.mode === "shadow" && options.onShadowPrediction) {
      await options.onShadowPrediction(prediction);
    }
    return prediction;
  }

  return {
    config,
    predict,
    async tryAdmit(input) {
      const prediction = await predict(input);
      if (!isRefreshAdmissionRedisMutationEnabled(config)) {
        return {
          ...prediction,
          wouldMutateRedis: false,
          metadata: {
            ...prediction.metadata,
            admitPath: "foundation_no_redis_mutation",
          },
        };
      }
      // Activation path reserved for later branches.
      return {
        ...prediction,
        admitted: false,
        reason: "ENFORCE_NOT_ACTIVATED",
        wouldMutateRedis: false,
        metadata: {
          ...prediction.metadata,
          admitPath: "enforce_activation_deferred",
        },
      };
    },
    async tryRelease() {
      if (!isRefreshAdmissionRedisMutationEnabled(config)) {
        return { released: false, reason: "redis_mutation_disabled" };
      }
      return { released: false, reason: "enforce_activation_deferred" };
    },
  };
}
