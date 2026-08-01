/**
 * Stable structured log event names for Wave 3 refresh / provider / scoring observability.
 * Prefer these over free-form messages so operators can filter and correlate reliably.
 */
export const OBS_EVENTS = {
  refreshRequested: "refresh.requested",
  refreshDedupe: "refresh.dedupe",
  refreshEnqueueOk: "refresh.enqueue.success",
  refreshEnqueueFail: "refresh.enqueue.failure",
  refreshWorkerStarted: "refresh.worker.started",
  refreshProviderPhaseStarted: "refresh.provider.phase.started",
  refreshProviderPhaseCompleted: "refresh.provider.phase.completed",
  refreshFusionCompleted: "refresh.fusion.completed",
  refreshScoreCalculated: "refresh.score.calculated",
  refreshPersistenceCompleted: "refresh.persistence.completed",
  refreshTerminal: "refresh.terminal",
  providerOperation: "provider.operation",
  refreshAdmissionShadow: "refresh.admission.shadow",
  refreshAdmissionReserved: "refresh.admission.reserved",
  refreshAdmissionDeferred: "refresh.admission.deferred",
  refreshAdmissionDenied: "refresh.admission.denied",
  refreshAdmissionSettled: "refresh.admission.settled",
  refreshLeaseRenewed: "refresh.lease.renewed",
  refreshLeaseExpired: "refresh.lease.expired",
  refreshSlotAcquired: "refresh.slot.acquired",
  refreshSlotReleased: "refresh.slot.released",
} as const;

export type ObsEventName = (typeof OBS_EVENTS)[keyof typeof OBS_EVENTS];
