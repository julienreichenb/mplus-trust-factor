#!/usr/bin/env node
/**
 * Survival V1.1 health discovery + scorer.
 *
 * Live:
 *   pnpm wcl:probe:survival:v1.1 -- --region EU --realm archimonde --name Wallidrixe \
 *     --input-dir raw-artifacts/wcl-probe-survival-calibration/eu-archimonde-wallidrixe
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const probeJs = resolve(
  root,
  "packages/providers/warcraftlogs/dist/probe/run-survival-v1_1.js",
);

const argv = process.argv.slice(2);
const needsLive =
  !argv.includes("--offline-only") &&
  !argv.includes("--discovery-cache") &&
  !argv.includes("--reprocess-raw-dir");

if (needsLive) {
  const { assertLiveCallsAllowed } = await import("./live-smoke-lib.mjs");
  assertLiveCallsAllowed();
}

if (!existsSync(probeJs)) {
  console.error(
    "FAIL: probe entry not built. Run: pnpm --filter @mplus/provider-warcraftlogs run build",
  );
  process.exit(1);
}

const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
const cmd = ["node", quote(probeJs), ...argv.map(quote)].join(" ");
const result = spawnSync(cmd, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
