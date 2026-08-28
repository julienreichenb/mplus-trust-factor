/**
 * Explicit RELEASE-pinned refresh CLI (Phase 3B.4).
 *
 *   pnpm ability-catalog:release:test-run -- --release-id <uuid> --character-id <uuid>
 *
 * THIS DOES NOT ACTIVATE THE RELEASE.
 * THIS DOES NOT CHANGE DEFAULT ANALYSES.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createApiContainer } from "../container.js";
import { AbilityCatalogReleaseTestRunService } from "../services/ability-catalog-release-test-run.js";

function arg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
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
let root = resolve(here, "../../..");
for (;;) {
  if (existsSync(resolve(root, "pnpm-workspace.yaml"))) break;
  const parent = dirname(root);
  if (parent === root) break;
  root = parent;
}
loadDotEnvFile(resolve(root, ".env"));
resetEnvCache();

const argv = process.argv.slice(2);
const releaseId = arg(argv, "--release-id");
const characterId = arg(argv, "--character-id");
const region = arg(argv, "--region");
const realmSlug = arg(argv, "--realm-slug");
const name = arg(argv, "--name");
const json = argv.includes("--json");

if (!releaseId) {
  console.error(`Usage:
  pnpm ability-catalog:release:test-run -- --release-id <uuid> --character-id <uuid>
  pnpm ability-catalog:release:test-run -- --release-id <uuid> --region EU --realm-slug <slug> --name <name>

THIS DOES NOT ACTIVATE THE RELEASE.
THIS DOES NOT CHANGE DEFAULT ANALYSES.`);
  process.exit(2);
}

const env = loadEnv();
const container = createApiContainer(env);
const service = new AbilityCatalogReleaseTestRunService(container);

try {
  console.error("WARNING: EXPLICIT RELEASE PIN != ACTIVE RELEASE");
  console.error("WARNING: THIS DOES NOT CHANGE DEFAULT ANALYSES");
  const result = await service.enqueueExplicitReleaseRefresh(
    { releaseId, characterId, region, realmSlug, name, forceRefresh: true },
    { actorType: "system", userId: null, sessionSecret: env.SESSION_SECRET },
  );
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.notice);
    console.log(
      `pin: ${result.pin.kind}${result.pin.kind === "RELEASE" ? ` ${result.pin.releaseKey}` : ""}`,
    );
    console.log(`jobId: ${result.jobId}`);
    console.log(`characterId: ${result.characterId}`);
    console.log(`enqueued: ${result.enqueued} reused: ${result.reused}`);
  }
} finally {
  await container.close();
}
