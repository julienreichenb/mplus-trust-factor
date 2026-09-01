/**
 * RuntimeSetting overrides for refresh admission (concurrency + drain window).
 */
import type { PrismaClient } from "@mplus/database";
import { RUNTIME_SETTING_KEYS } from "@mplus/contracts";

export type RefreshAdmissionRuntimeOverrides = {
  concurrencyEnabled?: boolean;
  /** WCL admission global slots — admin `concurrency_operation` when concurrency is enabled. */
  globalConcurrency?: number;
  wclPreResetDrainSeconds?: number;
};

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return undefined;
}

export async function loadRefreshAdmissionRuntimeOverrides(
  prisma: PrismaClient,
): Promise<RefreshAdmissionRuntimeOverrides> {
  const rows = await prisma.runtimeSetting.findMany({
    where: {
      key: {
        in: [
          RUNTIME_SETTING_KEYS.refreshConcurrencyEnabled,
          RUNTIME_SETTING_KEYS.concurrencyOperation,
          RUNTIME_SETTING_KEYS.wclPreResetDrainSeconds,
        ],
      },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const concurrencyEnabled = readBoolean(byKey.get(RUNTIME_SETTING_KEYS.refreshConcurrencyEnabled));
  const globalConcurrency = readPositiveInt(byKey.get(RUNTIME_SETTING_KEYS.concurrencyOperation));
  const wclPreResetDrainSeconds = readPositiveInt(
    byKey.get(RUNTIME_SETTING_KEYS.wclPreResetDrainSeconds),
  );
  return {
    ...(concurrencyEnabled != null ? { concurrencyEnabled } : {}),
    ...(globalConcurrency != null && globalConcurrency >= 1
      ? { globalConcurrency }
      : {}),
    ...(wclPreResetDrainSeconds != null ? { wclPreResetDrainSeconds } : {}),
  };
}
