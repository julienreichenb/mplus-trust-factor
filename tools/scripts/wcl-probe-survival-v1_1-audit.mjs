#!/usr/bin/env node
/**
 * Survival V1.1 hardening audit (offline).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const probeJs = resolve(
  root,
  "packages/providers/warcraftlogs/dist/probe/run-survival-v1_1-audit.js",
);

if (!existsSync(probeJs)) {
  console.error(
    "FAIL: probe entry not built. Run: pnpm --filter @mplus/provider-warcraftlogs run build",
  );
  process.exit(1);
}

const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
const cmd = ["node", quote(probeJs), ...process.argv.slice(2).map(quote)].join(" ");
const result = spawnSync(cmd, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
