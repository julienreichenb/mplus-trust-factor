/**
 * Compile Bootstrap Release 0 and optionally persist to CAS + AbilityCatalogRelease.
 *
 *   pnpm ability-catalog:release:bootstrap [-- --out artifact.json] [--report-out parity.json] [--json] [--persist]
 *
 * THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import {
  compileBootstrapRelease0,
  formatBootstrapSummary,
} from "@mplus/abilities/release";
import { AbilityCatalogReleaseService } from "../services/ability-catalog-release-service.js";

function arg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function printUsage(): never {
  console.error(`Usage:
  pnpm ability-catalog:release:bootstrap [-- --out <artifact.json>] [--report-out <parity.json>] [--json] [--persist]

Compiles Bootstrap Release 0, validates, and runs static↔artifact parity.
With --persist: writes immutable CAS bytes + AbilityCatalogRelease (status=VALIDATED).

THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.`);
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

function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function resolvePath(p: string): string {
  if (resolve(p) === p) return p;
  return resolve(findWorkspaceRoot(process.cwd()), p);
}

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../..");
loadDotEnvFile(resolve(root, ".env"));
resetEnvCache();

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) printUsage();

const outPath = arg(argv, "--out");
const reportOut = arg(argv, "--report-out") ?? arg(argv, "--parity-out");
const json = argv.includes("--json");
const persist = argv.includes("--persist");

const compiled = compileBootstrapRelease0();

if (outPath) {
  const abs = resolvePath(outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, compiled.serializedJson, "utf8");
  console.error(`Wrote artifact ${abs} (${compiled.byteSize} bytes)`);
}
if (reportOut) {
  const abs = resolvePath(reportOut);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(compiled.parity, null, 2)}\n`, "utf8");
  console.error(`Wrote parity report ${abs}`);
}

let persistResult: Awaited<ReturnType<AbilityCatalogReleaseService["persistBootstrapRelease0"]>> | null =
  null;

if (persist) {
  if (compiled.parity.overall !== "PASS" || !compiled.validation.valid) {
    console.error("ERROR: refusing --persist because parity/validation failed");
    process.exitCode = 1;
  } else {
    const env = loadEnv();
    const prisma = createPrismaClient(env.DATABASE_URL);
    const service = new AbilityCatalogReleaseService(prisma);
    try {
      persistResult = await service.persistBootstrapRelease0({
        actorType: "system",
        sessionSecret: env.SESSION_SECRET,
        userId: null,
      });
      console.error(
        `Persisted Bootstrap release id=${persistResult.release.id} created=${persistResult.created} status=${persistResult.release.status}`,
      );
      console.error("THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.");
    } finally {
      await prisma.$disconnect();
    }
  }
}

if (json) {
  console.log(
    JSON.stringify(
      {
        notice: "THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.",
        schemaVersion: compiled.artifact.schemaVersion,
        releaseKey: compiled.artifact.releaseKey,
        contentDigest: compiled.artifact.contentDigest,
        topologyDigest: compiled.artifact.topologyDigest,
        ruleCount: compiled.artifact.rules.length,
        topology: compiled.topology,
        byteSize: compiled.byteSize,
        artifactValid: compiled.validation.valid,
        parity: compiled.parity,
        persist: persistResult
          ? {
              created: persistResult.created,
              releaseId: persistResult.release.id,
              status: persistResult.release.status,
              artifactId: persistResult.release.artifactId,
              casContentHash: persistResult.release.casContentHash,
            }
          : null,
      },
      null,
      2,
    ),
  );
} else {
  console.log(formatBootstrapSummary(compiled));
  if (persistResult) {
    console.log(
      [
        `persistedReleaseId=${persistResult.release.id}`,
        `persistedCreated=${persistResult.created}`,
        `persistedStatus=${persistResult.release.status}`,
        `persistedArtifactId=${persistResult.release.artifactId}`,
        `persistedCasHash=${persistResult.release.casContentHash}`,
        "THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.",
      ].join("\n"),
    );
  }
}

if (!compiled.validation.valid || compiled.parity.overall !== "PASS") {
  process.exitCode = 1;
}
