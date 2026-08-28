import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  compileBootstrapRelease0,
  formatBootstrapSummary,
} from "../release/bootstrap.js";
import { resolveWorkspacePath } from "../refresh/extract/workspace-path.js";

function arg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function printUsage(): never {
  console.error(`Usage:
  pnpm ability-catalog:release:bootstrap [-- --out <artifact.json>] [--report-out <parity.json>] [--json]

Compiles Bootstrap Release 0 from RETAIL_ABILITY_CATALOG, validates, and runs
static↔artifact semantic parity.

THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.
CAS / DB persistence is Phase 3B.2 — --persist is not available in 3B.1.`);
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  printUsage();
}

if (argv.includes("--persist")) {
  console.error(
    "NOTE: offline abilities CLI cannot persist. Use root command:\n  pnpm ability-catalog:release:bootstrap -- --persist",
  );
  process.exit(2);
}

const outPath = arg(argv, "--out");
const reportOut = arg(argv, "--report-out") ?? arg(argv, "--parity-out");
const json = argv.includes("--json");

const result = compileBootstrapRelease0();

if (outPath) {
  const abs = resolveWorkspacePath(outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, result.serializedJson, "utf8");
  console.error(`Wrote artifact ${abs} (${result.byteSize} bytes)`);
}

if (reportOut) {
  const abs = resolveWorkspacePath(reportOut);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(result.parity, null, 2)}\n`, "utf8");
  console.error(`Wrote parity report ${abs}`);
}

if (json) {
  console.log(
    JSON.stringify(
      {
        notice: "THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.",
        schemaVersion: result.artifact.schemaVersion,
        releaseKey: result.artifact.releaseKey,
        contentDigest: result.artifact.contentDigest,
        topologyDigest: result.artifact.topologyDigest,
        wowBuild: result.artifact.wowBuild,
        gameVersion: result.artifact.gameVersion,
        seasonSlug: result.artifact.seasonSlug,
        ruleCount: result.artifact.rules.length,
        topology: result.topology,
        byteSize: result.byteSize,
        artifactValid: result.validation.valid,
        parity: result.parity,
      },
      null,
      2,
    ),
  );
} else {
  console.log(formatBootstrapSummary(result));
}

if (!result.validation.valid || result.parity.overall !== "PASS") {
  process.exitCode = 1;
}
