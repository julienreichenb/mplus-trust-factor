import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { buildApp } from "./app.js";

resetEnvCache();
const env = loadEnv({
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  ADMIN_API_KEY: process.env.ADMIN_API_KEY ?? "local-dev-admin-key",
  SESSION_SECRET:
    process.env.SESSION_SECRET ?? "local-openapi-generate-session-secret-32",
  PROVIDER_MODE: process.env.PROVIDER_MODE ?? "fixture",
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
});
const app = await buildApp({ env });
await app.ready();
const spec = app.swagger();
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
await writeFile(outPath, JSON.stringify(spec, null, 2), "utf8");
await app.close();
console.log(`OpenAPI written to ${outPath}`);
