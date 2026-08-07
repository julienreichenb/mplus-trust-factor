import { describe, expect, it } from "vitest";
import { QUEUE_NAMES } from "@mplus/contracts";

/**
 * Refresh ETA / admission count only IngestionJob rows with jobType refresh-character.
 * Calibration uses a dedicated BullMQ queue and must never share that jobType.
 * Product calibration may use providers for WCL acquisition, but never refresh-character.
 */
describe("calibration refresh isolation", () => {
  it("keeps calibration-run off the refresh-character IngestionJob surface", () => {
    expect(QUEUE_NAMES.calibrationRun).toBe("calibration-run");
    expect(QUEUE_NAMES.refreshCharacter).toBe("refresh-character");
    expect(QUEUE_NAMES.calibrationRun).not.toBe(QUEUE_NAMES.refreshCharacter);
  });
});
