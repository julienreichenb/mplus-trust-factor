import { describe, expect, it } from "vitest";
import { classifyError } from "./retry-classification.js";
import { RefreshEligibilityError } from "./refresh-eligibility-gate.js";

describe("retry classification for cancellation", () => {
  it("does not treat CANCELLED as provider-failure backoff", () => {
    const result = classifyError({ code: "CANCELLED", message: "admin_cancel" });
    expect(result.retryable).toBe(false);
    expect(result.providerFailure).toBe(false);
    expect(result.softSkip).toBe(false);
  });

  it("does not treat eligibility failures as provider-failure backoff", () => {
    const result = classifyError(
      new RefreshEligibilityError({
        eligible: false,
        code: "CHARACTER_BELOW_MAX_LEVEL",
        message: "below max",
        maxCharacterLevel: 90,
        policyVersion: "v1",
      }),
    );
    expect(result.retryable).toBe(false);
    expect(result.providerFailure).toBe(false);
  });

  it("treats scoring_RATE_DEFER as retryable after claim release", () => {
    const result = classifyError({
      code: "scoring_RATE_DEFER",
      message: "global_wcl_permit_unavailable",
      delayMs: 5_000,
    });
    expect(result.retryable).toBe(true);
    expect(result.providerFailure).toBe(false);
    expect(result.delayMs).toBe(5_000);
  });
});
