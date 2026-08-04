import path from "node:path";
import { defineConfig, type UserConfig } from "vitest/config";

type IntegrationTestConfig = NonNullable<UserConfig["test"]>;

/**
 * Shared Vitest base for Postgres integration suites.
 * Callers supply include/exclude (and optional parallelism overrides).
 */
export function createIntegrationConfig(testOverrides: IntegrationTestConfig) {
  return defineConfig({
    resolve: {
      alias: {
        "@mplus/config": path.resolve(__dirname, "packages/config/src/index.ts"),
        "@mplus/contracts": path.resolve(__dirname, "packages/contracts/src/index.ts"),
        "@mplus/database": path.resolve(__dirname, "packages/database/src/index.ts"),
        "@mplus/artifact-store": path.resolve(__dirname, "packages/artifact-store/src/index.ts"),
        "@mplus/domain": path.resolve(__dirname, "packages/domain/src/index.ts"),
        "@mplus/observability": path.resolve(__dirname, "packages/observability/src/index.ts"),
        "@mplus/scoring": path.resolve(__dirname, "packages/scoring/src/index.ts"),
        "@mplus/abilities": path.resolve(__dirname, "packages/abilities/src/index.ts"),
        "@mplus/mechanics": path.resolve(__dirname, "packages/mechanics/src/index.ts"),
        "@mplus/provider-blizzard": path.resolve(
          __dirname,
          "packages/providers/blizzard/src/index.ts",
        ),
        "@mplus/provider-warcraftlogs": path.resolve(
          __dirname,
          "packages/providers/warcraftlogs/src/index.ts",
        ),
        "@mplus/provider-raiderio": path.resolve(
          __dirname,
          "packages/providers/raiderio/src/index.ts",
        ),
        "@mplus/worker": path.resolve(__dirname, "apps/worker/src/public-api.ts"),
        "@mplus/addon-exporter": path.resolve(__dirname, "tools/addon-exporter/src/index.ts"),
        "@mplus/test-utils": path.resolve(__dirname, "packages/test-utils/src/index.ts"),
        "@mplus/api-app": path.resolve(__dirname, "apps/api/src/app.ts"),
      },
    },
    test: {
      globals: false,
      environment: "node",
      testTimeout: 120_000,
      hookTimeout: 120_000,
      env: {
        PROVIDER_MODE: "fixture",
        NODE_ENV: "test",
        APP_ENV: "test",
        // DATABASE_URL + MPLUS_ISOLATED_TEST_DB must be set by run-tests-isolated.
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        ...(process.env.MPLUS_ISOLATED_TEST_DB
          ? { MPLUS_ISOLATED_TEST_DB: process.env.MPLUS_ISOLATED_TEST_DB }
          : {}),
        REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
        WEB_ORIGIN: "http://localhost:5173",
        PUBLIC_BASE_URL: "http://localhost:3000",
        SESSION_SECRET: "test-session-secret-at-least-32-chars",
        ADMIN_API_KEY: "test-admin-key",
        ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
      },
      ...testOverrides,
    },
  });
}
