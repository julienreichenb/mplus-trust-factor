import { describe, expect, it } from "vitest";
import { assertLocalDevResetAllowed } from "./dev-reset-guards.js";

describe("ability-catalog:dev:reset guards", () => {
  it("refuses production NODE_ENV", () => {
    expect(() =>
      assertLocalDevResetAllowed({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://mplus:mplus@127.0.0.1:5433/mplus_trust",
      }),
    ).toThrow(/REFUSED/);
  });

  it("refuses non-local DATABASE_URL without override", () => {
    expect(() =>
      assertLocalDevResetAllowed({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@prod.example.com:5432/mplus",
      }),
    ).toThrow(/REFUSED/);
  });

  it("allows local development DATABASE_URL", () => {
    expect(() =>
      assertLocalDevResetAllowed({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://mplus:mplus@127.0.0.1:5433/mplus_trust",
      }),
    ).not.toThrow();
  });

  it("allows non-local URL only with explicit override", () => {
    expect(() =>
      assertLocalDevResetAllowed({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@prod.example.com:5432/mplus",
        ABILITY_CATALOG_ALLOW_DEV_RESET: "1",
      }),
    ).not.toThrow();
  });
});
