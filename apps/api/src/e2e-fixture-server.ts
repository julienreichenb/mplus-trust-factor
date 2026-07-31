/**
 * Fixture-mode API for Playwright E2E (inline refresh pipeline, no Redis worker).
 * Requires DATABASE_URL from the environment (prefer an isolated disposable test DB).
 * Never falls back to the shared mplus_trust development database — set DATABASE_URL
 * explicitly (e.g. via the isolated test runner or E2E harness).
 */
import { loadEnv, resetEnvCache } from "@mplus/config";
import { checkDatabaseHealth, createPrismaClient } from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer } from "./container.js";

const port = Number(process.env.E2E_API_PORT ?? 3099);
const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:4199";

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    "E2E fixture API: DATABASE_URL is required (do not use the shared mplus_trust fallback).",
  );
  process.exit(1);
}

resetEnvCache();
const env = loadEnv({
  ...process.env,
  API_HOST: "127.0.0.1",
  API_PORT: String(port),
  PROVIDER_MODE: "fixture",
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  ADMIN_API_KEY: process.env.ADMIN_API_KEY ?? "test-admin-key",
  ADMIN_API_KEY_EMERGENCY_FALLBACK: process.env.ADMIN_API_KEY_EMERGENCY_FALLBACK ?? "true",
  SESSION_SECRET: process.env.SESSION_SECRET ?? "test-session-secret-at-least-32-chars",
  WEB_ORIGIN: webOrigin,
  PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
});

const prisma = createPrismaClient(env.DATABASE_URL);
const health = await checkDatabaseHealth(prisma);
if (!health.ok) {
  console.error(`E2E fixture API: database unavailable — ${health.error ?? "unknown"}`);
  process.exit(1);
}

const container = createApiContainer(env, { workerOverrides: { prisma }, skipQueues: true });
const app = await buildApp({ env, container });
await app.listen({ host: "127.0.0.1", port });
console.log(`E2E fixture API listening on http://127.0.0.1:${port}`);

const shutdown = async (): Promise<void> => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
