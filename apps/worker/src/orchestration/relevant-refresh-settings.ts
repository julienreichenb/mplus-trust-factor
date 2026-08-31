/**
 * Runtime/env policy for relevant-character background refresh.
 */
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import { RUNTIME_SETTING_KEYS } from "@mplus/contracts";

export type RelevantRefreshSettings = {
  enabled: boolean;
  candidateTarget: number;
  candidatePercentileBps: number;
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

function readPercentileBps(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10_000) {
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
        ],
      },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const runtimeEnabled = readBoolean(byKey.get(RUNTIME_SETTING_KEYS.relevantRefreshEnabled));
  return {
    enabled: env.RELEVANT_REFRESH_KILL_SWITCH ? false : (runtimeEnabled ?? false),
    candidateTarget:
      readPositiveInt(byKey.get(RUNTIME_SETTING_KEYS.relevantCandidateTarget)) ??
      env.RELEVANT_CANDIDATE_TARGET,
    candidatePercentileBps:
      readPercentileBps(byKey.get(RUNTIME_SETTING_KEYS.relevantCandidatePercentileBps)) ??
      env.RELEVANT_CANDIDATE_PERCENTILE_BPS,
  };
}
