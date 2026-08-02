import { describe, expect, it } from "vitest";
import {
  assertScoringV2TestResetAllowed,
  SCORING_V2_RESET_CONFIRMATION_TOKEN,
} from "./v2-test-reset-guard.js";

describe("assertScoringV2TestResetAllowed", () => {
  it("rejects non-test / production APP_ENV", () => {
    const result = assertScoringV2TestResetAllowed({
      appEnv: "production",
      confirmationToken: SCORING_V2_RESET_CONFIRMATION_TOKEN,
      databaseUrl: "postgresql://u:p@localhost:5432/mplus_itest_abcdef12",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing confirmation token", () => {
    const result = assertScoringV2TestResetAllowed({
      appEnv: "test",
      databaseUrl: "postgresql://u:p@localhost:5432/mplus_itest_abcdef12",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects development shared database name", () => {
    const result = assertScoringV2TestResetAllowed({
      appEnv: "test",
      confirmationToken: SCORING_V2_RESET_CONFIRMATION_TOKEN,
      databaseUrl: "postgresql://u:p@localhost:5432/mplus_trust",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects production-looking database names", () => {
    const result = assertScoringV2TestResetAllowed({
      appEnv: "test",
      confirmationToken: SCORING_V2_RESET_CONFIRMATION_TOKEN,
      databaseUrl: "postgresql://u:p@localhost:5432/mplus_trust_prod",
    });
    expect(result.ok).toBe(false);
  });

  it("allows disposable isolated test DB with token", () => {
    const result = assertScoringV2TestResetAllowed({
      appEnv: "test",
      confirmationToken: SCORING_V2_RESET_CONFIRMATION_TOKEN,
      databaseUrl: "postgresql://u:p@localhost:5432/mplus_itest_abcdef12",
    });
    expect(result.ok).toBe(true);
  });
});
