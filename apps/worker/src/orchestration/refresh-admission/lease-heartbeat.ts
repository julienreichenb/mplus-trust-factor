/**
 * Renewable lease heartbeat for an admitted refresh job.
 * Ownership is preserved across wall-clock durations while heartbeats succeed.
 */

import type { RefreshAdmissionGate } from "./gate.js";

export interface AdmissionLeaseHeartbeat {
  stop(): void;
}

export function startAdmissionLeaseHeartbeat(input: {
  gate: RefreshAdmissionGate;
  ingestionJobId: string;
  windowId?: string | null;
  intervalMs?: number;
}): AdmissionLeaseHeartbeat {
  const intervalMs = Math.max(
    500,
    input.intervalMs ?? input.gate.config.leaseHeartbeatMs,
  );
  const timer = setInterval(() => {
    void input.gate.tryRenew(input.ingestionJobId, { windowId: input.windowId });
  }, intervalMs);
  // Do not keep the process alive solely for heartbeats in tests.
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
