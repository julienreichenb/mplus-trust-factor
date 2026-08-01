import { describe, expect, it } from "vitest";
import {
  hasExplicitBootstrapRepairSignal,
  inferBootstrapRepairRequired,
  reconcileProfileRefreshStatus,
  refreshStatusHasRealInFlightJob,
} from "./bootstrapRepair";

describe("bootstrapRepair helpers", () => {
  it("detects explicit bootstrap repair signals", () => {
    expect(hasExplicitBootstrapRepairSignal({ bootstrapRepairRequired: true, warnings: [] })).toBe(
      true,
    );
    expect(
      hasExplicitBootstrapRepairSignal({
        bootstrapRepairRequired: false,
        warnings: [{ code: "CHARACTER_BOOTSTRAP_INCOMPLETE", message: "x", severity: "WARN" }],
      }),
    ).toBe(true);
  });

  it("applies the narrow Myzouth version-skew fallback", () => {
    expect(
      inferBootstrapRepairRequired({
        bootstrapRepairRequired: undefined,
        score: null,
        level: null,
        role: null,
        classSlug: null,
        specSlug: null,
        warnings: [
          {
            code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
            message: "unknown",
            severity: "WARN",
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not infer repair from optional presentation gaps alone", () => {
    expect(
      inferBootstrapRepairRequired({
        bootstrapRepairRequired: false,
        score: null,
        level: 90,
        role: "DPS",
        classSlug: "mage",
        specSlug: "frost",
        warnings: [],
      }),
    ).toBe(false);
    expect(
      inferBootstrapRepairRequired({
        bootstrapRepairRequired: false,
        score: null,
        level: 90,
        role: "DPS",
        classSlug: "mage",
        specSlug: "frost",
        warnings: [
          {
            code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
            message: "unknown",
            severity: "WARN",
          },
        ],
      }),
    ).toBe(false);
  });

  it("requires a real queued/active job for in-flight", () => {
    expect(
      refreshStatusHasRealInFlightJob({
        refreshStatus: "QUEUED",
        job: null,
      }),
    ).toBe(false);
    expect(
      refreshStatusHasRealInFlightJob({
        refreshStatus: "QUEUED",
        job: { id: "j1", status: "queued" } as never,
      }),
    ).toBe(true);
  });

  it("reconciles terminal FAILED without inventing QUEUED", () => {
    expect(
      reconcileProfileRefreshStatus({
        hasScore: false,
        status: { refreshStatus: "FAILED", job: { id: "j1", status: "failed" } as never },
      }),
    ).toBe("FAILED");
    expect(
      reconcileProfileRefreshStatus({
        hasScore: false,
        status: { refreshStatus: "QUEUED", job: null },
      }),
    ).toBe("FAILED");
  });
});
