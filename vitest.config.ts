import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@mplus/config": path.resolve(__dirname, "packages/config/src/index.ts"),
      "@mplus/contracts": path.resolve(__dirname, "packages/contracts/src/index.ts"),
      "@mplus/database": path.resolve(__dirname, "packages/database/src/index.ts"),
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
    // Integration-style API/worker tests run inline refresh against shared Postgres;
    // under parallel load the default 5s is too tight after eligibility seeding.
    testTimeout: 30_000,
    include: ["**/src/**/*.test.ts", "**/tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.integration.test.ts",
      "apps/web/**",
    ],
    // DB-backed Fastify inject suites regularly exceed the 5s Vitest default under load.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      PROVIDER_MODE: "fixture",
      NODE_ENV: "test",
      APP_ENV: "test",
      // Prefer an explicit DATABASE_URL (CI uses :5432). Local compose maps Postgres to :5433.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      WEB_ORIGIN: "http://localhost:5173",
      PUBLIC_BASE_URL: "http://localhost:3000",
      SESSION_SECRET: "test-session-secret-at-least-32-chars",
      ADMIN_API_KEY: "test-admin-key",
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
    },
  },
});
