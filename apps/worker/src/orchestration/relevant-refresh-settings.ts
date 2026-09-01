/**
 * Runtime/env policy for relevant-character background refresh.
 */
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import {
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  DEFAULT_CONCURRENCY_OPERATION,
  RUNTIME_SETTING_KEYS,
} from "@mplus/contracts";

export type RelevantRefreshSettings = {
  /** Effective automatic enable (false when kill switch is on). */
  enabled: boolean;
  /** Stored RuntimeSetting / default before kill switch. */
  runtimeEnabled: boolean;
  killSwitchActive: boolean;
  candidateTarget: number;
  candidatePercentileBps: number;
  refreshConcurrencyEnabled: boolean;
  concurrencyOperation: number;
  wclPreResetDrainSeconds: number;
};

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

function readNonNegativeInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return undefined;
}

function readPercentileBps(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10_000) {
    return value;
  }
  return undefined;
}

function readConcurrencyOperation(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= CONCURRENCY_MIN && value <= CONCURRENCY_MAX) {
    return value;
  }
  return undefined;
}

export async function loadRelevantRefreshSettings(
  prisma: PrismaClient,
  env: AppEnv,
): Promise<RelevantRefreshSettings> {
  const rows = await prisma.runtimeSetting.findMany({
    where: {
      key: {
        in: [
          RUNTIME_SETTING_KEYS.relevantRefreshEnabled,
          RUNTIME_SETTING_KEYS.relevantCandidateTarget,
          RUNTIME_SETTING_KEYS.relevantCandidatePercentileBps,
          RUNTIME_SETTING_KEYS.refreshConcurrencyEnabled,
          RUNTIME_SETTING_KEYS.concurrencyOperation,
          RUNTIME_SETTING_KEYS.wclPreResetDrainSeconds,
        ],
      },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const runtimeEnabled = readBoolean(byKey.get(RUNTIME_SETTING_KEYS.relevantRefreshEnabled)) ?? false;
  const killSwitchActive = Boolean(env.RELEVANT_REFRESH_KILL_SWITCH);
  return {
    enabled: killSwitchActive ? false : runtimeEnabled,
    runtimeEnabled,
    killSwitchActive,
    candidateTarget:
      readPositiveInt(byKey.get(RUNTIME_SETTING_KEYS.relevantCandidateTarget)) ??
      env.RELEVANT_CANDIDATE_TARGET,
    candidatePercentileBps:
      readPercentileBps(byKey.get(RUNTIME_SETTING_KEYS.relevantCandidatePercentileBps)) ??
      env.RELEVANT_CANDIDATE_PERCENTILE_BPS,
    refreshConcurrencyEnabled:
      readBoolean(byKey.get(RUNTIME_SETTING_KEYS.refreshConcurrencyEnabled)) ??
      env.REFRESH_CONCURRENCY_ENABLED,
    concurrencyOperation:
      readConcurrencyOperation(byKey.get(RUNTIME_SETTING_KEYS.concurrencyOperation)) ??
      DEFAULT_CONCURRENCY_OPERATION,
    wclPreResetDrainSeconds:
      readNonNegativeInt(byKey.get(RUNTIME_SETTING_KEYS.wclPreResetDrainSeconds)) ??
      env.WCL_PRE_RESET_DRAIN_SECONDS,
  };
}

/** OPERATION lane limit: parallel toggle off forces serial (1). */
export function effectiveOperationLaneLimit(input: {
  concurrencyOperation: number;
  refreshConcurrencyEnabled: boolean;
}): number {
  if (!input.refreshConcurrencyEnabled) return 1;
  return input.concurrencyOperation;
}
