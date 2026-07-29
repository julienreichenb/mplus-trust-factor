#!/usr/bin/env node
/**
 * Read-only Warcraft Logs Survival calibration probe.
 *
 * Usage:
 *   pnpm wcl:probe:survival:calibration -- --region EU --realm archimonde --name Wallidrixe
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertLiveCallsAllowed, requireIdentityArgs } from "./live-smoke-lib.mjs";

assertLiveCallsAllowed();

try {
  requireIdentityArgs(process.argv.slice(2));
} catch {
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const probeJs = resolve(
  root,
  "packages/providers/warcraftlogs/dist/probe/run-survival-calibration-probe.js",
);

if (!existsSync(probeJs)) {
  console.error(
    "FAIL: probe entry not built. Run: pnpm --filter @mplus/provider-warcraftlogs run build",
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
const cmd = ["node", quote(probeJs), ...argv.map(quote)].join(" ");
const result = spawnSync(cmd, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
