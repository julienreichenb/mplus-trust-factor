import { describe, expect, it } from "vitest";
import {
  classifyWclRunDiscoveryOutcome,
  wclDiscoveryWarning,
} from "./wcl-discovery-outcome.js";

describe("classifyWclRunDiscoveryOutcome", () => {
  it("marks disabled providers as WCL_DISABLED (not NO_PUBLIC_RUNS)", () => {
    expect(
      classifyWclRunDiscoveryOutcome({
        disabled: true,
        threw: false,
        runCount: 0,
      }),
    ).toBe("WCL_DISABLED");
    expect(wclDiscoveryWarning("WCL_DISABLED")).toBe("WCL_DISABLED");
  });

  it("marks thrown discovery as WCL_DISCOVERY_FAILED with technical detail", () => {
    expect(
      classifyWclRunDiscoveryOutcome({
        disabled: false,
        threw: true,
        runCount: 0,
      }),
    ).toBe("WCL_DISCOVERY_FAILED");
    expect(
      wclDiscoveryWarning(
        "WCL_DISCOVERY_FAILED",
        "Cannot read properties of undefined (reading 'visibility')",
      ),
    ).toBe(
      "WCL_DISCOVERY_FAILED:Cannot read properties of undefined (reading 'visibility')",
    );
  });

  it("marks successful empty discovery as NO_PUBLIC_RUNS", () => {
    expect(
      classifyWclRunDiscoveryOutcome({
        disabled: false,
        threw: false,
        runCount: 0,
        dataState: "NO_PUBLIC_LOGS",
      }),
    ).toBe("NO_PUBLIC_RUNS");
    expect(wclDiscoveryWarning("NO_PUBLIC_RUNS")).toBe("WCL_NO_PUBLIC_RUNS");
  });

  it("marks non-empty discovery as OK", () => {
    expect(
      classifyWclRunDiscoveryOutcome({
        disabled: false,
        threw: false,
        runCount: 11,
      }),
    ).toBe("OK");
    expect(wclDiscoveryWarning("OK")).toBeNull();
  });
});
