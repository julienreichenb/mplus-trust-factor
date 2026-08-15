#!/usr/bin/env node
/**
 * Live WCL report-rankings discovery probe (one persisted fight).
 *
 * Usage:
 *   pnpm wcl:probe:report-rankings -- --region EU --realm ravencrest --name Own
 */
import { spawnSync } from "node:child_process";
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
const workerRoot = resolve(root, "apps/worker");
const probeTs = "src/wcl-report-rankings-probe.ts";
const argv = process.argv.slice(2);
const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
const cmd = ["pnpm", "exec", "tsx", quote(probeTs), ...argv.map(quote)].join(" ");
const result = spawnSync(cmd, {
  cwd: workerRoot,
  env: process.env,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
