import { describe, expect, it } from "vitest";
import { effectiveOperationLaneLimit } from "./relevant-refresh-settings.js";

describe("effectiveOperationLaneLimit", () => {
  it("serializes OPERATION when refresh_concurrency_enabled is false", () => {
    expect(
      effectiveOperationLaneLimit({
        concurrencyOperation: 4,
        refreshConcurrencyEnabled: false,
      }),
    ).toBe(1);
  });

  it("uses concurrency_operation when parallel refresh is enabled", () => {
    expect(
      effectiveOperationLaneLimit({
        concurrencyOperation: 4,
        refreshConcurrencyEnabled: true,
      }),
    ).toBe(4);
  });
});
