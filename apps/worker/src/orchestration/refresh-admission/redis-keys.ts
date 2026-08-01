/**
 * Environment-scoped Redis key helpers for refresh admission.
 * Prefix: mplus:{env}:refresh:
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
    /** Maps IngestionJob.id → windowId for release when Postgres row is missing. */
    jobWindow: (jobId: string) => `${prefix}job:${jobId}:window`,
    emaPrefix: `${prefix}ema:`,
  } as const;
}
