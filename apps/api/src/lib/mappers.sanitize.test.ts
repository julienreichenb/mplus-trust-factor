import { describe, expect, it } from "vitest";
import { sanitizePublicExplanation } from "./mappers.js";

describe("sanitizePublicExplanation", () => {
  it("strips private WCL report codes and OAuth fields", () => {
    const sanitized = sanitizePublicExplanation({
      observations: [
        {
          metricKey: "survival.death_rate",
          context: { fightId: 3, reportCode: "SECRETCODE", limitations: [] },
        },
      ],
      access_token: "tok",
      client_secret: "sec",
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/reportCode|SECRETCODE|access_token|client_secret/i);
    expect((sanitized as { observations: Array<{ context: { fightId: number } }> }).observations[0]?.context.fightId).toBe(3);
  });
});
