/**
 * Re-validate a persisted ability catalog release (CAS + digest + schema).
 *
 *   pnpm ability-catalog:release:verify -- --release-id <uuid> [--json]
 *
 * Does not mutate semantic content. Does not activate.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { AbilityCatalogReleaseService } from "../services/ability-catalog-release-service.js";

function arg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function printUsage(): never {
  console.error(`Usage:
  pnpm ability-catalog:release:verify -- --release-id <uuid> [--json]

Loads CAS bytes, verifies digests/releaseKey/schema, runs artifact validator.
Does not publish or activate.`);
  process.exit(2);
}

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../..");
loadDotEnvFile(resolve(root, ".env"));
resetEnvCache();

const argv = process.argv.slice(2);
const releaseId = arg(argv, "--release-id");
const json = argv.includes("--json");
if (!releaseId) printUsage();

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const service = new AbilityCatalogReleaseService(prisma);

try {
  const result = await service.revalidateRelease(releaseId!, {
    actorType: "system",
    sessionSecret: env.SESSION_SECRET,
    userId: null,
  });
  const payload = {
    notice: "THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.",
    releaseId: result.release.id,
    releaseKey: result.release.releaseKey,
    contentDigest: result.release.contentDigest,
    status: result.release.status,
    validationStatus: result.release.validationStatus,
    validatorVersion: result.validatorVersion,
    valid: result.validation.valid,
    errorCount: result.validation.errors.length,
    warningCount: result.validation.warnings.length,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      Object.entries(payload)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join("\n"),
    );
  }
  if (!result.validation.valid) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
