import { describe, expect, it } from "vitest";
import { loadCatalogSyncEnv } from "./index.js";

describe("loadCatalogSyncEnv", () => {
  it("accepts only sync-required fields", () => {
    const env = loadCatalogSyncEnv({
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      BLIZZARD_CLIENT_ID: "id",
      BLIZZARD_CLIENT_SECRET: "secret",
      ABILITY_CATALOG_SIMC_BIN: "/usr/local/bin/simc",
    });
    expect(env.DATABASE_URL).toContain("postgresql://");
    expect(env.BLIZZARD_CLIENT_ID).toBe("id");
    expect(env.ABILITY_CATALOG_SIMC_BIN).toBe("/usr/local/bin/simc");
  });

  it("does not require REDIS_URL, ADMIN_API_KEY, or SESSION_SECRET", () => {
    expect(() =>
      loadCatalogSyncEnv({
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        BLIZZARD_CLIENT_ID: "id",
        BLIZZARD_CLIENT_SECRET: "secret",
      }),
    ).not.toThrow();
  });

  it("fails closed without Blizzard credentials", () => {
    expect(() =>
      loadCatalogSyncEnv({
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      }),
    ).toThrow(/catalog-sync configuration/i);
  });
});
