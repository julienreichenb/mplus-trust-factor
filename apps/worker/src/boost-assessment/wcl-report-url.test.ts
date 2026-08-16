import { describe, expect, it } from "vitest";
import { wclDamageDoneReportUrl } from "./wcl-report-url.js";

describe("wclDamageDoneReportUrl", () => {
  it("builds the Damage Done report URL from persisted identity", () => {
    expect(wclDamageDoneReportUrl("LJc9kp2HP4gfBv6x", 5)).toBe(
      "https://www.warcraftlogs.com/reports/LJc9kp2HP4gfBv6x?fight=5&type=damage-done",
    );
  });

  it("returns null when report identity is missing", () => {
    expect(wclDamageDoneReportUrl(null, 5)).toBeNull();
    expect(wclDamageDoneReportUrl("abc", null)).toBeNull();
    expect(wclDamageDoneReportUrl("", 1)).toBeNull();
  });
});
