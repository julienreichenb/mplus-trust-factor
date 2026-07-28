/**
 * Check WCL rate budget for live Survival work.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { createWorkerContainer } from "./container.js";

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../..");
loadDotEnvFile(resolve(repoRoot, ".env"));
loadDotEnvFile(resolve(here, "../.env"));
process.env.PROVIDER_MODE = "live";
process.env.ALLOW_LIVE_PROVIDER_CALLS = "true";
resetEnvCache();

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const worker = createWorkerContainer(env, { prisma });
const budget = await worker.providers.warcraftlogs.fetchRateLimit({
  region: "EU",
  requestId: `rl-${Date.now()}`,
  now: new Date().toISOString(),
  targetCharacter: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
});
console.log(JSON.stringify(budget, null, 2));
await prisma.$disconnect();
