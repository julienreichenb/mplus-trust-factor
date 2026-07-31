/**
 * Environment-scoped Redis key helpers for refresh admission.
 * Prefix: mplus:{env}:refresh:
 * Mutations remain disabled unless admission enforce + concurrency flags are on.
 */

export function refreshAdmissionKeyPrefix(appEnv: string): string {
  const env = (appEnv || "development").trim().toLowerCase() || "development";
  return `mplus:${env}:refresh:`;
}

export function refreshAdmissionKeys(appEnv: string) {
  const prefix = refreshAdmissionKeyPrefix(appEnv);
  return {
    prefix,
    schedulingState: `${prefix}sched:state`,
    wclSnapshot: `${prefix}wcl:snap`,
    wclReservedTotal: (windowId: string) => `${prefix}wcl:${windowId}:reserved:total`,
    wclReservations: (windowId: string) => `${prefix}wcl:${windowId}:res`,
    wclLeaseZset: `${prefix}wcl:lease`,
    slotOwners: `${prefix}slot:owners`,
    slotLeaseZset: `${prefix}slot:lease`,
    slotCount: `${prefix}slot:count`,
    emaPrefix: `${prefix}ema:`,
  } as const;
}
