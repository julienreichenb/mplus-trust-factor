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
      "@mplus/worker": path.resolve(__dirname, "apps/worker/src/public-api.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["**/src/**/*.test.ts", "**/tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
    env: {
      PROVIDER_MODE: "fixture",
      NODE_ENV: "test",
      APP_ENV: "test",
      DATABASE_URL: "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public",
      REDIS_URL: "redis://localhost:6379",
      WEB_ORIGIN: "http://localhost:5173",
      PUBLIC_BASE_URL: "http://localhost:3000",
      SESSION_SECRET: "test-session-secret-at-least-32-chars",
      ADMIN_API_KEY: "test-admin-key",
    },
  },
});
