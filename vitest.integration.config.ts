import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      PROVIDER_MODE: "fixture",
      NODE_ENV: "test",
      APP_ENV: "test",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      WEB_ORIGIN: "http://localhost:5173",
      PUBLIC_BASE_URL: "http://localhost:3000",
      SESSION_SECRET: "test-session-secret-at-least-32-chars",
      ADMIN_API_KEY: "test-admin-key",
    },
  },
});
