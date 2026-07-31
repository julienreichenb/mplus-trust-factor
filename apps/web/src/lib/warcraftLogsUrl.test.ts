import { describe, expect, it } from "vitest";
import { sanitizeWarcraftLogsUrl, WARCRAFT_LOGS_URL_HOSTNAMES } from "./warcraftLogsUrl";

describe("sanitizeWarcraftLogsUrl (web)", () => {
  it("accepts approved HTTPS hostnames", () => {
    expect(sanitizeWarcraftLogsUrl("https://www.warcraftlogs.com/reports/ABC?fight=1")).toBe(
      "https://www.warcraftlogs.com/reports/ABC?fight=1",
    );
    expect(sanitizeWarcraftLogsUrl("https://warcraftlogs.com/reports/ABC")).toContain("warcraftlogs.com");
    expect([...WARCRAFT_LOGS_URL_HOSTNAMES]).toEqual(["www.warcraftlogs.com", "warcraftlogs.com"]);
  });

  it("rejects missing, malformed, non-HTTPS, unrelated, deceptive, and credentialed URLs", () => {
    expect(sanitizeWarcraftLogsUrl(null)).toBeNull();
    expect(sanitizeWarcraftLogsUrl("")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("not a url")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("http://www.warcraftlogs.com/reports/ABC")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("https://evil.example/reports/ABC")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("https://warcraftlogs.com.attacker.example/x")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("data:text/html,hi")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("https://user:pass@www.warcraftlogs.com/reports/ABC")).toBeNull();
  });
});
