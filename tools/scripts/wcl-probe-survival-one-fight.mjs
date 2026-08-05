#!/usr/bin/env node
/**
 * Provider-free WCL Survival one-fight probe (persisted CAS only).
 *
 * Usage:
 *   pnpm wcl:probe:survival-one-fight
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workerRoot = resolve(root, "apps/worker");
const probeTs = "src/wcl-survival-one-fight-probe.ts";
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
