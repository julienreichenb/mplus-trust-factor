import { describe, expect, it } from "vitest";
import { QUEUE_NAMES } from "@mplus/contracts";
import {
  expectedRefreshQueueForWorkloadClass,
  resolveAuthoritativeWorkloadClass,
  workloadClassQueueDisagreement,
  WORKLOAD_CLASS_PAYLOAD_MISMATCH,
  WORKLOAD_CLASS_QUEUE_MISMATCH,
} from "./workload-class.js";

describe("resolveAuthoritativeWorkloadClass", () => {
  it("prefers DB OPERATION over payload CALIBRATION", () => {
    const r = resolveAuthoritativeWorkloadClass({
      persistedWorkloadClass: "OPERATION",
      payloadWorkloadClass: "CALIBRATION",
    });
    expect(r.workloadClass).toBe("OPERATION");
    expect(r.mismatch).toBe(true);
    expect(r.reasonCode).toBe(WORKLOAD_CLASS_PAYLOAD_MISMATCH);
  });

  it("prefers DB CALIBRATION over payload OPERATION", () => {
    const r = resolveAuthoritativeWorkloadClass({
      persistedWorkloadClass: "CALIBRATION",
      payloadWorkloadClass: "OPERATION",
    });
    expect(r.workloadClass).toBe("CALIBRATION");
    expect(r.mismatch).toBe(true);
  });

  it("defaults legacy null DB to OPERATION with legacyDbDefault", () => {
    const r = resolveAuthoritativeWorkloadClass({
      persistedWorkloadClass: null,
      payloadWorkloadClass: "CALIBRATION",
    });
    expect(r.workloadClass).toBe("OPERATION");
    expect(r.legacyDbDefault).toBe(true);
    expect(r.mismatch).toBe(true);
  });

  it("accepts legacy payload without workloadClass when DB is OPERATION", () => {
    const r = resolveAuthoritativeWorkloadClass({
      persistedWorkloadClass: "OPERATION",
      payloadWorkloadClass: undefined,
    });
    expect(r.workloadClass).toBe("OPERATION");
    expect(r.mismatch).toBe(false);
    expect(r.reasonCode).toBeNull();
  });
});

describe("workloadClassQueueDisagreement", () => {
  it("fails closed when OPERATION job is on calibration queue", () => {
    const d = workloadClassQueueDisagreement({
      persistedWorkloadClass: "OPERATION",
      queueName: QUEUE_NAMES.refreshCharacterCalibration,
    });
    expect(d?.reasonCode).toBe(WORKLOAD_CLASS_QUEUE_MISMATCH);
  });

  it("fails closed when CALIBRATION job is on operation queue", () => {
    const d = workloadClassQueueDisagreement({
      persistedWorkloadClass: "CALIBRATION",
      queueName: QUEUE_NAMES.refreshCharacter,
    });
    expect(d?.reasonCode).toBe(WORKLOAD_CLASS_QUEUE_MISMATCH);
  });

  it("allows matching queue and ignores unknown queues", () => {
    expect(
      workloadClassQueueDisagreement({
        persistedWorkloadClass: "OPERATION",
        queueName: QUEUE_NAMES.refreshCharacter,
      }),
    ).toBeNull();
    expect(
      workloadClassQueueDisagreement({
        persistedWorkloadClass: "CALIBRATION",
        queueName: expectedRefreshQueueForWorkloadClass("CALIBRATION"),
      }),
    ).toBeNull();
    expect(
      workloadClassQueueDisagreement({
        persistedWorkloadClass: "OPERATION",
        queueName: null,
      }),
    ).toBeNull();
  });
});
